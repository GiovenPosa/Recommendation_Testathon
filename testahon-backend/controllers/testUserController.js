// controllers/testUserController.js
const { Types } = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../modals/User');
const Trip = require('../modals/Trip');
const { buildUserPreferenceProfile } = require('./recommendationController');

// === theme pools (same as your script) ===
const themePool = [
  { pool: "solo", tags: ["Adventure","Budget","Camping","Digital Nomad","Hiking","Photography","Road Trip","Solo","Volunteering"] },
  { pool: "luxury", tags: ["Cruise","Island Hopping","Luxury","Romantic","Spa","Wellness","Relaxing","Middle East"] },
  { pool: "foodie", tags: ["City Break","Cooking Class","Foodie","Shopping","Street Art"] },
  { pool: "digital nomad", tags: ["Asia","Creative Retreat","Digital Nomad","Europe","Photography","Workation"] },
  { pool: "adventure", tags: ["Adventure","Camping","Desert","Extreme Sports","Hiking","Mountains","National Parks","Wildlife Safari","Water Sports","Ski & Snowboard"] },
  { pool: "nature", tags: ["Beach","Camping","Eco Travel","Forest","Mountains","National Parks","Wildlife Safari","Africa","Oceania","Pet-Friendly"] },
  { pool: "romantic", tags: ["Architecture","Beach","Island Hopping","Luxury","Romantic","Spa","Yoga Retreat"] },
  { pool: "budget", tags: ["Asia","Backpacking","Budget","Europe","Solo","Study Abroad","Weekend Getaway"] },
  { pool: "family", tags: ["Camping","Christmas","City Break","Family","National Parks","Wildlife Safari"] },
  { pool: "culture", tags: ["Architecture","Cultural","Film Locations","Historic Sites","Language Learning","Literary Travel","Street Art","Americas","Middle East"] },
  { pool: "party", tags: ["Festival","Group","New Year","Nightlife","Party","Summer"] },
  { pool: "seasonal", tags: ["Autumn","Christmas","Festival","New Year","Spring","Summer","Winter","Ski & Snowboard","Yoga Retreat"] },
];

// === helpers ===
const findMatchingPool = (travelStyle) =>
  themePool.find(p => p.pool.toLowerCase() === String(travelStyle||'').toLowerCase()) || null;

const distributeCounts = (total, k) => {
  if (k <= 0) return [];
  const base = Math.floor(total / k);
  const remainder = total % k;
  return Array.from({ length: k }, (_, i) => base + (i < remainder ? 1 : 0));
};

const sampleUnique = (arr, n, excludeSet) => {
  if (n <= 0) return [];
  const filtered = arr.filter(x => !excludeSet.has(String(x._id || x)));
  // light shuffle
  for (let i = filtered.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [filtered[i], filtered[j]] = [filtered[j], filtered[i]];
  }
  return filtered.slice(0, n);
};

// === subfunction: followings ===
async function seedUserFollowings({ userId, travelStyle, cohesionScore = 1, maxFollowings = 100 }) {
  const userObjectId = userId;
  const users = await User.find({}, { _id: 1, travelStyle: 1 });

  const matchedPool = findMatchingPool(travelStyle);
  if (!matchedPool) {
    console.log(`No matching pool for ${travelStyle}`);
    return [];
  }

  const candidates = users.filter(u => !u._id.equals(userObjectId));

  const samePoolUsers = candidates.filter(u => {
    const otherPool = findMatchingPool(u.travelStyle);
    return otherPool && matchedPool.tags.some(tag => otherPool.tags.includes(tag));
  });

  const differentPoolUsers = candidates.filter(u => !samePoolUsers.includes(u));

  const sameCount = Math.round((Math.max(0, Math.min(cohesionScore, 5)) / 5) * maxFollowings);
  const diffCount = Math.max(0, maxFollowings - sameCount);

  const followings = [
    ...sampleUnique(samePoolUsers, sameCount, new Set()),
    ...sampleUnique(differentPoolUsers, diffCount, new Set())
  ].map(u => u._id);

  // persist followings onto the user
  await User.updateOne({ _id: userObjectId }, { $set: { followings } });

  console.log(`Seeded ${followings.length} followings for ${userId}`);
  return followings;
}

