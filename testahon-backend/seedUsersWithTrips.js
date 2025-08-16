const { MongoClient } = require('mongodb');
const mongoose = require('mongoose');
const bycrypt = require('bcryptjs');
const { faker } = require('@faker-js/faker');
const Trip = require('./modals/Trip');
const User = require('./modals/User');
const { start } = require('repl');
const axios = require('axios');

const { PREDEFINED_TAGS } = require('./data/tags')
const { TOP_CITIES } = require('./data/cities');

const MONGO_URI = 'mongodb://appuser1:appuser1@ac-pzmwfhj-shard-00-00.jxzjzuo.mongodb.net:27017,ac-pzmwfhj-shard-00-01.jxzjzuo.mongodb.net:27017,ac-pzmwfhj-shard-00-02.jxzjzuo.mongodb.net:27017/recommendation_dataset?ssl=true&replicaSet=atlas-tq5bms-shard-0&authSource=admin&retryWrites=true&w=majority&appName=Cluster0';
const client = new MongoClient(MONGO_URI);
const llamaURL = "http://localhost:11434/api/chat"

async function run() {
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    const db = client.db('recommendation_dataset');

    const collection = await db.listCollections().toArray();
    console.log('Collections: ', collection.map(c => c.name));
  } catch (error) {
    console.error("Connection error: ", error);
  } finally {
    await client.close();
  }
}

const personas = [
  { bio: "a solo backpacker on a budget", travelStyle: "solo"},
  { bio: "a luxury traveler seeking premium experiences", travelStyle: "luxury"},
  { bio: "a foodie exploring global cuisines", travelStyle: "foodie"},
  { bio: "a digital nomad visiting hotspots", travelStyle: "digital nomad"},
  { bio: "an adventure junkie seeking thrills", travelStyle: "adventure"},
  { bio: "a nature lover hiking scenic trails", travelStyle: "nature"},
  { bio: "a couple on a romantic escape", travelStyle: "romantic"},
  { bio: "a student exploring Europe on a budget", travelStyle: "budget"},
  { bio: "a parent that loves travelling with my kids", travelStyle: "family"},
  { bio: "a lover of history, art, architecture, and city experiences", travelStyle: "culture"},
  { bio: "a group of friends partying across the world", travelStyle: "party"},
  { bio: "a seasonal traveller, 12 months a year", travelStyle: "seasonal"}
]

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

function generateExtraction(persona) {
  const sampleCities = faker.helpers.shuffle(TOP_CITIES.map(c => c.city)).slice(0, 5);
  const sampleTags = PREDEFINED_TAGS.map(t => t.tag);

  return {
    model: "mistral:7b",
    stream: false,
    messages: [
      {
        role: "system",
        content: "You are a creative travel generator that designs realistic, vacation plans for different types of travelers.",
      },
      {
        role: "user",
        content: `
  Generate 1 unique vacation in JSON format with the following fields ONLY:

  - "title": creative and engaging (but not repeated)
  - "destination": // Do NOT return an array. Must be a SINGLE city from this list: ${sampleCities.join(', ')}
  - "tags": minimum of 3 and maximum of 6 different tags from this list: ${sampleTags.join(', ')} format as array.
  - "budget": a realistic number between 500 and 4000, based on destination and trip type
  - "startDate": random date in the past or future (ISO format)
  - "endDate": // (ISO format) strictly after the startDate
  - "description": short, exciting sentence that matches the tags and destination

  You are generating a vacation for ${persona}. The destination and budget must match their travel style.

  Respond with only raw JSON. Do not use markdown or wrap in backticks.
        `,
      },
    ],
  };
}

async function query_llama2(payload) {
  try {
    const response = await axios.post(llamaURL, payload);
    const reply = response.data.message.content;
    console.log("llama response: ", reply);
    const cleaned = reply.replace(/```(?:json)?\s*|\s*```$/g, '');

    const tripJSON = JSON.parse(cleaned);
    return tripJSON;
  } catch (error) {
    console.error("Error q llama:", error.message);
    return null;
  }
}

let seededUsers = [];
let allTrips = [];

const userCount = 105; // Number of users to seed
const tripCount = 10; // Number of trips per user

async function seedUsers(userCount) {
  await mongoose.connect(MONGO_URI);
  console.log('Seeding users...');
  const users = [];
 
  for (let i = 0; i < userCount; i++) {
    const hashedPassword = await bycrypt.hash('password123', 10);
    const { bio, travelStyle } = faker.helpers.arrayElement(personas);

    users.push( new User({
      email: faker.internet.email().toLowerCase(),
      password: hashedPassword,
      firstName: faker.person.firstName(),
      lastName: faker.person.lastName(),
      dob: faker.date.past(30, new Date('2000-01-01')),
      location: faker.helpers.arrayElement(TOP_CITIES.map(c => c.city)),
      travelStyle,
      bio,
    }));

    //console.log('USER: ', users[i]);
  }

  seededUsers = await User.insertMany(users);
  console.log(`${users.length} users seeded`);
  await mongoose.disconnect();
}

