const { MongoClient } = require('mongodb');
const mongoose = require('mongoose');
const User = require('./modals/User');
const Trip = require('./modals/Trip');
const { faker } = require('@faker-js/faker');
const { Types } = mongoose;
const bycrypt = require('bcryptjs');

const MONGO_URI = 'mongodb+srv://appuser1:appuser1@cluster0.jxzjzuo.mongodb.net/recommendation_dataset?retryWrites=true&w=majority&appName=Cluster0';

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


const user_id = new Types.ObjectId();
const cohesionScore = 1;
const likePools = ['romantic', 'budget'];
const travelStyle = 'budget';
const trip1 = {
  userId: user_id,
  title: title1,
  destination: destination1,
  startDate: startDate1,
  endDate: endDate1,
  tags: [
    " ", 
    " ", 
  ],
  budget: budget1,
}

const user = {
  _id: user_id,
  email: faker.internet.email().toLowerCase(),
  password: bycrypt.hash('password123', 10).toString(),
  travelStyle: travelStyle,
  followers: [],
  trips: [],
};

const MAX_FOLLOWINGS = 20;

const seedUserFollowings = async () => {
  console.log('seeding followings.... ')
  await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
    });
  const users = await User.find({})

  const matchedPool = findMatchingPool(user.travelStyle);
  if (!matchedPool) {
    console.log(`No matching pool for ${user.travelStyle}`);
    return;
  }
  console.log('>>>>> matching travel style pool for:', matchedPool);

  // 3. Build candidate users for followings
  const candidates = users.filter(u => u._id.toString() !== user._id.toString());

  const samePoolUsers = candidates.filter(u => {
      const otherPool = findMatchingPool(u.travelStyle);
    return otherPool && matchedPool.tags.some(tag => otherPool.tags.includes(tag));
  });

  const differentPoolUsers = candidates.filter(u => !samePoolUsers.includes(u));
  const samePoolFollowingsCount = Math.round((cohesionScore / 5) * MAX_FOLLOWINGS);
  const differentPoolFollowingsCount = MAX_FOLLOWINGS - samePoolFollowingsCount;
  const shuffledSamePool = faker.helpers.shuffle(samePoolUsers).slice(0, samePoolFollowingsCount);
  const shuffledDifferentPool = faker.helpers.shuffle(differentPoolUsers).slice(0, differentPoolFollowingsCount);

  const followings = [...shuffledSamePool, ...shuffledDifferentPool].map(u => u._id);

  await mongoose.disconnect();
  console.log("user now have seeded followings: ", followings);
  return followings;
};

// const userFollowings = seedUserFollowings();

const findMatchingPool = (travelStyle) => {
  for (const pool of themePool) {
    if (pool.pool.toLowerCase() === travelStyle?.toLowerCase()) {
      return pool;
    }
  }
  return null;
};

const LIKE_CAP = 100;
const SAVE_CAP = 70;

const seedUserInteractions = async (pools = likePools, LIKE_CAP = 100, SAVE_CAP = 70 ) => {
  console.log('seeding interactions...')
  await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
    });

  const trips = await Trip.find({})
  const poolsResolved = pools
    .map(p => findMatchingPool(p))
    .filter(Boolean);
    console.log('>>> returning matched pools')
  
  if (poolsResolved.length == 0) {
    console.log('No valid pools provided: ', pools);
    await mongoose.disconnect();
    return;
  }

  console.log('>>>> distributing counts x2')
  const likeSplit = distributeCounts(LIKE_CAP, poolsResolved.length);
  const saveSplit = distributeCounts(SAVE_CAP, poolsResolved.length);

  const alreadyLiked = new Set((user.likedTrips || []).map(t => String(t._id || t)));
  const alreadySaved = new Set((user.savedTrips || []).map(t => String(t._id || t)));
  const chosenForLike = new Set();
  const chosenForSave = new Set();

  const likeSelections = [];
  const saveSelections = [];

  console.log('>>>> jumping in the pools now ---')
  poolsResolved.forEach((pool, idx) => {
    const poolTags = new Set(pool.tags.map(t => t.toLowerCase()));

    const poolTrips = trips.filter(trip => {
      if (String(trip.userId) === String(user._id)) return false;
      const tripTags = (trip.tags || []).map(t => String(t).toLowerCase());
      return tripTags.some( t=> poolTags.has(t));
    });

    console.log('..finding unique trips in pool:', pool.pool)
    const likeTargets = sampleUnique(
      poolTrips,
      likeSplit[idx],
      new Set([...alreadyLiked, ...chosenForLike])
    );
    likeTargets.forEach(t => chosenForLike.add(String(t._id)));
    likeSelections.push(...likeTargets.map(t => t._id));

    const saveTargets = sampleUnique(
      poolTrips,
      saveSplit[idx],
      new Set([...alreadySaved, ...chosenForSave])
    );
    saveTargets.forEach(t => chosenForSave.add(String(t._id)));
    saveSelections.push(...saveTargets.map(t => t._id));
  });

  console.log('--- finished <<<<<')
  console.log('=== initialising interactions ====')
  const tripOps = [
    ...Array.from(chosenForLike).map(tripId => ({
      updateOne: {
        filter: { _id: tripId },
        update: { $addToSet: { likes: user._id } }
      }
    })),
    ...Array.from(chosenForSave).map(tripId => ({
      updateOne: {
        filter: { _id: tripId },
        update: { $addToSet: { savedBy: user._id } }
      }
    })),
  ];

  if (tripOps.length) {
    await Trip.bulkWrite(tripOps, { ordered: false });
  }

  console.log(`Liked ${likeSelections.length} trips and saved ${saveSelections.length} trips for user ${user._id}`);
  await mongoose.disconnect();
  return { likeSelections, saveSelections };
}

