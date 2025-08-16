const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique:true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  firstName: {
    type: String,
    trim: true,
    maxlength: 50
  },
  lastName: {
    type: String,
    trim: true,
    maxlength: 50
  },
  dob: {
    type: Date
  },
  location: {
    type: String
  },
  travelStyle: {
    type: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  bio: {
    type: String,
    maxlength: 100,
    trim: true
  },
  profilePicture: {
    type: String,
    default: '' // Default profile picture
  },
  isPublic: {
    type: Boolean,
    default: true // Default to public profile
  },
  followers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  followings: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  trips: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Trip' }],
  reviews: {
    type: Number, // Leave as Number for now, but will have to change to Object later when we create reviewSchema Model!
    default: 0
  },
  likedTrips: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Trip' }],
  savedPosts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Post' }],
  savedTrips: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Trip' }],
  savedItineraries: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Itinerary' }],
});

module.exports = mongoose.model('User', userSchema);
// This code defines a Mongoose schema and model for a User entity.