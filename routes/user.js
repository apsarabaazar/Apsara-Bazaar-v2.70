const express = require('express');
const router = express.Router();
const Post = require('../models/Post');
const User = require('../models/User');
const Image = require('../models/Image');
const Comments = require('../models/Comment');
const axios = require('axios');
const { pipeline } = require("stream");
const pLimit = require('p-limit').default;
// Concurrency control (max 5 concurrent requests)
const limit = pLimit(5);

// Define the route to get comments by username
router.post('/comments', async (req, res) => {
    const { username } = req.body;

    try {
        // Find comments where the Author is the username or any subBody item has the username
        const comments = await Comments.find({
            $or: [
                { Author: username },
                { 'subBody.username': username }
            ]
        }).sort({ _id: -1 }); // Sorts in descending order by _id (newest first)

        // Send back the comments
        res.json(comments);
    } catch (error) {
        console.error("Error fetching User comments:");
        res.status(500).json({ message: "Error fetching comments" });
    }
});

// Function to retry axios requests a number of times with timeout handling
const fetchWithRetry = async (url, options, retries = 2, delay = 750, attempt = 1) => {
    try {

        const timeout = 2000;
        // Add timeout to the request options
        const response = await axios({
            url,
            method: options.method,
            timeout, // Timeout option
            responseType: options.responseType || 'json', // Default to JSON if not provided
        });

        if (attempt === 1) {
            // No log for the first successful attempt
        } else {
            console.log(`Fetch successful on attempt ${attempt}.`);
        }

        return response;
    } catch (error) {
        if (retries === 0) {
            console.error(`Request failed after multiple attempts.`);
            throw error; // If retries are exhausted, throw error
        }

        // Check if the error is due to a timeout
        if (error.code === 'ECONNABORTED') {
            console.warn(`Timeout occurred on attempt ${attempt}, retrying... (${retries} retries left)`);
        } else {
            console.warn(`Attempt ${attempt} failed, retrying... (${retries} retries left)`);
        }

        // Retry after delay
        await new Promise(resolve => setTimeout(resolve, delay)); // Wait before retrying
        return fetchWithRetry(url, options, retries - 1, delay, attempt + 1); // Recursive retry with updated attempt count
    }
};


// Route to get paginated posts by username
router.post('/posts', async (req, res) => {
    const { username, skipCount, limit } = req.body;

    try {
        // Fetch posts by username with pagination
        const posts = await Post.find({ author: username })
            .sort({ uploadTime: -1 })
            .skip(skipCount)
            .limit(limit)
            .lean();

            const user = await User.findOne({ username }).exec();
        
        
    
          // Extract media with postId inheritance
          const allMedia = posts.flatMap(post => 
           (post.media || []).map(m => ({
             ...m,
             postId: post._id // Add postId to each media record
           }))
         );

    const imagesByPostId = await mapImagesByPostIdAsync(allMedia);

    const postsWithImages = posts.map(post => ({
      ...post,
      images: imagesByPostId[post._id] || [],
      authorpic:user.profilepic,
    }));

        // Send the posts with images to the client
        res.json({posts:postsWithImages});
    } catch (error) {
        console.error("Error fetching user posts:");
        res.status(500).json({ message: "Error fetching user posts" });
    }
});

// Route to fetch images from Telegram by file ID
router.get('/images/:fileId', async (req, res) => {
    const { fileId } = req.params;

    // Check if Telegram bot token is available
    if (!process.env.TELEGRAM_BOT_TOKEN) {
        return res.status(500).send("Telegram bot token is not configured.");
    }

    try {
        // Fetch file path from Telegram API with retry logic
        const response = await fetchWithRetry(
            `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`,
            { method: 'GET' }
        );
        const filePath = response.data.result.file_path;

        // Stream the file from Telegram to the client
        const fileStreamResponse = await fetchWithRetry(
            `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`,
            { method: 'GET', responseType: 'stream' }
        );

        const fileStream = fileStreamResponse.data;

        // Set headers for image streaming based on file extension (if available)
        const extension = filePath.split('.').pop();
        const contentType = extension === 'png' ? 'image/png' : 'image/jpeg';
        res.setHeader("Content-Type", contentType);

        // Stream the file directly to the client
        fileStream.pipe(res);
    } catch (error) {
        console.error("Error fetching image:");
        res.status(500).send("Failed to fetch image after retries.");
    }
});