const distributeCounts = (total, k) => {
  const base = Math.floor(total / k);
  const remainder = total % k;
  return Array.from({ length: k }, (_, i) => base + (i < remainder ? 1 : 0));
}

const sampleUnique = (arr, n, excludeSet) => {
  const filtered = arr.filter(x => !excludeSet.has(String(x._id || x)));
  const shuffled = faker.helpers.shuffle(filtered);
  return shuffled.slice(0, n);
}


const buildUserPreferenceProfile = async (user_id) => {

  try {
    await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
    });
    const user = await User.findById(user_id)
      .populate('savedTrips')
      .populate({
        path: 'trips',
        populate: { path: 'posts' }
      })
      .populate('followings');

    if (!user) {
      throw new Error('User not found');
    }

    // find all trips liked by the user and store trip IDs in 'likedTripsIds'
    const likedTrips = await Trip.find({ likes: user._id }, '_id');
    const likedTripsIds = likedTrips.map(trip => trip._id.toString());

    const preferenceProfile = {
      userId: user_id,
      travelStyle: user.travelStyle || null,
      location: user.location || null,
      followings: user.followings.map(f => f._id.toString()),
      savedTripsIds: [...user.savedTrips.map(st => st._id.toString())],
      likedTripsIds: likedTripsIds,
      avgBudget: null,
      recentDestinations: {},
      tags: {},
    };

    const recentTrips = [...user.trips];
    const budgets = [];
    const destinations = {};
    const tagCounts = {};
  

    for (const trip of recentTrips) {
      // tags aggregation
      if (Array.isArray(trip.tags)) {
        for (const tag of trip.tags) {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        }
      }

      // destination aggregation
      if (trip.destination) {
        destinations[trip.destination] = (destinations[trip.destination] || 0) + 1;
      }

      // budget aggregation 
      if (trip.budget) budgets.push(trip.budget);
    }

    // find median budget
    if (budgets.length > 0) {
      const sorted = budgets.sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      preferenceProfile.avgBudget =
        sorted.length % 2 === 0
          ? (sorted[mid - 1] + sorted[mid]) / 2
          : sorted[mid];
    }
 
    await mongoose.disconnect();
    preferenceProfile.recentDestinations = destinations;
    preferenceProfile.tags = tagCounts;
    console.log('PREFERENCE_PROFILE: ', preferenceProfile);
    return preferenceProfile;
    
  } catch (error) {
    console.log('Failed to build user preference profile: ', error.message);
    return null;
  }
};

const pushToRecommendationSystem = async () => {

}

const pushResultsToUI = async () => {

}


(async () => {
  const { likeSelections, saveSelections } = await seedUserInteractions(likePools, LIKE_CAP, SAVE_CAP);
  const { followings } = await seedUserFollowings();

  // Insert the user *now*, with the arrays we built
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  await User.create({
    ...user,                      // {_id, travelStyle, followers, followings, trips}
    likedTrips: likeSelections,
    savedTrips: saveSelections,
    followings: followings,
  });
  const returnedUser = await User.findById(user_id);
  console.log('user: ', returnedUser);
  await mongoose.disconnect();

  // Now this will work (user exists, with valid ObjectId)
  await buildUserPreferenceProfile(user_id);
})();

