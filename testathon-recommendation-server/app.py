from flask import Flask, request, jsonify
from flask_cors import CORS
from pymongo import MongoClient
from bson import ObjectId
import os
from math import sqrt

app = Flask(__name__)
CORS(app)

# Use your MongoDB URI from the Node.js .env
MONGO_URI = "mongodb://appuser1:appuser1@ac-pzmwfhj-shard-00-00.jxzjzuo.mongodb.net:27017,ac-pzmwfhj-shard-00-01.jxzjzuo.mongodb.net:27017,ac-pzmwfhj-shard-00-02.jxzjzuo.mongodb.net:27017/recommendation_dataset?ssl=true&replicaSet=atlas-tq5bms-shard-0&authSource=admin&retryWrites=true&w=majority&appName=Cluster0"
client = MongoClient(MONGO_URI)
db = client.get_database('recommendation_dataset')

# === Weight / boost configuration (env override-able) ===
WEIGHT_TAG = float(os.environ.get('REC_WEIGHT_TAG', '2.0'))
WEIGHT_BUDGET = float(os.environ.get('REC_WEIGHT_BUDGET', '1.0'))
WEIGHT_DESTINATION = float(os.environ.get('REC_WEIGHT_DESTINATION', '1.5'))
WEIGHT_TRAVEL_STYLE = float(os.environ.get('REC_WEIGHT_STYLE', '1.0'))
BOOST_LIKED = float(os.environ.get('REC_BOOST_LIKED', '1.0'))
BOOST_SAVED = float(os.environ.get('REC_BOOST_SAVED', '0.7'))
DEST_DUPLICATE_DECAY = float(os.environ.get('REC_DEST_DUP_DECAY', '0.15'))  # penalty per prior occurrence in selected list
MMR_LAMBDA = float(os.environ.get('REC_MMR_LAMBDA', '0.7'))  # trade-off between relevance and diversity (0..1)
TOP_K = int(os.environ.get('REC_TOP_K', '10'))
DEBUG_LOG = os.environ.get('REC_DEBUG', 'false').lower() == 'true'

def serialize_doc(doc):
    if isinstance(doc, list):
        return [serialize_doc(d) for d in doc]
    if isinstance(doc, dict):
        return {k: serialize_doc(v) for k, v in doc.items()}
    if isinstance(doc, ObjectId):
        return str(doc)
    return doc

