const { MongoClient } = require('mongodb');
const mongoose = require('mongoose');
const User = require('./modals/User');
const Trip = require('./modals/Trip');
const { faker } = require('@faker-js/faker');

const MONGO_URI = 'mongodb+srv://appuser1:appuser1@cluster0.jxzjzuo.mongodb.net/recommendation_dataset?retryWrites=true&w=majority&appName=Cluster0';
const client = new MongoClient(MONGO_URI);

const MAX_FOLLOWINGS = 30;

const themePool = [
  { pool: "solo", tags: ["Adventure", "Budget", "Camping", "Digital Nomad", "Hiking", "Photography", "Road Trip", "Solo", "Volunteering"] },
  { pool: "luxury", tags: ["Cruise", "Island Hopping", "Luxury", "Romantic", "Spa", "Wellness", "Relaxing", "Middle East"] },
  { pool: "foodie", tags: ["City Break", "Cooking Class", "Foodie", "Shopping", "Street Art"] },
  { pool: "digital nomad", tags: ["Asia", "Creative Retreat", "Digital Nomad", "Europe", "Photography", "Workation"] },
  { pool: "adventure", tags: ["Adventure", "Camping", "Desert", "Extreme Sports", "Hiking", "Mountains", "National Parks", "Wildlife Safari", "Water Sports", "Ski & Snowboard"] },
  { pool: "nature", tags: ["Beach", "Camping", "Eco Travel", "Forest", "Mountains", "National Parks", "Wildlife Safari", "Africa", "Oceania", "Pet-Friendly"] },
  { pool: "romantic", tags: ["Architecture", "Beach", "Island Hopping", "Luxury", "Romantic", "Spa", "Yoga Retreat"] },
  { pool: "budget", tags: ["Asia", "Backpacking", "Budget", "Europe", "Solo", "Study Abroad", "Weekend Getaway"] },
  { pool: "family", tags: ["Camping", "Christmas", "City Break", "Family", "National Parks", "Wildlife Safari"] },
  { pool: "culture", tags: ["Architecture", "Cultural", "Film Locations", "Historic Sites", "Language Learning", "Literary Travel", "Street Art", "Americas", "Middle East"] },
  { pool: "party", tags: ["Festival", "Group", "New Year", "Nightlife", "Party", "Summer"] },
  { pool: "seasonal", tags: ["Autumn", "Christmas", "Festival", "New Year", "Spring", "Summer", "Winter", "Ski & Snowboard", "Yoga Retreat"] },
];

const findMatchingPool = (travelStyle) => {
  for (const pool of themePool) {
    if (pool.pool.toLowerCase() === travelStyle?.toLowerCase()) {
      return pool;
    }
  }
  return null;
};

// Main seeding function
const seedFollowings = async () => {
  const users = await User.find({});

  for (const user of users) {
    // 1. Assign a random cohesion score (1-5)
    const cohesionScore = faker.number.int({ min: 1, max: 5 });

    // 2. Get matching pool for this user's travelStyle
    const matchedPool = findMatchingPool(user.travelStyle);

    if (!matchedPool) {
      console.log(`No matching pool for ${user.travelStyle}`);
      continue;
    }

    // 3. Build candidate users for followings
    const candidates = users.filter(u => u._id.toString() !== user._id.toString());

    const samePoolUsers = candidates.filter(u => {
      const otherPool = findMatchingPool(u.travelStyle);
      return otherPool && matchedPool.tags.some(tag => otherPool.tags.includes(tag));
    });

    const differentPoolUsers = candidates.filter(u => !samePoolUsers.includes(u));

    // 4. Weighted selection based on cohesionScore
    const samePoolFollowingsCount = Math.round((cohesionScore / 5) * MAX_FOLLOWINGS);
    const differentPoolFollowingsCount = MAX_FOLLOWINGS - samePoolFollowingsCount;

    const shuffledSamePool = faker.helpers.shuffle(samePoolUsers).slice(0, samePoolFollowingsCount);
    const shuffledDifferentPool = faker.helpers.shuffle(differentPoolUsers).slice(0, differentPoolFollowingsCount);

    const followings = [...shuffledSamePool, ...shuffledDifferentPool].map(u => u._id);

    user.followings = followings;
    await user.save();

    console.log(`User ${user._id} (score ${cohesionScore}) now follows ${followings.length} users`);
  }

  console.log("All users now have seeded followings");
  mongoose.disconnect();
};

const main = async () => {
  try {
    await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
    });
    console.log("✅ Connected to MongoDB");

    await seedFollowings(); // <-- your main seeding logic

    mongoose.disconnect();
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err);
    process.exit(1);
  }
};

const printFollowingsTravelStyles = async (userId) => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB");

    const user = await User.findById(userId)
      .populate({ path: 'trips', select: 'destination' })         // only need destination
      .populate({ path: 'followings', select: 'travelStyle _id' });

    if (!user) {
      console.log("User not found");
      return;
    }

    const destinations = (user.trips || [])
      .map(trip => trip.destination)
      .filter(Boolean);

    if (destinations.length === 0) {
      console.log("This user has no trips.");
    } else {
      console.log("Trip destinations:", destinations.join(", "));
    }

    if (!user.followings || user.followings.length === 0) {
      console.log("This user is not following anyone.");
      return;
    }

    console.log(`\nFollowings of user ${user._id} (TravelStyle: ${user.travelStyle}):\n`);

    user.followings.forEach((followedUser, i) => {
      console.log(` ${i + 1}. ${followedUser._id} - TravelStyle: ${followedUser.travelStyle}`);
    });
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await mongoose.disconnect();
  }
};

main();

// print a user followiings and trvvel styles
//const someUserId = '6897890b23dddc5760c29ff8'; // user _id
//printFollowingsTravelStyles(someUserId);