// Assuming session middleware is set up to store user info
router.get('/profile/:username', async (req, res) => {
    const { username } = req.params;

    try {
        let user=null;
        if (!req.session.user) {
            return res.render("login"); // Renders login.ejs if user is not logged in
        }
        // Check if the session user is the same as the requested username
        if (req.session.user && req.session.user.username === username) {
            return res.redirect('/my-profile');
        }
        if (req.session.user) {
            user = await User.findById(req.session.user._id).lean().exec();
           
          }

        // Fetch the user details from the database
        const profileuser = await User.findOne({ username }).exec();
        if (!profileuser) {
            return res.status(404).send('User not found');
        }
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



        // Render the my-profile.ejs view with the user's details
        res.render('profile', { profileuser:profileuserObject ,user,guestUser:req.session.guest});
    } catch (error) {
        console.error("Error fetching user profile:", error);
        res.status(500).send("Server error");
    }
});

router.get("/liked-posts/posts", async (req, res) => {
    try {
        // Check if user is authenticated
        if (!req.session.user) {
            return res.status(401).redirect("/auth/login"); // Or handle differently
        }

        // Parse pagination parameters
        const skip = parseInt(req.query.skip) || 0;
        const limit = parseInt(req.query.limit) || 10;

        // Get user with likes array
        const user = await User.findById(req.session.user._id).lean();
        if (!user) {
            return res.status(404).send("User not found");
        }

        // Handle case where user has no likes
        if (!user.likes || user.likes.length === 0) {
            return res.render("user-likes", { posts: [] });
        }

        // Create a reversed copy of user.likes so that the last items become the first
        const reversedLikes = [...user.likes].reverse();

        // Get paginated post IDs from the reversed array
        const slicedIds = reversedLikes.slice(skip, skip + limit);

        // Get posts maintaining order from slicedIds
        const posts = await Post.find({ _id: { $in: slicedIds } }).lean();

        // Sort posts to match slicedIds order
        const postMap = {};
        posts.forEach(post => postMap[post._id.toString()] = post);
        const orderedPosts = slicedIds.map(id => postMap[id.toString()]).filter(Boolean);

        // Get images for these posts
        // Get images for these posts
        const postIds = orderedPosts.map(post => post._id);
        const authors = [...new Set(posts.map(post => post.author))];

         // Fetch images and profile pictures concurrently
        const [authorMap, imagesByPostId] = await Promise.all([
            getAuthorProfilePics(authors),
        fetchImagesByPostId(postIds)
      ]);
        // Combine posts with images
        const postsWithImages = orderedPosts.map(post => ({
            ...post,
            images: imagesByPostId[post._id] || [],
            authorpic: authorMap[post.author] || 1 // Default to 1 if not found
        }));

        res.json({
            posts: postsWithImages,
            pagination: {
                skip: skip + limit,
                limit,
                hasMore: user.saves.length > skip + limit
            }
        });
    } catch (error) {
        console.error("Error fetching liked posts:", error);
        res.status(500).send("Internal Server Error");
    }
});

