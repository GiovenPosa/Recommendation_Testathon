const User = require('../modals/User');
const Trip = require('../modals/Trip');
const mongoose = require('mongoose');
const { Types } = require('mongoose');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

// 689785e542ec630fac8d47ec
// const MONGO_URI = 'mongodb+srv://appuser1:appuser1@cluster0.jxzjzuo.mongodb.net/recommendation_dataset?retryWrites=true&w=majority&appName=Cluster0';

// ❌ mongodb+srv (needs SRV DNS; flaky on hotspots)
// const MONGO_URI = 'mongodb+srv://appuser1:...@cluster0.jxzjzuo.mongodb.net/recommendation_dataset?...';


exports.recommendTrips = async (req, res, next) => {
  const { userId } = req.params;
  
  try {
    if (!Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    const profile = await buildUserPreferenceProfile(userId);
    const recommendedTrips = await sendProfileToRecommender(profile);

    console.log('PREFERENCE_PROFILE: ', recommendedTrips);
    return res.json(recommendedTrips)
  } catch (error) {
    next(error);
 }  
}

async function sendProfileToRecommender(profile) {
  const res = await fetch("http://localhost:8888/recommend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error('Recommender error:', res.status, text);
    throw new Error(`Recommender HTTP ${res.status}`);
  }
  const ctype = res.headers.get('content-type') || '';
  if (!ctype.includes('application/json')) {
    console.error('Recommender non-JSON:', text);
    throw new Error('Recommender did not return JSON');
  }
  return JSON.parse(text);
}

const buildUserPreferenceProfile = async (userId) => {

  try {
    const user = await User.findById(userId)
      .populate('savedTrips')
      .populate('likedTrips')
      .populate('trips')
      .populate('followings');

    if (!user) {
      throw new Error('User not found');
    }

    // find all trips liked by the user and store trip IDs in 'likedTripsIds'
    const likedTrips = await Trip.find({ likes: user._id }, '_id');
    const likedTripsIds = likedTrips.map(trip => trip._id.toString());

    const preferenceProfile = {
      userId: userId,
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
 
    preferenceProfile.recentDestinations = destinations;
    preferenceProfile.tags = tagCounts;
    return preferenceProfile;
    
  } catch (error) {
    console.log('Failed to build user preference profile: ', error.message);
    return null;
  }
};

exports.getTripOwner = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: 'Invalid tripId' });
    }

    const user = await User.findById(userId).populate('firstName lastName');
    if (!user) return res.status(404).json({ error: 'User not found' });

    return res.json({ user });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

function csvEscape(val) {
  const s = String(val ?? '');
  const q = s.replace(/"/g, '""');
  return `"${q}"`;
}

async function ensureFileWithHeader(filePath, headerLine) {
  try {
    await fsp.access(filePath, fs.constants.F_OK);
  } catch {
    await fsp.writeFile(filePath, headerLine + '\n', 'utf8');
  }
}

function normalizeToRows(body) {
  const { user, userId: uid, recommendedResult, _eval: evalBlock, ...maybeModels } = body || {};
  const userId = uid ?? (typeof user == 'object' ? (user.id || user._id) : user);

  const models = {};
  const evalModels = {}; // NEW

  // Map-style (existing)
  for (const [key, val] of Object.entries(maybeModels)) {
    if (key === 'models' || key === '_eval') continue;
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      models[key] = models[key] || {};
      for (const [tripId, v] of Object.entries(val)) {
        models[key][String(tripId)] = v ? 1 : 0;
      }
    }
  }

  // Array-style (existing)
  if (Array.isArray(recommendedResult)) {
    for (const item of recommendedResult) {
      if (!item) continue;
      const engine = item.engineType || item.engine || item.model || 'recModel1';
      const tripId = String(item.tripId ?? item.id ?? item._id ?? '');
      if (!tripId) continue;
      const v = item.relevant ? 1 : 0;
      models[engine] = models[engine] || {};
      models[engine][tripId] = v;
    }
  }

  // Explicit models (if frontend built models)
  if (body.models && typeof body.models === 'object') {
    for (const [engine, tripMap] of Object.entries(body.models)) {
      models[engine] = models[engine] || {};
      for (const [tripId, v] of Object.entries(tripMap || {})) {
        models[engine][String(tripId)] = v ? 1 : 0;
      }
    }
  }

  // NEW: eval sidecar
  if (evalBlock && typeof evalBlock === 'object') {
    for (const [engine, obj] of Object.entries(evalBlock)) {
      if (!obj || typeof obj !== 'object') continue;
      evalModels[engine] = {
        recommendedTripIds: (obj.recommendedTripIds || []).map(String),
        relevantTripIds: (obj.relevantTripIds || []).map(String),
        allCandidateTripIds: (obj.allCandidateTripIds || []).map(String),
      };
    }
  }

  return { userId: userId ? String(userId) : null, models, evalModels };
}

