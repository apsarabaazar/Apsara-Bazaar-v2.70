const express = require("express");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const dotenv = require("dotenv").config();
const bodyParser = require("body-parser");
const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api');
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
const bot2 = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN2);
const socketIo = require("socket.io");
const mongoose = require('mongoose');
const axios = require('axios');
const { pipeline } = require("stream");
const multer = require('multer');
const upload = multer().array('images', 10);
const NodeCache = require('node-cache');
const { SitemapStream } = require('sitemap');
const { createGzip } = require('zlib');
const https = require('https');





const app = express();

// Middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '60mb', extended: true }));
app.use(express.static("public"));
app.set("view engine", "ejs");




// Session setup
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_DB,
      collectionName: "sessions",
      ttl: 30 * 24 * 60 * 60, // 30 Days
    }),
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days in milliseconds
      secure: false, // Set true if using HTTPS
      httpOnly: true // Protect against XSS attacks
    }
  })
);

// Connect to MongoDB
mongoose.connect(process.env.MONGO_DB, {
  maxpoolSize: 20,             // Keep 10 connections in the pool
  socketTimeoutMS: 30000,   // Close idle connections after 30 seconds of inactivity
  connectTimeoutMS: 5000,   // Max time to wait for a connection to be established
})
  //mongoose.connect("mongodb://0.0.0.0:27017/ApsaraBazaar")
  .then(() => {
    console.log("Database connected");
    
   // Add the migration function here
  const migrateUserFields = async () => {
    try {
      const result = await User.updateMany(
        {}, // Match all documents
        [{
          $set: {
            followers: { $ifNull: ["$followers", []] },
            following: { $ifNull: ["$following", []] }
          }
        }]
      );
  
      console.log(`Successfully updated ${result.modifiedCount} user documents`);
    } catch (error) {
      console.error('Error updating user documents:', error);
    }
  };

  //  // Run the migration
    //migrateUserFields();
  })
  .catch(err => {
    console.error("Connection error", err);
  });

// Models
const User = require('./models/User');
const Post = require("./models/Post");
const Comment = require('./models/Comment');
const Image = require('./models/Image');
const Room = require('./models/Room')
const Message = require("./models/Message");


// Routes
const authRoutes = require("./routes/auth");
const postRoutes = require("./routes/post");
const userRoutes = require("./routes/user");
const botRoutes = require('./routes/bot');
const roomsRoutes = require("./routes/rooms");

app.use("/rooms", roomsRoutes);
app.use("/auth", authRoutes);
app.use("/post", postRoutes);
app.use("/user", userRoutes)

// Render the index page immediately with basic data
app.get("/", async (req, res) => {

  const identifier = req.session.user?.email || req.sessionID;
  updateUserActivity(identifier);

  let user = null;
  if (req.session.user) {
    user = await User.findById(req.session.user._id).lean().exec();
  }

  const nuser = getActiveUserCount();
  res.render("index", { user, nuser });
});



// Map to track last-active timestamp by identifier (email or sessionID)
const activeUsers = new Map();
const INACTIVITY_THRESHOLD = 30 * 60 * 1000; // 30 minutes

// Update (or add) user activity
function updateUserActivity(identifier) {
  if (!identifier) return;
  activeUsers.set(identifier, Date.now());
}

// Remove users inactive beyond threshold
function removeInactiveUsers() {
  const now = Date.now();
  for (const [id, lastActive] of activeUsers.entries()) {
    if (now - lastActive > INACTIVITY_THRESHOLD) {
      activeUsers.delete(id);
    }
  }
}

// Schedule periodic cleanup every 10 minutes
setInterval(removeInactiveUsers, 10 * 60 * 1000);

// Get count of currently active users
function getActiveUserCount() {
  return activeUsers.size;
}



async function updateGoldMembers() {
  try {
      // Define the ranks that should not be changed
      const excludedRanks = ["Admin", "Moderator", "Elite Member"];

      // Find users who qualify for "Gold Member" but aren't in the excluded ranks
      const usersToUpdate = await User.find({ 
          rank: { $nin: excludedRanks },  // Exclude Admin, Moderator, Elite Member
          "likes.100": { $exists: true }  // Check if likes array has more than 100 entries
      });

      let updatedUsers = [];

      for (let user of usersToUpdate) {
          user.rank = "Gold Member"; // Update rank
          await user.save(); // Save changes
          updatedUsers.push(user.username); // Store updated usernames
      }

      console.log(`Updated ${updatedUsers.length} users to Gold Member.`);
      return { updatedCount: updatedUsers.length, users: updatedUsers };
      
  } catch (error) {
      console.error("Error updating Gold Members:", error);
      return { error: "Internal Server Error" };
  }
}