async function seedTrips(tripCount) {
  await mongoose.connect(MONGO_URI);
  console.log('Seeding trips...');

  for (const user of seededUsers) {
    const trips = [];

    for (let i = 0; i < tripCount; i++) {
      const extraction_payload = generateExtraction(user.bio);
      const tripJSON = await query_llama2(extraction_payload);

      // IT IS IMPORTANT TO SIMULATE LIKES AND SAVES TO REAL LIFE SCENARIOS
      // ->>> positive correlation between trip popularity and number of likes/saves
      // ->>> more popular trips should have more likes and saves
      // ->>> using a random number generator to simulate this
      // generate a random binary score for trip popularity (0 to 1)
      const popularityScore = Math.random();
      const maxLikes = seededUsers.length; // Maximum number of likes a trip can have
      const maxSavedBy = seededUsers.length; // Maximum number of users who can save a trip

      const shuffledUsers = faker.helpers.shuffle(seededUsers);
      const interestUsers = shuffledUsers.filter(user => {
        const pool = themePool.find(p => p.pool === user.travelStyle);
        if (!pool) return false;

        const userInterestTags = pool.tags;
        const sharedInterest = tripJSON.tags.some(tag => userInterestTags.includes(tag));

        const likedProbablity = sharedInterest ? 0.7 : 0.3;
        return Math.random() < likedProbablity;
      });

      const numLikes = Math.ceil(
        popularityScore * interestUsers.length * faker.number.float({ min: 0.5, max: 1.2 }) + faker.number.int({ min: 1, max: 3 })
      );
      const likedByUsers = interestUsers.slice(0, numLikes);

      const numSavedBy = Math.floor(popularityScore * interestUsers.length * faker.number.float({ min: 0.2, max: 0.6 }));
      const savedByUsers = faker.helpers.shuffle(interestUsers).slice(0, numSavedBy);
      
      // gnerate repostedByUsers based on popularity score * scaling factor of 0.10% to 0.3%
      const repostProbability = faker.number.float({ min: 0.1, max: 0.3 });
      const possibleReposters = faker.helpers.shuffle([...likedByUsers, ...savedByUsers]);
      const maxReposts = Math.floor(popularityScore * possibleReposters.length * repostProbability);
      const repostedByUsers = possibleReposters.slice(0, maxReposts);

      const trip = new Trip({
        userId: user._id,
        title: tripJSON.title,
        destination: tripJSON.destination,
        startDate: tripJSON.startDate,
        endDate: tripJSON.endDate,
        description: tripJSON.description,
        tags: tripJSON.tags,
        budget: tripJSON.budget,
        taggedUsers: [],
        likes: likedByUsers.map(u => u._id),
        savedBy: savedByUsers.map(u => u._id),
        posts: [],
        comments: [],
        reviews: [],
        repostCount: repostedByUsers.map(u => u._id),
      });

      trips.push(trip);
      console.log('Trip Seeded: ', trips.length + allTrips.length);
      
      // Add trips to 'savedTrips[]' + 'likedTrips[]' array for User who saved this trip
      for (const savedUser of savedByUsers) {
        if (savedUser.savedTrips.length < 5 && !savedUser.savedTrips.includes(trip._id)) {
          savedUser.savedTrips.push(trip._id);
        }
      }
      for (const likedUser of likedByUsers) {
        likedUser.likedTrips = likedUser.likedTrips || [];
        likedUser.likedTrips.push(trip._id);
      }
    }

    // save trips to DB
    const createdtrips = await Trip.insertMany(trips);

    // this assigns the User the trips we made for them in their 'trips[]' field.
    user.trips = createdtrips.map(trip => trip._id);
    await user.save();

    console.log(`User ${user.email} | ${user.bio} | ${user.travelStyle} has ${createdtrips.length} trips seeded`);
    allTrips.push(...createdtrips);
  }

  // save all modified users with their trips
  await Promise.all(seededUsers.map(user => user.save()));
  await mongoose.disconnect();
  console.log('Total trips seeded: ', allTrips.length);
}

