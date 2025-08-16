from pymongo import MongoClient
from bson import ObjectId
from typing import List, Dict, Tuple, Any
import os
from math import sqrt

MONGO_URI = "mongodb://appuser1:appuser1@ac-pzmwfhj-shard-00-00.jxzjzuo.mongodb.net:27017,ac-pzmwfhj-shard-00-01.jxzjzuo.mongodb.net:27017,ac-pzmwfhj-shard-00-02.jxzjzuo.mongodb.net:27017/recommendation_dataset?ssl=true&replicaSet=atlas-tq5bms-shard-0&authSource=admin&retryWrites=true&w=majority&appName=Cluster0"
client = MongoClient(MONGO_URI)
db = client.get_database('recommendation_dataset')

WEIGHT_TAG = float(os.environ.get('REC_WEIGHT_TAG', '2.0'))
WEIGHT_BUDGET = float(os.environ.get('REC_WEIGHT_BUDGET', '1.0'))
WEIGHT_DESTINATION = float(os.environ.get('REC_WEIGHT_DESTINATION', '1.5'))
WEIGHT_TRAVEL_STYLE = float(os.environ.get('REC_WEIGHT_STYLE', '1.0'))
BOOST_LIKED = float(os.environ.get('REC_BOOST_LIKED', '1.0'))
BOOST_SAVED = float(os.environ.get('REC_BOOST_SAVED', '0.7'))
DEST_DUPLICATE_DECAY = float(os.environ.get('REC_DEST_DUP_DECAY', '0.15'))  # penalty per prior occurrence in selected list
MMR_LAMBDA = float(os.environ.get('REC_MMR_LAMBDA', '0.7'))  # trade-off between relevance and diversity (0..1)
TOP_K = int(os.environ.get('REC_TOP_K', '10'))

CONF_FLOOR   = float(os.environ.get('REC_CONF_FLOOR', '0.65'))  # min displayed confidence (65%)
CONF_CEIL    = float(os.environ.get('REC_CONF_CEIL', '0.95'))   # max displayed confidence (98%)
CONF_GAMMA   = float(os.environ.get('REC_CONF_GAMMA', '1.0'))   # curve <1 lifts tail; >1 compresses tail

def serialize_doc(doc):
  if isinstance(doc, list):
      return [serialize_doc(d) for d in doc]
  if isinstance(doc, dict):
      return {k: serialize_doc(v) for k, v in doc.items()}
  if isinstance(doc, ObjectId):
      return str(doc)
  return doc