exports.outputResult = async (req, res) => {
  try {
    const { userId, models, evalModels } = normalizeToRows(req.body);
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const receivedAt = new Date().toISOString();

    // --- existing relevance CSV ---
    const rows = [];
    for (const [modelKey, tripMap] of Object.entries(models || {})) {
      for (const [tripId, value] of Object.entries(tripMap || {})) {
        rows.push([
          csvEscape(userId),
          csvEscape(modelKey),
          csvEscape(tripId),
          csvEscape(value ? 1 : 0),
          csvEscape(receivedAt),
        ].join(','));
      }
    }

    const exportDir = path.join(process.cwd(), 'exports');
    if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

    const safeUserId = String(userId).replace(/[^\w.-]/g, '_');

    // relevance file
    const relFile = path.join(exportDir, `relevance-user-${safeUserId}.csv`);
    const relHeader = ['userId', 'model', 'tripId', 'value', 'receivedAt'].join(',');
    await ensureFileWithHeader(relFile, relHeader);
    if (rows.length) {
      await fsp.appendFile(relFile, rows.join('\n') + '\n', 'utf8');
    }

    // --- NEW: eval CSV ---
    const evalRows = [];
    for (const [modelKey, block] of Object.entries(evalModels || {})) {
      const { recommendedTripIds = [], relevantTripIds = [], allCandidateTripIds = [] } = block || {};
      for (const tripId of recommendedTripIds) {
        evalRows.push([csvEscape(userId), csvEscape(modelKey), csvEscape(tripId), csvEscape('recommended'), csvEscape(receivedAt)].join(','));
      }
      for (const tripId of relevantTripIds) {
        evalRows.push([csvEscape(userId), csvEscape(modelKey), csvEscape(tripId), csvEscape('relevant'), csvEscape(receivedAt)].join(','));
      }
      for (const tripId of allCandidateTripIds) {
        evalRows.push([csvEscape(userId), csvEscape(modelKey), csvEscape(tripId), csvEscape('candidate'), csvEscape(receivedAt)].join(','));
      }
    }

    let evalFilePath = null;
    if (evalRows.length) {
      evalFilePath = path.join(exportDir, `eval-user-${safeUserId}.csv`);
      const evalHeader = ['userId', 'model', 'tripId', 'kind', 'receivedAt'].join(',');
      await ensureFileWithHeader(evalFilePath, evalHeader);
      await fsp.appendFile(evalFilePath, evalRows.join('\n') + '\n', 'utf8');
    }

    return res.status(200).json({
      ok: true,
      wrote: rows.length,
      relevanceFile: `exports/relevance-user-${safeUserId}.csv`,
      wroteEvalRows: evalRows.length,
      evalFile: evalFilePath ? `exports/eval-user-${safeUserId}.csv` : null,
    });
  } catch (error) {
    console.error('outputResult error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
};