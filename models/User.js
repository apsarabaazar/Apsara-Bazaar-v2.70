const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    username:{type:String ,required:true},
    email: { type: String, required: true,
        validate: {
            validator: function(v) {
                return /@gmail\.com$/.test(v);
            },
            message: props => `${props.value} is not a valid Gmail address!`
        }
    },
    password: { type: String, required: true }, // No encryption
    rooms: { type: String, default: '' },
    rank:{type:String,required:true},
    likes:{type:Array , required:false},
    saves:{type:Array , required:false},
    notifications: [{
        message: { type: String, default: "" },
        img: { type: String, default: "NotFound" },
        status: { type: String, default: "Unread" },
        time: { type: Date, default: Date.now },
        postId: { type: mongoose.Schema.Types.ObjectId, default: null } // <- Add this line
      }],      
    followers:{type:Array , required:false,default:[]},
    following:{type:Array , required:false,default:[]},
    coins:{type:Number ,default:0},
    profilepic: { type: Number, default: () => Math.floor(Math.random() * 6) + 1 },
});

module.exports =mongoose.model('User', UserSchema);