// Call this function whenever necessary, such as a scheduled task or admin trigger.
// updateGoldMembers().then(function(result) {
//   console.log(result);
// });



//---------------------------------------------------------------------------------------------------------------------------------------

const pLimit = require('p-limit').default;


// Concurrency control (max 5 concurrent requests)
const limit = pLimit(5);

// Cache for posts and tags
const postCache = new Map();
const tagCache = new Map();
// In-memory cache for file_path
const filePathCache = new Map();



const httpsAgent = new https.Agent({
  family: 4, // Force IPv4
  keepAlive: true
});


//Function to Cache Posts------------------------------------------------------------------------------------------------------------------

// Tags for caching
const tags = ["Bazaar", "Admire Apsara", "Influencers", "Kinks and Fantasies", "Apsara Fakes"];
tags.forEach(tag => tagCache.set(tag, []));

// Refresh all caches with error handling

const refreshAllCaches = async () => {
  try {
    await Promise.allSettled([refreshLatestCache(), refreshTagCache()]);
    console.log('Cache refresh completed (with possible partial failures)');
  } catch (error) {
    console.error('Critical error during cache refresh:', error);
  }
};
const refreshLatestCache = async () => {
  try {
    const latestPosts = await Post.find({})
      .sort({ uploadTime: -1 })
      .limit(30)
      .lean()
      .exec();

    const authors = [...new Set(latestPosts.map(post => post.author))];
    const postIds = latestPosts.map(post => post._id);

    // Fetch profile pictures & images concurrently
    const [authorMap, imagesByPostId] = await Promise.all([
      getAuthorProfilePics(authors),
      fetchImagesByPostId(postIds)
    ]);

    // Merge everything into final post structure
    const postsWithImages = latestPosts.map(post => ({
      ...post,
      images: imagesByPostId[post._id] || [],
      authorpic: authorMap[post.author] || 1 // Default to 1 if not found
    }));

    postCache.set("latest", postsWithImages);
    console.log("Latest posts cache refreshed with author pictures and images");
  } catch (error) {
    console.error("Error refreshing latest cache:", error);
  }
};
const refreshTagCache = async () => {
  try {
    // Refresh caches for normal tags concurrently
    await Promise.all(tags.map(async (tag) => {
      const posts = await Post.find({ tags: tag })
        .sort({ uploadTime: -1 })
        .limit(10)
        .lean()
        .exec();

      const postIds = posts.map(post => post._id);
      const authors = [...new Set(posts.map(post => post.author))];

      // Fetch images & profile pictures concurrently
      const [imagesByPostId, authorPics] = await Promise.all([
        fetchImagesByPostId(postIds),
        getAuthorProfilePics(authors)
      ]);

      // Attach images & author profile pics to posts
      const postsWithImages = posts.map(post => ({
        ...post,
        images: imagesByPostId[post._id] || [],
        authorpic: authorPics[post.author] || 1 // Default to 1 if not found
      }));

      tagCache.set(tag, postsWithImages);
      console.log(`Cache refreshed for tag: ${tag}`);
    }));

    // Refresh special tags: Hot, Top, Rising concurrently
    const specialTags = ['Hot', 'Top', 'Rising'];
    await Promise.all(specialTags.map(async (specialTag) => {
      let posts;
      if (specialTag === 'Top') {
        // Use aggregation for likes + comments
        posts = await Post.aggregate([
          { $addFields: { total: { $add: ["$likes", "$comments"] } } },
          { $sort: { total: -1 } },
          { $limit: 10 },
          { $project: { total: 0 } } // Exclude computed field
        ]).exec();
      } else {
        let sortCriteria = {};
        if (specialTag === 'Hot') sortCriteria = { likes: -1 };
        else if (specialTag === 'Rising') sortCriteria = { comments: -1 };

        posts = await Post.find()
          .sort(sortCriteria)
          .limit(10)
          .lean()
          .exec();
      }

      const postIds = posts.map(post => post._id);
      const authors = [...new Set(posts.map(post => post.author))];

      // Fetch images & profile pictures concurrently
      const [imagesByPostId, authorPics] = await Promise.all([
        fetchImagesByPostId(postIds),
        getAuthorProfilePics(authors)
      ]);

      // Attach images & author profile pics to posts
      const postsWithImages = posts.map(post => ({
        ...post,
        images: imagesByPostId[post._id] || [],
        authorpic: authorPics[post.author] || 1 // Default to 1 if not found
      }));

      tagCache.set(specialTag, postsWithImages);
      console.log(`Cache refreshed for special tag: ${specialTag}`);
    }));
  } catch (error) {
    console.error("Error refreshing tag caches:", error);
  }
};