async def contentBasedNewPlaces(user_profile):
  """
  Recommend trips that match the user's vibe (tags/budget/style) but *exclude*
  destinations they've already visited. Still diversified with MMR.
  """
  all_trips = list(db.trips.find({}))
  user_id = user_profile.get('userId')
  liked_ids = set(user_profile.get('likedTripsIds', []) or [])
  saved_ids = set(user_profile.get('savedTripsIds', []) or [])

  # Helper: normalize user tags & destinations (accept dict or list)
  def to_count_dict(val):
      if isinstance(val, dict):
          return {k: v for k, v in val.items() if k}
      if isinstance(val, list):
          return {k: 1 for k in val if k}
      return {}

  user_tags = to_count_dict(user_profile.get('tags', {}))
  user_dests = to_count_dict(user_profile.get('recentDestinations', {}))
  user_budget = user_profile.get('avgBudget')
  user_style = user_profile.get('travelStyle')

  # Build visited dests: recentDestinations + (best-effort) user's own trips
  visited_dests = set(user_dests.keys())
  try:
      if user_id:
          for t in db.trips.find({"userId": ObjectId(user_id)}, {"destination": 1}):
              d = t.get("destination")
              if d:
                  visited_dests.add(d)
  except Exception:
      # If user_id is not a valid ObjectId or query fails, just skip this extra enrichment
      pass

  # Candidates: exclude user's own trips AND any destination they've already been to
  base_candidates = [
      t for t in all_trips
      if str(t.get('userId')) != user_id and (t.get('destination') not in visited_dests)
  ]

  # Precompute a "vibe centroid" over tags (L2-normalized) to score cosine-ish alignment
  import math
  tag_keys = list(user_tags.keys())
  if tag_keys:
      norm = math.sqrt(sum((user_tags[k] ** 2) for k in tag_keys)) or 1.0
      centroid = {k: (user_tags[k] / norm) for k in tag_keys}
  else:
      centroid = {}

  def tag_overlap_score(trip_tags):
      if not trip_tags:
          return 0.0
      return sum(user_tags.get(tag, 0) for tag in trip_tags)

  def tag_centroid_alignment(trip_tags):
      # sum of centroid weights for tags present in trip
      if not centroid or not trip_tags:
          return 0.0
      return sum(centroid.get(tag, 0.0) for tag in trip_tags)

  def budget_similarity(user_b, trip_b):
      if not user_b or not trip_b:
          return 0.0
      return 1 - abs(user_b - trip_b) / max(user_b, trip_b, 1)

  def compute_raw_content_score(trip):
      score = 0.0
      ttags = trip.get('tags', [])

      # Tags (original overlap) + a small centroid alignment boost for "vibe"
      score += WEIGHT_TAG * tag_overlap_score(ttags)
      score += 0.3 * tag_centroid_alignment(ttags)  # <= subtle push toward user vibe

      # Budget
      score += WEIGHT_BUDGET * budget_similarity(user_budget, trip.get('budget'))

      # NO destination exact-match bonus (we want new places)
      # Travel style
      if user_style and trip.get('travelStyle') and user_style == trip.get('travelStyle'):
          score += WEIGHT_TRAVEL_STYLE

      # Liked / Saved boosts (kept: if they liked/saved similar trips made by others)
      _id_str = str(trip.get('_id'))
      if _id_str in liked_ids:
          score += BOOST_LIKED
      if _id_str in saved_ids:
          score += BOOST_SAVED

      return score

  # Pre-score
  scored = []
  for trip in base_candidates:
      s = compute_raw_content_score(trip)
      if s > 0:
          scored.append((s, trip))
  scored.sort(key=lambda x: x[0], reverse=True)
  if not scored:
      return []
    
  abs_max_s = max(s for s, _ in scored)  # used below for probability-like confidence

  # MMR diversification — drop destination exact-match similarity since we filtered visited
  def similarity(t1, t2):
      tags1 = set(t1.get('tags', []) or [])
      tags2 = set(t2.get('tags', []) or [])
      # pure Jaccard on tags keeps variety but avoids near-duplicates
      return (len(tags1 & tags2) / len(tags1 | tags2)) if (tags1 or tags2) else 0.0

  relevance = {str(trip.get('_id')): base for base, trip in scored}

  selected, selected_ids = [], set()
  dest_counts = {}

  # Seed
  first_score, first_trip = scored[0]
  selected.append(first_trip)
  selected_ids.add(str(first_trip.get('_id')))
  d0 = first_trip.get('destination')
  if d0:
      dest_counts[d0] = 1

  while len(selected) < TOP_K and len(selected_ids) < len(scored):
      best_candidate = None
      best_mmr = -1e9
      for base_score, trip in scored:
          tid = str(trip.get('_id'))
          if tid in selected_ids:
              continue
          max_sim = max(similarity(trip, s) for s in selected) if selected else 0.0
          mmr_score = MMR_LAMBDA * base_score - (1 - MMR_LAMBDA) * max_sim
          # keep a sprinkle of destination spread among *new* places
          d = trip.get('destination')
          if d and dest_counts.get(d, 0) > 0:
              mmr_score -= DEST_DUPLICATE_DECAY * dest_counts[d]
          if mmr_score > best_mmr:
              best_mmr = mmr_score
              best_candidate = trip

      if not best_candidate:
          break
      selected.append(best_candidate)
      selected_ids.add(str(best_candidate.get('_id')))
      d = best_candidate.get('destination')
      if d:
          dest_counts[d] = dest_counts.get(d, 0) + 1

  if len(selected) < TOP_K:
      for base_score, trip in scored:
          if len(selected) >= TOP_K:
              break
          tid = str(trip.get('_id'))
          if tid not in selected_ids:
              selected.append(trip)
              selected_ids.add(tid)

# Scoring for selected (legacy min–max score)
  selected_scored: List[Tuple[float, Dict[str, Any]]] = []
  for t in selected[:TOP_K]:
      selected_scored.append((compute_raw_content_score(t), t))

  sel_max = max(s for s, _ in selected_scored)
  sel_min = min(s for s, _ in selected_scored)
  sel_rng = max(1e-9, sel_max - sel_min)

  results: List[Dict[str, Any]] = []
  for s, trip in selected_scored:
      # Legacy score normalized within selected
      score_norm = (s - sel_min) / sel_rng

      # Probability-like confidence using ABSOLUTE baseline
      raw_ratio = (s / abs_max_s) if abs_max_s > 0 else 0.0
      # optional clamp
      raw_ratio = max(0.0, min(1.0, raw_ratio))
      curved = raw_ratio ** CONF_GAMMA
      confidence = CONF_FLOOR + (CONF_CEIL - CONF_FLOOR) * curved

      out = serialize_doc(trip)
      out["score"] = round(float(score_norm), 3)
      out["confidence"] = round(float(confidence), 3)
      out["confidenceLabel"] = f"{int(round(confidence * 100))}% likely to enjoy"
      results.append(out)

  return results