// ---------- helpers: sanitize + prompt ----------
function sanitizeTripJSON(raw, sampleCities, allTags) {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // destination -> always a single city string
  let dest = raw?.destination;
  if (Array.isArray(dest)) dest = dest.find(d => typeof d === 'string' && d.trim());
  if (typeof dest === 'string') {
    dest = dest.split(',')[0].trim(); // strip ", Country"
    // snap to allowed list if contains/equals
    const exact = sampleCities.find(c => c.toLowerCase() === dest.toLowerCase());
    const contains = sampleCities.find(c => dest.toLowerCase().includes(c.toLowerCase()));
    dest = exact || contains || dest;
  }
  if (!dest || typeof dest !== 'string') dest = pick(sampleCities);

  // tags -> 3..6 from allowed, unique
  let tags = Array.isArray(raw?.tags) ? raw.tags.filter(t => typeof t === 'string') : [];
  const allowed = new Set(allTags);
  tags = [...new Set(tags.filter(t => allowed.has(t)))];
  while (tags.length < 3) {
    const t = pick(allTags);
    if (!tags.includes(t)) tags.push(t);
  }
  tags = tags.slice(0, 6);

  // budget clamp
  let budget = Number(raw?.budget);
  if (!Number.isFinite(budget)) budget = faker.number.int({ min: 500, max: 4000 });
  budget = Math.min(4000, Math.max(500, Math.round(budget)));

  // dates (ISO, end > start)
  const isoOr = (d, fallback) => {
    const n = new Date(d);
    return isNaN(+n) ? fallback.toISOString() : n.toISOString();
  };
  const startDefault = faker.date.between({ from: '2023-01-01', to: '2026-12-31' });
  let startDate = isoOr(raw?.startDate, startDefault);
  let endDate = isoOr(raw?.endDate, new Date(new Date(startDate).getTime() + 1000 * 60 * 60 * 24 * faker.number.int({ min: 3, max: 14 })));
  if (new Date(endDate) <= new Date(startDate)) {
    endDate = new Date(new Date(startDate).getTime() + 1000 * 60 * 60 * 24 * 5).toISOString();
  }

  const title = (typeof raw?.title === 'string' && raw.title.trim()) ? raw.title.trim() : `Trip to ${dest}`;
  const description = (typeof raw?.description === 'string' && raw.description.trim())
    ? raw.description.trim()
    : `Discover ${dest} with a ${tags.join(', ')} vibe.`;

  return { title, destination: dest, tags, budget, startDate, endDate, description };
}

function promptFor(persona, sampleCities, sampleTags) {
  return {
    model: "mistral:7b",
    stream: false,
    messages: [
      {
        role: "system",
        content: "You are a creative travel generator that designs realistic, vacation plans for different types of travelers.",
      },
      {
        role: "user",
        content: `
  Generate 1 unique vacation in JSON format with the following fields ONLY:

  - "title": creative and engaging (but not repeated)
  - "destination": // Do NOT return an array. Must be a SINGLE city from this list: ${sampleCities.join(', ')}
  - "tags": minimum of 3 and maximum of 6 different tags from this list: ${sampleTags.join(', ')} format as array.
  - "budget": a realistic number between 500 and 4000, based on destination and trip type
  - "startDate": random date in the past or future (ISO format)
  - "endDate": // (ISO format) strictly after the startDate
  - "description": short, exciting sentence that matches the tags and destination

  You are generating a vacation for ${persona}. The destination and budget must match their travel style.

  Respond with only raw JSON. Do not use markdown or wrap in backticks.
        `.trim()
      }
    ]
  };
}

