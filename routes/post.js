// routes/post.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const TelegramBot = require('node-telegram-bot-api');

const Post = require('../models/Post');
const User = require('../models/User');
const Image = require('../models/Image');
const Comments = require('../models/Comment');



const axios = require('axios');
const { pipeline } = require("stream");
const upload = multer().array('images', 10);

const compression = require('compression');
router.use(compression()); // Add at top of middleware chain

const https = require('https');
const bot2 = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN2);



router.get("/comments/:postId", async (req, res) => {
  if (!req.session.user) {
    // User not authenticated; send 401 status
    return res.status(401).json({ message: 'User not authenticated' });
  }

  const postId = req.params.postId;

  try {
    // Find the post by postId
    const post = await Post.findById(postId).exec();
    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    // Find comments associated with the postId
    const comments = await Comments.find({ postId }).exec();

    // Fetch images associated with the post

    // 3. If no embedded media, fall back to Image collection
    let mediaRecords = post.media;
    let imageData;
    if (!Array.isArray(mediaRecords) || mediaRecords.length === 0) {
      // Fetch images associated with the post
    const images = await Image.find({ postId }).exec();
    imageData = images.map(img => ({
      fileId: img.fileId,
      caption: img.caption,
      src: `/post/images/${img.fileId}` // Endpoint for serving images
    }));
    }
    //If Post Media Detail Present
    else{
      imageData = await Promise.all(mediaRecords.map(async m => {
        let effectiveFileId, chosenBotToken;
        if (m.fileId2) {
          if (Math.random() < 0.5) {
            effectiveFileId = m.fileId;
            chosenBotToken = process.env.TELEGRAM_BOT_TOKEN;
          } else {
            effectiveFileId = m.fileId2;
            chosenBotToken = process.env.TELEGRAM_BOT_TOKEN2;
          }
        } else {
          effectiveFileId = m.fileId;
          chosenBotToken = process.env.TELEGRAM_BOT_TOKEN;
        }
  
        // fetch current file_path
        let filePath;
        try {
          filePath = await getFilePathWithToken(effectiveFileId, chosenBotToken);
        } catch (err) {
          console.error("getFilePath failed for", effectiveFileId, err);
        }
  
        // build src: Telegram URL if we got a path, otherwise fallback to local route
        const src = filePath
          ? `https://api.telegram.org/file/bot${chosenBotToken}/${filePath}`
          : `/post/images/${m.fileId}`;
  
        return {
          fileId:  m.fileId,
          fileId2: m.fileId2,
          caption: m.caption,
          src
        };
      }));

    }


    


    let user = null;
    if (req.session.user) {
      user = await User.findById(req.session.user._id).lean().exec();
    }
    let author=post.author;
    const authoruser = await User.find({ username:author}).select('username profilepic rank')
    const authorpic = authoruser.length > 0 ? authoruser[0].profilepic : null;
    const badges = {
      "Admin": "👑",          // Crown
      "Moderator": "🛡️",      // Shield
      "Elite Member": "🌟",   // Star
      "Gold Member": "✨",     // Sparkle
      "Fapper":"",
  };
    let authorbadge=badges[authoruser[0].rank];
    const postObject = post.toObject(); // Convert Mongoose doc to plain JS object
    postObject.authorpic = authorpic;
    postObject.authorbadge=authorbadge;

    // If user is authenticated and post is found, render the comment page
    res.render("comment", { post:postObject, images: imageData, user, comments });
  } catch (error) {
    console.error("Error fetching comments:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

router.post("/comments/:postId/new", async (req, res) => {
  const postId = req.params.postId;
  const { commentBody } = req.body;

  if (!req.session.user) {
    return res.status(401).send("User not authenticated");
  }

  try {
    const commenterUsername = req.session.user.username;

    // 1. Save the new comment
    const newComment = new Comments({
      postId,
      Author: commenterUsername,
      body: commentBody,
    });
    await newComment.save();

    // 2. Increment comment count
    await Post.findByIdAndUpdate(postId, { $inc: { comments: 1 } });

    // 3. Fetch post details
    const post = await Post.findById(postId);
    if (!post) return res.status(404).send("Post not found");

    const postAuthorUsername = post.author;
    const postMediaImg = (post.media && post.media.length > 0) ? post.media[0].fileId : "NotFound";

    // Avoid notifying self
    if (postAuthorUsername !== commenterUsername) {
      const authorUser = await User.findOne({ username: postAuthorUsername });

      if (authorUser) {
        // Find existing comment notification for the same post
        const existingNotificationIndex = authorUser.notifications.findIndex(n =>
          n.postId?.toString() === postId && n.message.endsWith("commented on your post.")
        );

        if (existingNotificationIndex !== -1) {
          let oldMessage = authorUser.notifications[existingNotificationIndex].message;
          let usernames = oldMessage.replace(" commented on your post.", "").split(",");

          usernames = [commenterUsername, ...usernames.filter(u => u !== commenterUsername)].slice(0, 3);

          authorUser.notifications[existingNotificationIndex].message = `${usernames.join(",")} commented on your post.`;
          authorUser.notifications[existingNotificationIndex].status = "Unread";
          authorUser.notifications[existingNotificationIndex].time = new Date();
          authorUser.notifications[existingNotificationIndex].img = postMediaImg;

          await authorUser.save();
        } else {
          // Create new notification
          const newNotification = {
            message: `${commenterUsername} commented on your post.`,
            img: postMediaImg,
            status: "Unread",
            time: new Date(),
            postId: post._id,
          };

          await User.updateOne(
            { _id: authorUser._id },
            { $push: { notifications: { $each: [newNotification], $slice: -100 } } }
          );
        }
      }
    }

    // 4. Redirect after successful comment
    res.redirect(`/post/comments/${postId}`);
  } catch (error) {
    console.error("Error adding comment:", error);
    res.status(500).send("Internal Server Error");
  }
});


router.post("/comments/:postId/reply", async (req, res) => {
  const postId = req.params.postId;
  const { parentCommentId, replyBody } = req.body;

  if (!req.session.user) {
    return res.status(401).send("User not authenticated");
  }

  try {
    const replierUsername = req.session.user.username;

    // 1. Find parent comment
    const parentComment = await Comments.findById(parentCommentId);
    if (!parentComment) {
      return res.status(404).send("Parent comment not found");
    }

    // 2. Push reply
    const reply = {
      username: replierUsername,
      content: replyBody
    };
    parentComment.subBody.push(reply);
    await parentComment.save();

    // 3. Increment post comment count
    await Post.findByIdAndUpdate(postId, { $inc: { comments: 1 } });

    // 4. Fetch Post
    const post = await Post.findById(postId);
    if (!post) return res.status(404).send("Post not found");

    const postMediaImg = (post.media && post.media.length > 0) ? post.media[0].fileId : "NotFound";

    // --- NOTIFY POST AUTHOR (same logic as comment) ---
    if (post.author !== replierUsername) {
      const postAuthor = await User.findOne({ username: post.author });
      if (postAuthor) {
        const existingNotificationIndex = postAuthor.notifications.findIndex(n =>
          n.postId?.toString() === postId && n.message.endsWith("commented on your post.")
        );

        if (existingNotificationIndex !== -1) {
          let oldMessage = postAuthor.notifications[existingNotificationIndex].message;
          let usernames = oldMessage.replace(" commented on your post.", "").split(",");

          usernames = [replierUsername, ...usernames.filter(u => u !== replierUsername)].slice(0, 3);

          postAuthor.notifications[existingNotificationIndex].message = `${usernames.join(",")} commented on your post.`;
          postAuthor.notifications[existingNotificationIndex].status = "Unread";
          postAuthor.notifications[existingNotificationIndex].time = new Date();
          postAuthor.notifications[existingNotificationIndex].img = postMediaImg;

          await postAuthor.save();
        } else {
          const newNotification = {
            message: `${replierUsername} commented on your post.`,
            img: postMediaImg,
            status: "Unread",
            time: new Date(),
            postId: post._id
          };

          await User.updateOne(
            { _id: postAuthor._id },
            { $push: { notifications: { $each: [newNotification], $slice: -100 } } }
          );
        }
      }
    }

    // --- NOTIFY COMMENT AUTHOR ---
    if (parentComment.Author !== replierUsername) {
      const commentAuthor = await User.findOne({ username: parentComment.Author });

      if (commentAuthor) {
        const replyNotification = {
          message: `${replierUsername} replied to your comment.`,
          img: postMediaImg,
          status: "Unread",
          time: new Date(),
          postId: post._id
        };

        await User.updateOne(
          { _id: commentAuthor._id },
          { $push: { notifications: { $each: [replyNotification], $slice: -100 } } }
        );
      }
    }

    // Done
    console.log("Reply to Comment Added:", reply);
    res.redirect(`/post/comments/${postId}`);
  } catch (error) {
    console.error("Error adding reply:", error);
    res.status(500).send("Internal Server Error");
  }
});


const filePathCache = new Map();

// Function to cache file_path with associated bot token
function cacheFilePath(effectiveFileId, filePath, botToken) {
  filePathCache.set(effectiveFileId, { filePath, timestamp: Date.now(), botToken });
}

// Function to get cached file_path if valid and if the cached botToken matches
function getCachedFilePathWithToken(effectiveFileId, botToken) {
  const cached = filePathCache.get(effectiveFileId);
  if (
    cached &&
    Date.now() - cached.timestamp < 30 * 60 * 1000 && // 30 minutes
    cached.botToken === botToken
  ) {
    return cached.filePath;
  }
  return null; // Cache expired, not found, or token mismatch
}

// Function to fetch a fresh file_path from Telegram using a given bot token
async function fetchFreshFilePath(fileId, botToken) {
  try {
    const response = await axios.get(
      `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`
    );
    return response.data.result.file_path;
  } catch (error) {
    console.error(`Error fetching file path for ${fileId} with token ${botToken}:`, error);
    return null; // Return null if fetching fails
  }
}

// Function to get file_path (cached or fresh) using effectiveFileId and botToken
async function getFilePathWithToken(effectiveFileId, botToken) {
  let filePath = getCachedFilePathWithToken(effectiveFileId, botToken); // Check cache first
  if (!filePath) {
    filePath = await fetchFreshFilePath(effectiveFileId, botToken); // Fetch fresh if not cached
    if (filePath) {
      cacheFilePath(effectiveFileId, filePath, botToken); // Cache the new file_path with botToken
    }
  }
  return filePath;
}

// router.get("/details/:postId", async (req, res) => {
//   let user = null;
//   user = await User.findById(req.session.user._id).exec();
//   console.log(user.email)
//   try {
//     const { postId } = req.params;

//     // Fetch post and images from the database
//     const [post, images] = await Promise.all([
//       Post.findById(postId),
//       Image.find({ postId })
//     ]);

//     if (!post) return res.status(404).json({ error: "Post not found" });

//     // Process each image record
//     const imageData = await Promise.all(
//       images.map(async (img) => {
//         let effectiveFileId, chosenBotToken;

//         // If fileId2 exists, randomly choose between fileId and fileId2
//         if (img.fileId2) {
//           if (Math.random() < 0.5) {
//             effectiveFileId = img.fileId;
//             chosenBotToken = process.env.TELEGRAM_BOT_TOKEN;
//           } else {
//             effectiveFileId = img.fileId2;
//             chosenBotToken = process.env.TELEGRAM_BOT_TOKEN2;
//           }
//         } else {
//           // If fileId2 is not available, fallback to fileId
//           effectiveFileId = img.fileId;
//           chosenBotToken = process.env.TELEGRAM_BOT_TOKEN;
//         }

//         // Use the chosen effectiveFileId and bot token to fetch the file_path
//         let filePath = await getFilePathWithToken(effectiveFileId, chosenBotToken);
//         if (!filePath) {
//           console.error(`Failed to fetch file path for ${effectiveFileId}`);
//           return { ...img, src: `/post/images/${img.fileId}` }; // Fallback route
//         }

//         // Validate that the file_path is still valid by sending a HEAD request
//         try {
//           const imageUrl = `https://api.telegram.org/file/bot${chosenBotToken}/${filePath}`;
//           await axios.head(imageUrl);
//           return { ...img, effectiveFileId, filePath, src: imageUrl, usedBotToken: chosenBotToken };
//         } catch (error) {
//           console.error(`File path expired for ${effectiveFileId}`);
//           const freshFilePath = await fetchFreshFilePath(effectiveFileId, chosenBotToken); // Fetch a fresh file_path
//           if (freshFilePath) {
//             cacheFilePath(effectiveFileId, freshFilePath, chosenBotToken); // Update cache
//             return {
//               ...img,
//               effectiveFileId,
//               filePath: freshFilePath,
//               src: `https://api.telegram.org/file/bot${chosenBotToken}/${freshFilePath}`,
//               usedBotToken: chosenBotToken
//             };
//           } else {
//             return { ...img, src: `/post/images/${img.fileId}` }; // Fallback route
//           }
//         }
//       })
//     );

//     // Fetch user data if logged in
//     let user = null;
//     if (req.session.user) {
//       user = await User.findById(req.session.user._id).lean().exec();
//     }

//     let author=post.author;
//     const authoruser = await User.find({ username:author}).select('username profilepic rank')
//     const authorpic = authoruser.length > 0 ? authoruser[0].profilepic : null;
//     const badges = {
//       "Admin": "👑",          // Crown
//       "Moderator": "🛡️",      // Shield
//       "Elite Member": "🌟",   // Star
//       "Gold Member": "✨",     // Sparkle
//       "Fapper":"",
//   };
//     let authorbadge=badges[authoruser[0].rank];
   
//     const postObject = post.toObject(); // Convert Mongoose doc to plain JS object
//     postObject.authorpic = authorpic;
//     postObject.authorbadge=authorbadge;
     
//     // Set Cache-Control header for client-side caching (1 week)
//     res.setHeader('Cache-Control', 'public, max-age=604800'); // 1 week in seconds

//     // Render the post details page with the image data
//     res.render("post-details", {
//       post:postObject,
//       images: imageData,
//       user
//     });
//     console.log("Trying to put fileId2")
//     // After sending the response, handle the duplication process for images without fileId2
//     images.forEach(async (img) => {
//       if (!img.fileId2) {
//         try {
//           // First, fetch the file_path for img.fileId using bot1's token.
//           const filePath = await fetchFreshFilePath(img.fileId, process.env.TELEGRAM_BOT_TOKEN);
//           if (!filePath) {
//             throw new Error("Could not fetch file path for duplication");
//           }
//           console.log(filePath);
//           // Construct the URL to access the full image via bot1's token.
//           const imageUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`;
//           // Download the image data as a buffer using axios.
//           const axiosResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
//           const imageBuffer = axiosResponse.data;
//           // Use bot2 to send the image using the downloaded buffer.
//           const dupMsg = await bot2.sendPhoto(process.env.TELEGRAM_GROUP_ID2, imageBuffer);

//           // Telegram returns an array of PhotoSize objects in dupMsg.photo.
//           const photos = dupMsg.photo;
//           if (photos && photos.length > 0) {
//             // Choose the highest resolution file_id (typically the last one).
//             const newFileId = photos[photos.length - 1].file_id;
//             img.fileId2 = newFileId;
//             // Update the database record with the new fileId2
//             await Image.findByIdAndUpdate(img._id, { fileId2: newFileId });
//           }
//         } catch (error) {
//           console.error(`Error duplicating image for ${img.fileId}`);
//           // If duplication fails, continue using the primary fileId.
//         }
//       }
//     });

//     // Build the media array from the images
//     if (
//       post.media &&
//       Array.isArray(post.media) &&
//       post.media.length > 0 &&
//       post.media.every(mediaItem => mediaItem.type && mediaItem.fileId && mediaItem.fileId2 && mediaItem.messageId)
//     ){
//       console.log("Media Detail already present in post")
//     }
//     else{
//       console.log("Trying to update new Post Setup")
//       const mediaDetails = images.map(image => {
//         if (!image.fileId)
//           { return null;}
//         return {
//           type: "photo",                   // Always photo, adjust if necessary
//           fileId: image.fileId,
//           fileId2: image.fileId2 || "",
//           messageId: image.caption || ""
//         };
//       }).filter(Boolean); // Remove any null entries
      
//       post.media = mediaDetails;
//       await post.save();

//     }
//   } catch (error) {
//     console.error("Error fetching post details:");
//     res.status(500).json({ error: "Internal Server Error" });
//   }
// });


router.get("/details/:postId", async (req, res) => {
  try {
    // 1. Auth check
    // if (!req.session.user) return res.redirect("/login");
    let user=null;
    if(req.session.user)
    user = await User.findById(req.session.user._id).lean();

    // 2. Load post
    const { postId } = req.params;
    let post = await Post.findById(postId).lean();
    if (!post) return res.status(404).render("404", { message: "Post not found" });

    // 3. If no embedded media, fall back to Image collection
    let mediaRecords = post.media;
    let imageData;
    if (!Array.isArray(mediaRecords) || mediaRecords.length === 0) {
      // Fetch images associated with the post
    const images = await Image.find({ postId }).exec();
    imageData = images.map(img => ({
      fileId: img.fileId,
      caption: img.caption,
      src: `/post/images/${img.fileId}` // Endpoint for serving images
    }));
    }
    //If Post Media Detail Present
    else{
      imageData = await Promise.all(mediaRecords.map(async m => {
        let effectiveFileId, chosenBotToken;
        if (m.fileId2) {
          if (Math.random() < 0.5) {
            effectiveFileId = m.fileId;
            chosenBotToken = process.env.TELEGRAM_BOT_TOKEN;
          } else {
            effectiveFileId = m.fileId2;
            chosenBotToken = process.env.TELEGRAM_BOT_TOKEN2;
          }
        } else {
          effectiveFileId = m.fileId;
          chosenBotToken = process.env.TELEGRAM_BOT_TOKEN;
        }
  
        // fetch current file_path
        let filePath;
        try {
          filePath = await getFilePathWithToken(effectiveFileId, chosenBotToken);
        } catch (err) {
          console.error("getFilePath failed for", effectiveFileId, err);
        }
  
        // build src: Telegram URL if we got a path, otherwise fallback to local route
        const src = filePath
          ? `https://api.telegram.org/file/bot${chosenBotToken}/${filePath}`
          : `/post/images/${m.fileId}`;
  
        return {
          fileId:  m.fileId,
          fileId2: m.fileId2,
          caption: m.caption,
          src
        };
      }));

    }

    // 5. Load author info & badge
    const authorUser = await User.findOne({ username: post.author })
                                 .select("profilepic rank")
                                 .lean();
    const badges = {
      Admin:       "👑",
      Moderator:   "🛡️",
      "Elite Member": "🌟",
      "Gold Member":   "✨",
      Fapper:      ""
    };

    // 6. Render
    res.setHeader("Cache-Control", "public, max-age=604800");
    res.render("post-details", {
      user,
      post: {
        ...post,
        authorpic:   authorUser?.profilepic || null,
        authorbadge: badges[authorUser?.rank] || ""
      },
      images: imageData
    });

  } catch (err) {
    console.error("Error in GET /details/:postId", err);
    res.status(500).render("500", { message: "Internal Server Error" });
  }
});









router.get("/images/:fileId", async (req, res) => {
  const { fileId } = req.params;

  try {
    // 1. Try to find image in database
    let image = await Image.findOne({ fileId });
    
    // 2. If image doesn't exist at all
    if (!image) {
      return res.status(404).send("Image not found");
    }

    // 3. If image exists but lacks filePath
    if (!image.filePath || image.filePath) {
      console.log(`Fetching filePath for ${fileId} from Telegram...`);
      const response = await axios.get(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`
      );
      
      // 4. Extract and save filePath to DB
      image.filePath = response.data.result.file_path;
      await image.save();
      console.log(`Updated filePath for ${fileId} in database`);
    }

    // 5. Stream using either existing or newly stored filePath
    const imageUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${image.filePath}`;
    
    // 6. Stream with native HTTPS for better performance
    https.get(imageUrl, (telegramRes) => {
      // Set dynamic Content-Type based on file extension
      const extension = image.filePath.split('.').pop();
      res.setHeader("Content-Type", `image/${extension === 'jpg' ? 'jpeg' : extension}`);
      
      telegramRes.pipe(res);
    }).on('error', (err) => {
      console.error("Stream error:");
      if (!res.headersSent) res.status(500).send("Failed to fetch image");
    });

  } catch (error) {
    console.error("Error in image retrieval:");
    
    // Handle specific Telegram API errors
    if (error.response?.data?.description?.includes("file not found")) {
      if (!res.headersSent) res.status(404).send("Image not found on Telegram");
      return;
    }

    if (!res.headersSent) {
      res.status(500).send("Internal Server Error");
    }
  }
});

// Save/Unsave User Post
router.post('/save/:postId', async (req, res) => {
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

      // 2. Check if post is already saved
      const user = await User.findById(userId);
      const isAlreadySaved = user.saves.includes(postId);

      if (isAlreadySaved) {
          // 3. If already saved, REMOVE the post
          await User.updateOne(
              { _id: userId },
              { $pull: { saves: postId } }
          );
          return res.status(200).json({ message: 'Post unsaved successfully.' });
      } else {
          // 4. If not saved, ADD the post and enforce 4000 limit
          await User.updateOne(
              { _id: userId },
              {
                  $push: {
                      saves: {
                          $each: [postId],
                          $slice: -4000 // Keep only the last 4000 entries
                      }
                  }
              }
          );
          return res.status(200).json({ message: 'Post saved successfully.' });
      }

  } catch (error) {
      console.error("Error in Save");
      res.status(500).json({ message: 'Error toggling save', error });
  }
});


router.post('/delete/:postId', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ message: 'User not authenticated' });
  }

  const postId = req.params.postId;
  
  const userId = req.session.user.username;

  try {
  
    // 1. Find and validate post
    const post = await Post.findById(postId);
    
    if (!post) return res.status(404).json({ message: 'Post not found' });
   
    if (post.author !== userId) return res.status(403).json({ message: 'Unauthorized' });
   
    // 2. Delete post and comments in parallel for faster execution
    const [deletedPost, deletedComments] = await Promise.all([
      Post.findByIdAndDelete(postId),
      Comments.deleteMany({ postId: postId })
    ]);
   

    // 3. If using file storage, add your cleanup logic here
    
    res.status(200).json({ 
      success: true,
      message: 'Post and all comments deleted successfully',
      deleted: {
        postId: postId,
        commentsDeleted: deletedComments.deletedCount
      }
    });

  } catch (error) {
    console.error('Delete post error:');
    res.status(500).json({ 
      success: false,
      message: 'Error during deletion process',
      error: error.message
    });
  }
});




module.exports = router;