def content_based_recommendations(user_profile, all_trips):
    """Return diversified top K recommendations using weighted content score + MMR."""
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

    # Exclude ONLY the user's own trips
    base_candidates = [t for t in all_trips if str(t.get('userId')) != user_id]

    def tag_overlap_score(trip_tags):
        if not trip_tags:
            return 0.0
        return sum(user_tags.get(tag, 0) for tag in trip_tags)

    def budget_similarity(user_b, trip_b):
        if not user_b or not trip_b:
            return 0.0
        return 1 - abs(user_b - trip_b) / max(user_b, trip_b, 1)

    def compute_raw_content_score(trip):
        score = 0.0
        # Tags
        score += WEIGHT_TAG * tag_overlap_score(trip.get('tags', []))
        # Budget
        score += WEIGHT_BUDGET * budget_similarity(user_budget, trip.get('budget'))
        # Destination match
        dest = trip.get('destination')
        if dest and dest in user_dests:
            score += WEIGHT_DESTINATION * user_dests[dest]
        # Travel style
        if user_style and trip.get('travelStyle') and user_style == trip.get('travelStyle'):
            score += WEIGHT_TRAVEL_STYLE
        # Liked / Saved boosts
        _id_str = str(trip.get('_id'))
        if _id_str in liked_ids:
            score += BOOST_LIKED
        if _id_str in saved_ids:
            score += BOOST_SAVED
        return score

    # Precompute base scores
    scored = []
    for trip in base_candidates:
        s = compute_raw_content_score(trip)
        if s > 0:  # keep only positive-scoring trips to reduce noise
            scored.append((s, trip))
    scored.sort(key=lambda x: x[0], reverse=True)

    if not scored:
        return []

    # Diversification via simple MMR (Max Marginal Relevance)
    # Similarity metric: Jaccard over tags + destination match bonus
    def similarity(t1, t2):
        tags1 = set(t1.get('tags', []) or [])
        tags2 = set(t2.get('tags', []) or [])
        tag_sim = len(tags1 & tags2) / len(tags1 | tags2) if (tags1 or tags2) else 0.0
        dest_sim = 1.0 if t1.get('destination') and t1.get('destination') == t2.get('destination') else 0.0
        # Weighted combination; destination considered moderately
        return 0.7 * tag_sim + 0.3 * dest_sim

    # Map trip id to base relevance
    relevance = {str(trip.get('_id')): base for base, trip in scored}

    selected = []
    selected_ids = set()
    # Keep counts for destination duplicate decay
    dest_counts = {}

    # Seed with highest score
    first_score, first_trip = scored[0]
    selected.append(first_trip)
    selected_ids.add(str(first_trip.get('_id')))
    dest = first_trip.get('destination')
    if dest:
        dest_counts[dest] = 1

    while len(selected) < TOP_K and len(selected_ids) < len(scored):
        best_candidate = None
        best_mmr = -1e9
        for base_score, trip in scored:
            tid = str(trip.get('_id'))
            if tid in selected_ids:
                continue
            # Diversity penalty (max similarity to already selected)
            if selected:
                max_sim = max(similarity(trip, s) for s in selected)
            else:
                max_sim = 0.0
            mmr_score = MMR_LAMBDA * base_score - (1 - MMR_LAMBDA) * max_sim
            # Destination duplicate decay
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

    # Fallback if diversification returned fewer than needed (add remaining highest)
    if len(selected) < TOP_K:
        for base_score, trip in scored:
            if len(selected) >= TOP_K:
                break
            tid = str(trip.get('_id'))
            if tid not in selected_ids:
                selected.append(trip)
                selected_ids.add(tid)

    # Return only the selected diversified list
    return [serialize_doc(t) for t in selected[:TOP_K]]

def collaborative_recommendations(user_profile, all_trips):
    # Placeholder: implement collaborative filtering logic here
    return []

def hybrid_recommendations(content_recs, collab_recs):
    # Placeholder hybrid: simply prioritize content (already diversified)
    return content_recs

@app.route('/recommend', methods=['POST'])
def recommend():
    user_profile = request.json
    if DEBUG_LOG:
        print('User preference profile received by recommender:', user_profile)
    if not user_profile or not user_profile.get('userId'):
        return jsonify({'error': 'Missing userId'}), 400

    all_trips = list(db.trips.find({}))

    # Run each recommendation strategy
    content_recs = content_based_recommendations(user_profile, all_trips)
    collab_recs = collaborative_recommendations(user_profile, all_trips)
    hybrid_recs = hybrid_recommendations(content_recs, collab_recs)

    response = {
        'topTenPicks': hybrid_recs,
        'contentBased': content_recs,
        'collaborative': collab_recs,
        'config': {
            'WEIGHT_TAG': WEIGHT_TAG,
            'WEIGHT_BUDGET': WEIGHT_BUDGET,
            'WEIGHT_DESTINATION': WEIGHT_DESTINATION,
            'WEIGHT_TRAVEL_STYLE': WEIGHT_TRAVEL_STYLE,
            'BOOST_LIKED': BOOST_LIKED,
            'BOOST_SAVED': BOOST_SAVED,
            'MMR_LAMBDA': MMR_LAMBDA,
            'DEST_DUPLICATE_DECAY': DEST_DUPLICATE_DECAY
        }
    }
    if DEBUG_LOG:
        print('Recommendation response (truncated ids):', [r.get('_id') for r in hybrid_recs])
    return jsonify(response)

if __name__ == '__main__':
    app.run(port=5001, debug=True)