router.get("/saved-posts/posts", async (req, res) => {
    try {
        // Check if user is authenticated
        if (!req.session.user) {
            return res.status(401).redirect("/auth/login"); // Or handle differently
        }

        // Parse pagination parameters
        const skip = parseInt(req.query.skip) || 0;
        const limit = parseInt(req.query.limit) || 10;

        // Get user with likes array
        const user = await User.findById(req.session.user._id).lean();
        if (!user) {
            return res.status(404).send("User not found");
        }

        // Handle case where user has no likes
        if (!user.saves || user.saves.length === 0) {
            return res.json({ posts: [] });
        }

        // Create a reversed copy of user.likes so that the last items become the first
        const reversedSaves = [...user.saves].reverse();

        // Get paginated post IDs from the reversed array
        const slicedIds = reversedSaves.slice(skip, skip + limit);

        // Get posts maintaining order from slicedIds
        const posts = await Post.find({ _id: { $in: slicedIds } }).lean();

        // Sort posts to match slicedIds order
        const postMap = {};
        posts.forEach(post => postMap[post._id.toString()] = post);
        const orderedPosts = slicedIds.map(id => postMap[id.toString()]).filter(Boolean);

        // Get images for these posts
        const postIds = orderedPosts.map(post => post._id);
        const authors = [...new Set(posts.map(post => post.author))];

         // Fetch images and profile pictures concurrently
        const [authorMap, imagesByPostId] = await Promise.all([
            getAuthorProfilePics(authors),
        fetchImagesByPostId(postIds)
      ]);
        // Combine posts with images
        const postsWithImages = orderedPosts.map(post => ({
            ...post,
            images: imagesByPostId[post._id] || [],
            authorpic: authorMap[post.author] || 1 // Default to 1 if not found
        }));

        res.json({
            posts: postsWithImages,
            pagination: {
                skip: skip + limit,
                limit,
                hasMore: user.saves.length > skip + limit
            }
        });
    } catch (error) {
        console.error("Error fetching liked posts:", error);
        res.status(500).send("Internal Server Error");
    }
});

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




router.get("/saved-posts", async (req, res) => {
    try {
        let user = null;
        // Check if user is authenticated
        if (!req.session.user) {
            return res.status(401).redirect("/auth/login"); // Or handle differently
        }
        user = await User.findById(req.session.user._id).lean().exec();
        res.render("features/user-personalised-posts",{type:"Saved",user,guestUser:req.session.guest});
    } catch (error) {
        console.error("Error fetching User Saves", error);
        res.status(500).send("Internal Server Error");
    }
});
router.get("/liked-posts", async (req, res) => {
    try {
        let user = null;
        // Check if user is authenticated
        if (!req.session.user) {
            return res.status(401).redirect("/auth/login"); // Or handle differently
        }
        user = await User.findById(req.session.user._id).lean().exec();
        res.render("features/user-personalised-posts",{type:"Liked",user,guestUser:req.session.guest});
    } catch (error) {
        console.error("Error fetching User Saves", error);
        res.status(500).send("Internal Server Error");
    }
});


router.post('/follow/:username', async (req, res) => {
    if (!req.session.user) {
      return res.status(401).json({ message: 'User not authenticated' });
    }
  
    const usernameToFollow = req.params.username;
    const sessionUsername = req.session.user.username;
  
    try {
      if (sessionUsername === usernameToFollow) {
        console.log("Exiting the request");
        return res.status(400).json({ message: `You can't follow yourself` });
      }
  
      // 1. Find both users
      const followUser = await User.findOne({ username: usernameToFollow });
      const sessionUser = await User.findOne({ username: sessionUsername });
  
      if (!followUser || !sessionUser) {
        return res.status(404).json({ message: 'User not found' });
      }
  
      // 2. Check for existing follow
      if (sessionUser.following.includes(usernameToFollow)) {
        return res.status(400).json({ message: `You are already following ${usernameToFollow}` });
      }
  
      // 3. Update follow arrays
      sessionUser.following.push(usernameToFollow);
      followUser.followers.push(sessionUsername);
  
      // 4. Save users
      await sessionUser.save();
      await followUser.save();
  
      // 5. Add notification to followed user
      const followNotification = {
        message: `${sessionUsername} has started following you.`,
        img: "Follow Button required",
        status: "Unread",
        time: new Date(),
      };
  
      await User.updateOne(
        { _id: followUser._id },
        { $push: { notifications: { $each: [followNotification], $slice: -100 } } }
      );
  
      return res.status(200).json({ message: 'Follow added successfully!' });
  
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: 'Error following user', error });
    }
  });
  