// === subfunction: likes & saves ===
async function seedUserInteractions({
  userId,
  likePools = [],
  likeCap = 100,
  saveCap = 70,
}) {
  const userObjectId = userId;
  const poolsResolved = likePools.map(findMatchingPool).filter(Boolean);
  if (poolsResolved.length === 0) {
    console.log('No valid likePools provided:', likePools);
    return { likeSelections: [], saveSelections: [] };
  }

  const allTrips = await Trip.find({}, { _id: 1, userId: 1, tags: 1 });

  // existing likes/saves by this user (if any)
  const userDoc = await User.findById(userObjectId, { likedTrips: 1, savedTrips: 1 }) || {};
  const alreadyLiked = new Set((userDoc.likedTrips || []).map(id => String(id)));
  const alreadySaved = new Set((userDoc.savedTrips || []).map(id => String(id)));

  const chosenForLike = new Set();
  const chosenForSave = new Set();

  const likeSplit = distributeCounts(likeCap, poolsResolved.length);
  const saveSplit = distributeCounts(saveCap, poolsResolved.length);

  poolsResolved.forEach((pool, idx) => {
    const poolTags = new Set(pool.tags.map(t => t.toLowerCase()));

    const poolTrips = allTrips.filter(trip => {
      if (String(trip.userId) === String(userObjectId)) return false; // don't like your own trip
      const tripTags = (trip.tags || []).map(t => String(t).toLowerCase());
      return tripTags.some(t => poolTags.has(t));
    });

    const likeTargets = sampleUnique(
      poolTrips,
      likeSplit[idx],
      new Set([...alreadyLiked, ...chosenForLike])
    );
    likeTargets.forEach(t => chosenForLike.add(String(t._id)));

    const saveTargets = sampleUnique(
      poolTrips,
      saveSplit[idx],
      new Set([...alreadySaved, ...chosenForSave])
    );
    saveTargets.forEach(t => chosenForSave.add(String(t._id)));
  });

  // bulk update trips collections
  const tripOps = [
    ...Array.from(chosenForLike).map(tripId => ({
      updateOne: {
        filter: { _id: tripId },
        update: { $addToSet: { likes: userObjectId } }
      }
    })),
    ...Array.from(chosenForSave).map(tripId => ({
      updateOne: {
        filter: { _id: tripId },
        update: { $addToSet: { savedBy: userObjectId } }
      }
    })),
  ];
  if (tripOps.length) await Trip.bulkWrite(tripOps, { ordered: false });

  // store selections on user for easy lookup
  const likeSelections = Array.from(chosenForLike).map(id => new Types.ObjectId(id));
  const saveSelections = Array.from(chosenForSave).map(id => new Types.ObjectId(id));

  await User.updateOne(
    { _id: userObjectId },
    { $addToSet: {
        likedTrips: { $each: likeSelections },
        savedTrips: { $each: saveSelections },
      }
    }
  );

  console.log(`Liked ${likeSelections.length} and saved ${saveSelections.length} for ${userId}`);
  return { likeSelections, saveSelections };
}

// === main endpoint ===
/**
 * POST /test-user
 * Body: {
 *   user_id?, cohesionScore, likePools[], travelStyle,
 *   trips: [{ title, destination, startDate, endDate, tags[], budget }]
 * }
 */
const createTestUser = async (req, res) => {
  try {
    let { cohesionScore = 1, likePools = [], travelStyle, trips = [] } = req.body;

    // validate/generate id
    const userId = new Types.ObjectId();
    console.log('USER ID:', userId);
    console.log('Cohesion Score:', cohesionScore);
    console.log('Like Pools:', likePools.length)
    console.log('Travel Style:', travelStyle);
    console.log('Trips:', trips.length);


    if (!Array.isArray(trips) || trips.length === 0) {
      return res.status(400).json({ error: 'Trips array is required' });
    }

    // create user (minimal)
    const userDoc = await User.create({
      _id: userId,
      email: `test_${userId}@example.com`,
      password: await bcrypt.hash('password123', 10),
      travelStyle: travelStyle || null,
      followers: [],
      followings: [],
      likedTrips: [],
      savedTrips: [],
      trips: [],
    });

    // create trips
    const tripDocs = trips.map(t => ({
      ...t,
      userId: userId,
    }));
    const insertedTrips = await Trip.insertMany(tripDocs);

    // attach trips to user
    await User.updateOne(
      { _id: userId },
      { $set: { trips: insertedTrips.map(t => t._id) } }
    );

    // seed followings and interactions
    const followings = await seedUserFollowings({
      userId,
      travelStyle,
      cohesionScore,
      maxFollowings: 100,
    });

    const { likeSelections, saveSelections } = await seedUserInteractions({
      userId,
      likePools,
      likeCap: 100,
      saveCap: 70,
    });

    // return the created docs + computed arrays
    const freshUser = await User.findById(userId)
      .populate('trips', '_id title destination tags budget')
      .populate('followings', '_id travelStyle');

    res.status(201).json({
      message: 'Test user created with followings & interactions',
      userId: userId.toString(),
      user: freshUser,
      seeded: {
        followingsCount: followings.length,
        likedCount: likeSelections.length,
        savedCount: saveSelections.length,
      },
    });
  } catch (err) {
    console.error('Error creating test user:', err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  createTestUser,
  seedUserFollowings,      // exported in case you want to call directly for a user
  seedUserInteractions,    // same here
};