//Helper Function

const getAuthorProfilePics = async (authors) => {
  try {
    const users = await User.find({ username: { $in: authors } })
      .select('username profilepic')
      .lean()
      .exec();

    return users.reduce((acc, user) => {
      acc[user.username] = user.profilepic;
      return acc;
    }, {});
  } catch (error) {
    console.error("Error fetching author profile pictures:", error);
    return {};
  }
};

const fetchImagesByPostId = async (postIds) => {
  if (postIds.length === 0) return {};

  // // Fetch posts with their media arrays
  const posts = await Post.find({ _id: { $in: postIds } }).select('media').lean().exec();
   // Extract media with postId inheritance
   const allMedia = posts.flatMap(post => 
    (post.media || []).map(m => ({
      ...m,
      postId: post._id // Add postId to each media record
    }))
  );
  // If no media found in posts, fallback to Image collection
  if (allMedia.length === 0) {
    const images = await Image.find({ postId: { $in: postIds } }).lean() .exec();
    console.log(images)
    return mapImagesByPostIdAsync(images);
  }

  // Otherwise pass media records to existing mapper
  return mapImagesByPostIdAsync(allMedia);
};


const getTelegramFilePath = async (fileId) => {
  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      const response = await axios.get(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`,
        { timeout: 5000 }
      );
      return response.data.result.file_path;
    } catch (error) {
      if (retryCount === maxRetries - 1) {
        console.error(`Final attempt failed for ${fileId}:`, error.message);
        return null;
      }
      console.log(`Retrying ${fileId} (attempt ${retryCount + 1})`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
      retryCount++;
    }
  }
};
function cacheFilePath(fileId, filePath) {
  filePathCache.set(fileId, { filePath, timestamp: Date.now() });
}
function getCachedFilePath(fileId) {
  const cached = filePathCache.get(fileId);
  if (cached && Date.now() - cached.timestamp < 30 * 60 * 1000) { // Cache for 30 minutes
    return cached.filePath;
  }
  return null; // Cache expired or not found
}
async function getFilePath(fileId) {
  let filePath = getCachedFilePath(fileId); // Check cache first
  if (!filePath) {
    filePath = await getTelegramFilePath(fileId); // Fetch fresh if not cached
    if (filePath) {
      cacheFilePath(fileId, filePath); // Cache the new file_path
    }
  }
  return filePath;
}
const mapImagesByPostIdAsync = async (images) => {
  const processImage = async (image) => {
    let filePath = await getFilePath(image.fileId);
    if (!filePath) {
      //console.error(`Fetching fresh file path for ${image.fileId}`);
      filePath = await limit(() => getTelegramFilePath(image.fileId));

      if (filePath) cacheFilePath(image.fileId, filePath);
    }

    if (filePath) {
      const imageUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`;
      try {
        await axios.head(imageUrl);
        return { ...image, filePath, src: imageUrl };
      } catch (error) {
       // console.error(`File path expired for ${image.fileId}, refreshing...`);
        freshFilePath = await limit(() => getTelegramFilePath(image.fileId));
        if (freshFilePath) {
          cacheFilePath(image.fileId, freshFilePath);
          return { ...image, filePath: freshFilePath, src: `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${freshFilePath}` };
        }
      }
    }
    return { ...image, src: `/post/images/${image.fileId}` };
  };

  const refreshedImages = await Promise.all(images.map(image => processImage(image)));

  return refreshedImages.reduce((acc, image) => {
    if (!acc[image.postId]) acc[image.postId] = [];
    acc[image.postId].push({ fileId: image.fileId, caption: image.caption, src: image.src });
    return acc;
  }, {});
};