// ---------- recovery seeder ----------
async function seedMissingTripsForExistingUsers(targetPerUser = 10) {
  await mongoose.connect(MONGO_URI);
  console.log(`Recover seeding… Target per user = ${targetPerUser}`);

  const tripsinDB = await Trip.find({});

  // pool for likes/saves decisions
  const allUsers = await User.find().select('_id travelStyle savedTrips likedTrips trips bio').lean(false);

  // users needing top-up
  const usersNeeding = await User.find({
    $expr: { $lt: [{ $size: "$trips" }, targetPerUser] }
  }).select('_id travelStyle savedTrips likedTrips trips bio email').lean(false);

  console.log('totalTripsinDB:',tripsinDB.length);
  console.log('total users still need seeding:', usersNeeding.length);

  if (!usersNeeding.length) {
    console.log('No users need additional trips. ✅');
    await mongoose.disconnect();
    return;
  }

  const sampleCities = TOP_CITIES.map(c => c.city);
  const allTags = PREDEFINED_TAGS.map(t => t.tag);

  for (const user of usersNeeding) {
    const existing = Array.isArray(user.trips) ? user.trips.length : 0;
    const need = Math.max(0, targetPerUser - existing);
    if (need === 0) continue;

    console.log(`Topping up ${user.email} (${existing} -> ${targetPerUser}) need=${need}`);

    const newTrips = [];

    for (let i = 0; i < need; i++) {
      // call LLM
      const payload = promptFor(user.bio, faker.helpers.shuffle(sampleCities).slice(0, 5), allTags);
      let raw = await query_llama2(payload);
      if (!raw) {
        raw = {
          title: `Escape to ${faker.helpers.arrayElement(TOP_CITIES).city}`,
          destination: faker.helpers.arrayElement(TOP_CITIES).city,
          tags: faker.helpers.arrayElements(allTags, { min: 3, max: 6 }),
          budget: faker.number.int({ min: 500, max: 4000 }),
          startDate: faker.date.soon().toISOString(),
          endDate: faker.date.soon({ days: 10 }).toISOString(),
          description: "A short, exciting getaway."
        };
      }
      const t = sanitizeTripJSON(raw, sampleCities, allTags);

      // interest-based engagement
      const shuffledUsers = faker.helpers.shuffle(allUsers);
      const pool = themePool.find(p => p.pool === user.travelStyle);
      const interestUsers = shuffledUsers.filter(u => {
        const uPool = themePool.find(p => p.pool === u.travelStyle);
        if (!uPool) return false;
        const shared = t.tags.some(tag => uPool.tags.includes(tag));
        const likedProb = shared ? 0.7 : 0.3;
        return Math.random() < likedProb;
      });

      const popularityScore = Math.random();
      const numLikes = Math.ceil(popularityScore * interestUsers.length * faker.number.float({ min: 0.5, max: 1.2 }) + faker.number.int({ min: 1, max: 3 }));
      const likedByUsers = interestUsers.slice(0, numLikes);
      const numSavedBy = Math.floor(popularityScore * interestUsers.length * faker.number.float({ min: 0.2, max: 0.6 }));
      const savedByUsers = faker.helpers.shuffle(interestUsers).slice(0, numSavedBy);

      const repostProbability = faker.number.float({ min: 0.1, max: 0.3 });
      const possibleReposters = faker.helpers.shuffle([...likedByUsers, ...savedByUsers]);
      const maxReposts = Math.floor(popularityScore * possibleReposters.length * repostProbability);
      const repostedByUsers = possibleReposters.slice(0, maxReposts);

      newTrips.push({
        userId: user._id,
        title: t.title,
        destination: t.destination,
        startDate: t.startDate,
        endDate: t.endDate,
        description: t.description,
        tags: t.tags,
        budget: t.budget,
        taggedUsers: [],
        likes: likedByUsers.map(u => u._id),
        savedBy: savedByUsers.map(u => u._id),
        posts: [],
        comments: [],
        reviews: [],
        repostCount: repostedByUsers.map(u => u._id),
      });

      console.log('total trips:', newTrips.length);
    }

    // insert trips for this user
    const created = await Trip.insertMany(newTrips);

    // add trip ids to the user
    const createdIds = created.map(tr => tr._id);
    await User.updateOne(
      { _id: user._id },
      { $push: { trips: { $each: createdIds } } }
    );

    // reflect likes/saves on other users (use $addToSet to avoid dupes)
    for (const tr of created) {
      if (Array.isArray(tr.savedBy) && tr.savedBy.length) {
        await User.updateMany(
          { _id: { $in: tr.savedBy } },
          { $addToSet: { savedTrips: tr._id } }
        );
      }
      if (Array.isArray(tr.likes) && tr.likes.length) {
        await User.updateMany(
          { _id: { $in: tr.likes } },
          { $addToSet: { likedTrips: tr._id } }
        );
      }
    }

    console.log(`User ${user.email} topped up by ${created.length} trips.`);
  }

  await mongoose.disconnect();
  console.log('Recovery seeding complete. ✅');
}

(async () => {
  // await seedUsers(userCount);
  // await seedTrips(tripCount);
  await seedMissingTripsForExistingUsers(10);

})();


// ask user to fill out survey for static preference fields e.g. nickname, travelStyle, bio

// ask user to create recent/favourite trips x3 eg. 
//      trip.title
//      trip.destination
//      trip.duration (start - end)
//      trip.budget
//      tip.tags [choose from a list of tags]

// ask user to like pools of different themes: 3-8

// ask user to follow who??? how?? 
//      ask 'if you would to use an app like this? or in any other social media platforms, do you tend to follow others that closely matches with your iterest?
//      score from 1 (less) to 5 (more) >> this feeds as a parameter for weighting. 
//      loop through all users >> scan travelStyle >> scan Pool >> aggregate probabality of following others in that pool using score. [@ max num of following]. 

// return results of different categorise of recommendation:
//      record each results with user relevance. 