router.post('/unfollow/:username', async (req, res) => {
    if (!req.session.user) {
      return res.status(401).json({ message: 'User not authenticated' });
    }
  
    const usernameToUnfollow = req.params.username;
    const sessionUsername = req.session.user.username; // assuming session stores the username
  
    try {

        if(sessionUsername===usernameToUnfollow){
            console.log("Exiting the request")
            return res.status(400).json({ message: `You can't unfollow yourself` });
          }



      // 1. Find the user to unfollow by username.
      const unfollowUser = await User.findOne({ username: usernameToUnfollow });
      if (!unfollowUser) {
        return res.status(404).json({ message: 'User not found' });
      }
  
      // 2. Retrieve the session user.
      const sessionUser = await User.findOne({ username: sessionUsername });
      if (!sessionUser) {
        return res.status(401).json({ message: 'Session user not found' });
      }

      


      
      // 3. Check if session user is currently following the target user.
      if (!sessionUser.following.includes(usernameToUnfollow)) {
        return res.status(400).json({ message: `You are not following ${usernameToUnfollow}` });
      }
  
      // 4. Remove the target username from session user's following array.
      sessionUser.following = sessionUser.following.filter(username => username !== usernameToUnfollow);
  
      // 5. Remove the session user's username from the target user's followers array.
      unfollowUser.followers = unfollowUser.followers.filter(username => username !== sessionUsername);
  
      // 6. Save both user documents.
      await sessionUser.save();
      await unfollowUser.save();
  
      return res.status(200).json({ message: 'Unfollow successful!' });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: 'Error unfollowing user', error });
    }
  });

