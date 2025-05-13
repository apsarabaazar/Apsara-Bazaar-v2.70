const mongoose = require("mongoose");

const postSchema = new mongoose.Schema({
  title: {  type: String,required: true },

  bodyText: { type: String,required: true },
  author: {type: String,required: true},
  uploadTime: {type: Date, default: Date.now},
  status: { type: String, default: "Ok" },
  likes: {type: Number,default: 0 },
  comments: {type: Number,default: 0},
  tags: { type: [String],default: []},
  media: [{
    type: {type: String,enum: ["photo", "video"],default: "photo"},
    fileId: {type: String,required: true},
    fileId2: {type: String,default: ""},
    messageId: {type: String,default: null}
  }]
});

module.exports = mongoose.model("Post", postSchema);