// Initial cache refresh and periodic refresh every 5 hours
refreshAllCaches();
setInterval(refreshAllCaches, 5 * 60 * 60 * 1000); // every 5 hours

//Main Post Call API
app.get("/api/posts", async (req, res) => {
  try {
    const { skip = 0, limit = 10, tag } = req.query;
    const skipInt = parseInt(skip, 10);
    const limitInt = parseInt(limit, 10);

    // Check if the tag is a special one
    const isSpecialTag = ['Hot', 'Top', 'Rising'].includes(tag);

    // Determine cache key and store
    const cacheKey = tag || 'latest';
    const cacheStore = tag ? tagCache : postCache;
    const cachedPosts = cacheStore.get(cacheKey) || [];

    // Serve from cache if possible
    if (cachedPosts.length >= skipInt + limitInt) {
      return res.json({ posts: cachedPosts.slice(skipInt, skipInt + limitInt) });
    }

    let query = tag ? { tags: tag } : {};
    let sortCriteria = { uploadTime: -1 };
    let posts;
    if (isSpecialTag) {
      if (tag === 'Top') {
        // Aggregate for likes + comments sum
        posts = await Post.aggregate([
          { $addFields: { total: { $add: ["$likes", "$comments"] } } },
          { $sort: { total: -1 } },
          { $skip: skipInt },
          { $limit: limitInt },
          { $project: { total: 0 } }
        ]).exec();
      } else {
        sortCriteria = tag === 'Hot' ? { likes: -1 } : { comments: -1 };
        posts = await Post.find().sort(sortCriteria).skip(skipInt).limit(limitInt).lean().exec();
      }
    } else {
      posts = await Post.find(query).sort(sortCriteria).skip(skipInt).limit(limitInt).lean().exec();
    }

    const authors = [...new Set(posts.map(post => post.author))];
    const postIds = posts.map(post => post._id);

    // Fetch images and profile pictures concurrently
    const [authorMap, imagesByPostId] = await Promise.all([
      getAuthorProfilePics(authors),
      fetchImagesByPostId(postIds)
    ]);

    // Merge everything
    const postsWithImages = posts.map(post => ({
      ...post,
      images: imagesByPostId[post._id] || [],
      authorpic: authorMap[post.author] || 1 // Default to 1 if not found
    }));

    res.json({ posts: postsWithImages });
  } catch (error) {
    console.error("Error fetching posts:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});



// Improved fetchWithRetry function
const fetchWithRetry = async (url, options, retries = 2, delay = 750, attempt = 1) => {
  try {
    const timeout = 3500; // Timeout in milliseconds
    const response = await axios({
      url,
      method: options.method,
      timeout,
      responseType: options.responseType || 'json',
    });
    if (attempt > 1) {
      console.log(`Fetch successful on attempt ${attempt}.`);
    }
    return response;
  } catch (error) {
    if (retries === 0) throw error;
    if (error.code === 'ECONNABORTED') {
      console.log(`Timeout on attempt ${attempt}, retrying... (${retries} retries left)`);
    } else {
      console.log(`Attempt ${attempt} failed, retrying... (${retries} retries left)`);
    }
    await new Promise(resolve => setTimeout(resolve, delay));
    return fetchWithRetry(url, options, retries - 1, delay, attempt + 1);
  }
};
// Endpoint to fetch and stream an image from Telegram (Backup Method)
app.get("/api/images/:fileId", async (req, res) => {
  const { fileId } = req.params;
  try {
    // 1. Try to find image in database
    let image = await Image.findOne({ fileId });

    // 2. If image doesn't exist at all
    if (!image) {
      return res.status(404).send("Image not found");
    }
    let filePath = "";

    const response = await fetchWithRetry(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`,
      { method: 'GET' }
    );
    filePath = response.data.result.file_path;
    // 4. Extract and save filePath to DB
    image.filePath = response.data.result.file_path;
    await image.save();


    // Fetch the image file stream
    const fileStreamResponse = await fetchWithRetry(
      `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`,
      { method: 'GET', responseType: 'stream' }
    );

    res.setHeader("Content-Type", "image/jpeg"); // Adjust MIME type if necessary
    pipeline(fileStreamResponse.data, res, (error) => {
      if (error) {
        console.error("Error streaming image: Premature Closure");
        if (!res.headersSent) res.status(500).send("Failed to fetch image");
      }
    });
  } catch (error) {
    console.error("Error fetching image from Telegram");
    if (!res.headersSent) res.status(500).send("Failed to fetch image");
  }
});

//---------------------------------------------------------------------------------------------------------------------------------------


//API which trigger the Chache Refresh

app.post('/post/addlike/:postId', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ message: 'User not authenticated' });
  }

  const postId = req.params.postId;
  const userId = req.session.user._id;

  try {
    // 1. Find the post
    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    // 2. Atomic update: Add like if not exists + enforce 4000 limit
    const updateResult = await User.updateOne(
      { 
        _id: userId, 
        likes: { $ne: postId } // Check if not already liked
      },
      { 
        $push: { 
          likes: { 
            $each: [postId], // Add the new like
            $slice: -4000    // Keep only the last 4000 entries
          } 
        } 
      }
    );

    // 3. If no documents were updated, the user already liked the post
    if (updateResult.modifiedCount === 0) {
      return res.status(400).json({ message: 'You have already liked this post.' });
    }

    // 4. Update post likes count
    post.likes += 1;
    await post.save();
    await refreshAllCaches();
    res.status(200).json({ message: 'Like added successfully!', likes: post.likes });

   
    // 5. Add or Update Notification to Post Author (based on postId)
    const authorUsername = post.author; // or post.authorId if using _id
    const authorUser = await User.findOne({ username: authorUsername });

    if (authorUser && authorUser._id.toString() !== userId) {
       const likerUser = await User.findById(userId);
       const likerUsername = likerUser.username;

      const postMediaImg = (post.media && post.media.length > 0) ? post.media[0].fileId : "NotFound";

       // Find existing notification for this specific post
       const existingNotificationIndex = authorUser.notifications.findIndex(n =>
       n.postId?.toString() === postId
       );

    if (existingNotificationIndex !== -1) {
      // Existing notification found for the post
      let oldMessage = authorUser.notifications[existingNotificationIndex].message;
      let usernames = oldMessage.replace(" liked your post.", "").split(",");
      usernames = [likerUsername, ...usernames.filter(u => u !== likerUsername)].slice(0, 3);

       // Update the notification
       authorUser.notifications[existingNotificationIndex].message = `${usernames.join(",")} liked your post.`;
       authorUser.notifications[existingNotificationIndex].status = "Unread";
       authorUser.notifications[existingNotificationIndex].time = new Date();
       authorUser.notifications[existingNotificationIndex].img = postMediaImg;

       await authorUser.save(); // Save changes
    } 
    else {
     // Create new notification for this post
         const newNotification = {
           message: `${likerUsername} liked your post.`,
           img: postMediaImg,
           status: "Unread",
           time: new Date(),
           postId: post._id
         };
     
         await User.updateOne(
           { _id: authorUser._id },
           { $push: { notifications: { $each: [newNotification], $slice: -100 } } }
         );
    }
  }

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error adding like', error });
  }
});


app.post('/post/create', upload, async (req, res) => {
  if (!req.session.user) {
    return res.status(401).send({ message: 'Unauthorized' });
  }

  const { title, bodyText } = req.body;
  
  // Handle tags as array (ensure extended mode is enabled if needed)
  let tags = req.body.tags;
  if (typeof tags === 'string') {
    tags = [tags];
  }

  // Validate tags
  if (!tags || tags.length < 1 || tags.length > 3) {
    return res.status(400).json({ success: false, message: 'Select 1-3 tags' });
  }

  try {
    // 1. Create empty post to get the ID
    const post = new Post({
      title,
      bodyText,
      media: [],
      author: req.session.user.username,
      createdAt: new Date(),
      tags: ["recent", ...tags],
    });
    await post.save();
    const postId = post._id.toString();

    // 2. Loop through each file and send to both bots
    const mediaArray = [];
    for (const image of req.files) {
      // send to primary bot
      const resp1 = await bot.sendPhoto(
        process.env.TELEGRAM_GROUP_ID,
        image.buffer,
        { caption: `Post ID: ${postId}` }
      );
      const fileId  = resp1.photo.pop().file_id;
      const msgId   = resp1.message_id.toString();

      // send to secondary bot
      const resp2 = await bot2.sendPhoto(
        process.env.TELEGRAM_GROUP_ID2,
        image.buffer,
        { caption: `Post ID: ${postId}` }
      );
      const fileId2 = resp2.photo.pop().file_id;

      mediaArray.push({
        type:      "photo",
        fileId,
        fileId2,
        messageId: msgId,
      });
    }

    // 3. Persist the combined media array in one update
    await Post.findByIdAndUpdate(postId, { media: mediaArray });

    await refreshAllCaches();
    res.status(201).json({ success: true, message: 'Posted', postId });

  } catch (error) {
    console.error('Post creation error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to post',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});




//---------------------------------------------------------------------------------------------------------------------------------------

// Donation route
app.get("/donation", (req, res) => {
  res.render("donation");
});

//Profile Route
app.get("/my-profile", async (req, res) => {

  if (!req.session.user) {
    return res.render("login"); // Renders login.ejs if user is not logged in
  }
  let user = null;
  user = await User.findById(req.session.user._id).exec();
  let profileuser=user;
  const badges = {
    "Admin": "👑",          // Crown
    "Moderator": "🛡️",      // Shield
    "Elite Member": "🌟",   // Star
    "Gold Member": "✨",     // Sparkle
    "Fapper":"",
};
let badge=badges[profileuser.rank];
const profileuserObject = profileuser.toObject(); // Convert Mongoose doc to plain JS object
profileuserObject.badge=badge;



  res.render("profile", { user,profileuser:profileuserObject,guestUser:req.session.guest });
});

// Middleware to check if user is logged in
function isAuthenticated(req, res, next) {
  if (!req.session.user) {
      return res.status(401).json({ error: "Unauthorized access" });
  }
  next();
}

app.post("/update-profile", isAuthenticated, async (req, res) => {
  try {
      const { name, currentPassword, newPassword, profileIcon } = req.body;
      const userId = req.session.user._id; // Get user ID from session

      // Fetch user from the database
      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ error: "User not found" });

      // Object to store fields that need updating
      const updates = {};

      // **Update Display Name**
      if (name) {
          updates.name = name.trim();
      }

      // **Update Password (if provided)**
      if (currentPassword && newPassword) {
          if (currentPassword !== user.password) {
            console.log("Inside wrong Password")
              return res.status(400).json({ error: "Incorrect User Password" });
          }
          updates.password = newPassword; // Directly store the new password
      }

      // **Update Profile Icon**
      if (profileIcon) {
        const allIcons = [
            { src: "/icons/avatars/avatar1.jpg", requiredRank: "Fapper" },
            { src: "/icons/avatars/avatar2.jpg", requiredRank: "Fapper" },
            { src: "/icons/avatars/avatar3.jpg", requiredRank: "Fapper" },
            { src: "/icons/avatars/avatar4.jpg", requiredRank: "Fapper" },
            { src: "/icons/avatars/avatar5.jpg", requiredRank: "Fapper" },
            { src: "/icons/avatars/avatar6.jpg", requiredRank: "Fapper" },
            { src: "/icons/avatars/avatar7.jpg", requiredRank: "Gold Member" },
            { src: "/icons/avatars/avatar8.jpg", requiredRank: "Gold Member" },
            { src: "/icons/avatars/avatar9.jpg", requiredRank: "Moderator" },
            { src: "/icons/avatars/avatar10.jpg", requiredRank: "Moderator" },
        ];
    
        const userRank = user.rank || "Fapper";
    
        // Trim and sanitize input
        const sanitizedProfileIcon = profileIcon.trim();
    
        // Debugging log to check what is being received
        console.log("User selected profileIcon:", sanitizedProfileIcon);
    
        // Find the selected icon
        const selectedIcon = allIcons.find(icon => icon.src.trim() === sanitizedProfileIcon);
    
        if (!selectedIcon) {
            console.log("Invalid icon selection. Available icons:", allIcons.map(i => i.src));
            return res.status(400).json({ error: "Invalid icon selection" });
        }
    
        // Check if the user's rank allows selecting this icon
        const allowedRanks = {
            "Fapper": ["Fapper"],
            "Gold Member": ["Fapper", "Gold Member"],
            "Moderator": ["Fapper", "Gold Member", "Moderator"],
            "Admin": ["Fapper", "Gold Member", "Moderator", "Admin"]
        };
    
        if (!allowedRanks[userRank]?.includes(selectedIcon.requiredRank)) {
            console.log("Permission denied for rank:", userRank, "to select:", selectedIcon.requiredRank);
            return res.status(403).json({ error: "You do not have permission to use this icon" });
        }
    
        // Update profile icon
        updates.profilepic = sanitizedProfileIcon.match(/avatar(\d+)\.jpg/)?.[1] || sanitizedProfileIcon;
    }
    

      // **Apply Updates**
      await User.findByIdAndUpdate(userId, updates, { new: true });

      return res.json({ message: "Profile updated successfully", updates });
  } catch (error) {
      console.error("Profile Update Error:", error);
      return res.status(500).json({ error: "Internal Server Error" });
  }
});




const posts = require('./ApsaraBaazar.posts.json'); // make sure this file is in the same directory

// Replace with your actual domain
const baseUrl = 'https://apsarabazaar.onrender.com';

app.get('/sitemap.xml', (req, res) => {
  try {
    let sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    sitemap += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" `;
    sitemap += `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" `;
    sitemap += `xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9 `;
    sitemap += `http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">\n`; // Fixed typo here

    const staticPages = [
      { path: '/', lastmod: '2025-01-01' }, // Update date as needed
      { path: '/about', lastmod: '2025-01-01' },
      { path: '/donation', lastmod: '2025-01-01' },
      { path: '/contact', lastmod: '2025-01-01' }
    ];

    staticPages.forEach(({ path, lastmod }) => {
      sitemap += `
        <url>
          <loc>${baseUrl}${path}</loc>
          <lastmod>${lastmod}</lastmod>
          <changefreq>monthly</changefreq>
          <priority>0.8</priority>
        </url>`;
    });

    posts.forEach(post => {
      if (post._id?.$oid) {
        sitemap += `
          <url>
            <loc>${baseUrl}/post/details/${post._id.$oid}</loc>
            <changefreq>weekly</changefreq>
            <priority>0.5</priority>
          </url>`;
      }
    });

    sitemap += `\n</urlset>`;

    res.header('Content-Type', 'application/xml');
    res.send(sitemap);
  } catch (error) {
    console.error('Error generating sitemap:', error);
    res.status(500).send('Internal Server Error');
  }
});






const PORT = process.env.PORT || 3000;
const HOST = '::'; // Listen on all IPv6 addresses

const server = app.listen(PORT, HOST, () => {
  console.log(`Server running on http://[${HOST}]:${PORT}`);
});


const io = socketIo(server);
const users = new Map(); // To keep track of online users in different rooms


app.get("/chats", async (req, res) => {
  // Check if user is authenticated
  if (!req.session.user) {
    return res.status(401).redirect("/auth/login"); // Or handle differently
}
  try {
    let user = null;
    let rooms = []; // Initialize rooms to an empty array

    if (req.session.user && req.session.user._id) {
      user = await User.findById(req.session.user._id).exec();
      updateUserActivity(req.session.user.email);

      if (user.rooms) {
        let roomCodes = user.rooms.split(','); // Assuming user.rooms is a comma-separated string of room codes

        // Fetch rooms that exist
        let existingRooms = await Room.find({ code: { $in: roomCodes } }).exec();
        let existingRoomCodes = new Set(existingRooms.map(room => room.code)); // Convert to Set for fast lookup

        // Remove room codes that don't exist from user's rooms
        let validRoomCodes = roomCodes.filter(code => existingRoomCodes.has(code));

        if (validRoomCodes.length !== roomCodes.length) {
          user.rooms = validRoomCodes.join(','); // Update user.rooms with only valid rooms
          await user.save(); // Save the updated user document
        }

        // Fetch the latest message for each room and filter rooms that have messages
        let filteredRooms = [];
        for (let room of existingRooms) {
          const hasMessages = await Message.exists({ roomCode: room.code });
          if (hasMessages) {
            const latestMessage = await Message.findOne({ roomCode: room.code }).sort({ timestamp: -1 }).exec();
            filteredRooms.push({ room, latestMessage });
          }
        }

        // Sort rooms based on the latest message timestamp (newest first)
        filteredRooms.sort((a, b) => b.latestMessage.timestamp - a.latestMessage.timestamp);

        // Extract sorted rooms from filteredRooms array
        rooms = filteredRooms.map(item => item.room);
      }
      let nuser = getActiveUserCount();

      return res.render("chat-lobby", { user, rooms, nuser }); // Pass sorted rooms
    }
    else {
      return res.render("login")
    }


  } catch (err) {
    console.error("Error fetching user", err);
    res.status(500).send("Server error");
  }
});




// API endpoint for sending messages
app.post("/send-message", (req, res) => {
  const { message, user, roomCode,name } = req.body;

  const timestamp = new Date();
  const offset = 5.5 * 60 * 60 * 1000; // IST offset in milliseconds
  timestamp.setTime(timestamp.getTime() + offset);
  console.log(message)

  if (!message) {
    return res.json({
      success: false,
      error: "Message cannot be empty",
    });
  }
  let msg;
  if(roomCode==="7UI3IX"){
    msg = new Message({
      user,
      name,
      msg: message,
      timestamp,
      roomCode,
    });

    msg.save().then(() => {
      io.to(roomCode).emit("chat message", {
        _id: msg._id,
        user,
        name,
        msg: message,
        timestamp,
      });

      // Notify users in the room
      users.get(roomCode).forEach((userName, username) => {
        io.to(username).emit("notification", {
          title: "New Message",
          body: `${user} sent a new message`,
        });
      });

      res.json({ success: true, _id: msg._id });
    })
    .catch((err) => {
      console.error("Error saving message:", err);
      res.json({ success: false, error: err.message });
    });

    
  }
  else{
    msg = new Message({
      user,
      msg: message,
      timestamp,
      roomCode,
    });

    msg.save().then(() => {
      io.to(roomCode).emit("chat message", {
        _id: msg._id,
        user,
        msg: message,
        timestamp,
      });

      // Notify users in the room
      users.get(roomCode).forEach((userName, username) => {
        io.to(username).emit("notification", {
          title: "New Message",
          body: `${user} sent a new message`,
        });
      });

      res.json({ success: true, _id: msg._id });
    })
    .catch((err) => {
      console.error("Error saving message:", err);
      res.json({ success: false, error: err.message });
    });
  }

  
});

// Endpoint for deleting messages
app.delete('/delete-message/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // Find and delete the message by ID
    const message = await Message.findByIdAndDelete(id).exec();

    if (!message) {
      return res.status(404).json({ success: false, error: 'Message not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({ success: false, error: 'An error occurred while deleting the message' });
  }
});

io.on("connection", (socket) => {
  console.log("A user connected");

  socket.on("join room", async ({ username, roomCode }) => {
    socket.join(roomCode);
    socket.username = username;
    socket.roomCode = roomCode;

    if (!users.has(roomCode)) {
      users.set(roomCode, new Map()); // Use a Map to store usernames and their real names
    }

    // Fetch the user's real name
    const user = await User.findOne({ username });
    const userName = user ? user.name : username; // Fallback to username if name is not found

    users.get(roomCode).set(username, userName);

    console.log(`${userName} has joined room ${roomCode}`);

    // Send message history for the room to the new user
    Message.find({ roomCode })
      .sort({ timestamp: 1 })
      .then((messages) => {
        socket.emit("message history", messages);
      })
      .catch((err) => {
        console.error("Error retrieving message history:", err);
      });

    // Broadcast updated user list to the room
    io.to(roomCode).emit("update users", Array.from(users.get(roomCode).values()));
  });

  socket.on("disconnect", () => {
    const { username, roomCode } = socket;

    if (roomCode && users.has(roomCode)) {
      const userMap = users.get(roomCode);
      if (userMap) {
        userMap.delete(username);

        if (userMap.size === 0) {
          users.delete(roomCode);
        }

        console.log(`${username} has left room ${roomCode}`);

        // Broadcast updated user list to the room
        io.to(roomCode).emit("update users", Array.from(userMap.values()));
      }
    }
  });
});

app.use((req, res, next) => {
  res.status(404).render("404", { url: req.originalUrl });
});