// Get User Rank
router.get('/rank', async (req, res) => {
    try {
        const { username } = req.query;
        if (!username) {
            return res.status(400).json({ error: "Username is required" });
        }

        // Fetch only the rank field
        const user = await User.findOne({ username }).select("rank");

        if (!user || !user.rank) {
            return res.status(404).json({ error: "User not found or rank missing" });
        }

        
        res.json({ rank: user.rank });

    } catch (error) {
        console.error("Error fetching user rank:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

  

router.get('/search', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/auth/login');
  }
  res.render('features/search',{ user: req.session.user});
});

router.get('/search/:q', async (req, res, next) => {
  try {
    const q = decodeURIComponent(req.params.q).trim(); // Add decodeURIComponent
    const safeQuery = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Add regex escape
    const page = parseInt(req.query.page) || 1;
    const sort = req.query.sort || 'new';
    const limit = 20;
    const skip = (page - 1) * limit;

    const sortOptions = {
      'new': { uploadTime: -1 },
      'oldest': { uploadTime: 1 },
      'hot': { likes: -1 }
    };

    // Use safeQuery for regex
    const posts = await Post.find(
      { title: new RegExp(safeQuery, 'i') },
      'title author uploadTime likes tags media'
    )
    .sort(sortOptions[sort])
    .skip(skip)
    .limit(limit)
    .lean();

   // 2. Extract unique author usernames
    const usernames = [...new Set(posts.map(p => p.author).filter(Boolean))];

    // 3. Query User collection by username
    const users = await User.find(
      { username: { $in: usernames } },
      'username name profilepic'
    ).lean();

    const userMap = {};
    users.forEach(user => {
      userMap[user.username] = {
        username: user.username,
        name: user.name,
        profilepic: user.profilepic
      };
    });

    // 4. Attach authorInfo to each post
    const results = posts.map(p => ({
      title: p.title,
      postId:p._id,
      fileId: p.media?.[0]?.fileId2 || null,
      tags: p.tags || [],
      author: p.author,
      authorInfo: userMap[p.author] || null
    }));
    res.json({ 
      posts: results,
      hasMore: posts.length === limit
    });
  } catch (err) {
    next(err);
  }
});

router.get('/file', async (req, res) => {
  const { fileId } = req.query;
  if (!fileId) {
    return res.status(400).json({ message: 'fileId required' });
  }
  try {
    const telegramResp = await axios.get(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN2}/getFile`,
      { params: { file_id: fileId } }
    );

    if (!telegramResp.data.ok) {
      return res.status(404).json({ message: 'File not found' });
    }

    const filePath = telegramResp.data.result.file_path;
    const ext      = filePath.split('.').pop().toLowerCase();
    const type     = ['mp4', 'mov', 'avi'].includes(ext) ? 'video' : 'image';

    return res.json({
      type,
      url: `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN2}/${filePath}`
    });
  } catch (error) {
    console.error('Telegram file fetch error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});

router.get('/notifications', (req, res) => {
    if (!req.session.user) {
      return res.redirect('/auth/login');
    }
    res.render('features/notifications',{ user: req.session.user});
});

router.get('/api/notifications', async (req, res) => {
    try {
      const user = await User.findById(req.session.user._id);
      if (!user) return res.status(404).json({ error: "User not found" });
  
      // Process notifications
      const notifications = user.notifications || [];
      const finalNotifications = [
        ...notifications.filter(n => n.status === "Unread").sort((a, b) => b.time - a.time),
        ...notifications.filter(n => n.status === "Read").sort((a, b) => b.time - a.time)
      ];
  
      // Send response first
      res.json({ notifications: finalNotifications });
  
      // Update read status after response
      await User.updateOne(
        { _id: user._id },
        { $set: { "notifications.$[].status": "Read" } }
      );
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
});

router.get('/notification/image', async (req, res) => {
    const { fileId } = req.query;
    try {
      if (!fileId) return res.status(400).json({ message: 'fileId required' });
  
      if (fileId === "Follow Button required") {
        return res.json({ 
          type: 'button',
          url: "/path/to/follow_button.png" 
        });
      }
  
      // Get file info from Telegram
      const response = await axios.get(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`
      );
  
      if (response.data.ok) {
        const filePath = response.data.result.file_path;
        const ext = filePath.split('.').pop().toLowerCase();
        const type = ['mp4', 'mov', 'avi'].includes(ext) ? 'video' : 'image';
        return res.json({
          type,
          url: `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`
        });
      }
      
      return res.status(404).json({ message: 'File not found' });
    } catch (error) {
      res.status(500).json({ message: 'Server error' });
    }
});





const getTelegramFilePath = async (fileId) => {
    const maxRetries = 3;
    let retryCount = 0;

    while (retryCount < maxRetries) {
        try {
            
            const response = await axios.get(
                `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`,
                { timeout: 5000 } // 5-second timeout
            );
            return response.data.result.file_path;
        }
        catch (error) {
            if (retryCount === maxRetries - 1) {
                console.error(`Final attempt failed for ${fileId}:`, error.message);
                return null;
            }
            console.log(`Retrying ${fileId} (attempt ${retryCount + 1})`);
            await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1))); // Exponential backoff
            retryCount++;
        }
    }
};

// Map images by postId with concurrency control
const mapImagesByPostIdAsync = async (images) => {
    const processImage = async (image) => {
        try {
            const filePath = await limit(() => getTelegramFilePath(image.fileId));
            return { ...image, filePath };
        } catch (error) {
            console.log(`Error fetching file path for ${image.fileId}`);
            return image; // Return the original image if fetching fails
        }
    };

    const refreshedImages = await Promise.all(images.map(image => processImage(image)));

    // Group the refreshed images by postId
    const imagesByPostId = refreshedImages.reduce((acc, image) => {
        if (!acc[image.postId]) {
            acc[image.postId] = [];
        }
        const src = image.filePath
            ? `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${image.filePath}`
            : `/api/images/${image.fileId}`; // Fallback to local API if filePath is null
        acc[image.postId].push({
            fileId: image.fileId,
            caption: image.caption,
            src,
        });
        return acc;
    }, {});

    return imagesByPostId;
};




module.exports = router;
