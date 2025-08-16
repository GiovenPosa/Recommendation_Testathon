const mongoose = require('mongoose');
const { validate } = require('./User');

const tripSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  destination: {
    type: String,
    required: true,
    trim: true
  },
  coverImage: {
    type: String,
    default: '' // Default to no cover image
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true,
    validate: {
      validator: function(value) {
        return value > this.startDate; // Ensure endDate is after startDate
      },
      message: 'End date must be after start date'
    }
  },
  description: {
    type: String,
    trim: true,
    maxlength: 500
  },
  tags: [{
    type: String,
    required: true
  }],
  budget: {
    type: Number,
    required: true,
    min: 0
  },
  posts: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Post'
    }
  ],
  reviews: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Review'
    }
  ],
  taggedUsers: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  ],
  isPublic: {
    type: Boolean,
    default: true // Default to public trips
  },
  likes: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  ],
  savedBy: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  ],
  comments: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Comment'
    }
  ],
  repostCount: [{  
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
},
{
  timestamps: true // Automatically adds createdAt and updatedAt fields
});

module.exports = mongoose.model('Trip', tripSchema);