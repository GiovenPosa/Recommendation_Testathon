# recommenders/followingCollaborative.py
import os, math, asyncio
from typing import List, Dict, Tuple, Any, Set, Union, Optional
from pymongo import MongoClient
from bson import ObjectId

MONGO_URI = "mongodb://appuser1:appuser1@ac-pzmwfhj-shard-00-00.jxzjzuo.mongodb.net:27017,ac-pzmwfhj-shard-00-01.jxzjzuo.mongodb.net:27017,ac-pzmwfhj-shard-00-02.jxzjzuo.mongodb.net:27017/recommendation_dataset?ssl=true&replicaSet=atlas-tq5bms-shard-0&authSource=admin&retryWrites=true&w=majority&appName=Cluster0"
client = MongoClient(MONGO_URI)
db = client.get_database("recommendation_dataset")

# ==== Config (mirror the template’s knobs) ====
TOP_K                = int(os.environ.get('REC_TOP_K', '10'))
MMR_LAMBDA           = float(os.environ.get('REC_MMR_LAMBDA', '0.7'))
DEST_DUPLICATE_DECAY = float(os.environ.get('REC_DEST_DUP_DECAY', '0.12'))

CONF_FLOOR   = float(os.environ.get('REC_CONF_FLOOR', '0.65'))
CONF_CEIL    = float(os.environ.get('REC_CONF_CEIL', '0.95'))
CONF_GAMMA   = float(os.environ.get('REC_CONF_GAMMA', '0.8'))

# CF-specific weights
WEIGHT_NEIGHBOR_LIKE  = float(os.environ.get('REC_CF_W_LIKE', '2.2'))
WEIGHT_NEIGHBOR_SAVE  = float(os.environ.get('REC_CF_W_SAVE', '1.7'))
WEIGHT_AUTHOR_FOLLOW  = float(os.environ.get('REC_CF_W_AUTHOR', '1.2'))
WEIGHT_TRAVEL_STYLE   = float(os.environ.get('REC_CF_W_STYLE', '1.6'))
WEIGHT_TAG_OVERLAP    = float(os.environ.get('REC_CF_W_TAG', '0.9'))
WEIGHT_BUDGET_SIM     = float(os.environ.get('REC_CF_W_BUD', '0.6'))
BUDGET_TOLERANCE      = float(os.environ.get('REC_BUDGET_TOL', '0.3'))

DEBUG_LOG = os.environ.get('REC_DEBUG', 'false').lower() == 'true'

# ==== Small utils (kept compatible with your template) ====
def _serialize_doc(doc):
    if isinstance(doc, list):
        return [_serialize_doc(d) for d in doc]
    if isinstance(doc, dict):
        out = {}
        for k, v in doc.items():
            out[k] = _serialize_doc(v)
        return out
    if isinstance(doc, ObjectId):
        return str(doc)
    return doc

def _to_count_dict(val) -> Dict[str, float]:
    if isinstance(val, dict):
        return {k: float(v) for k, v in val.items() if k}
    if isinstance(val, list):
        return {k: 1.0 for k in val if k}
    return {}

def _jaccard(a, b) -> float:
    A, B = set(a or []), set(b or [])
    if not A and not B:
        return 0.0
    return len(A & B) / max(1, len(A | B))

def _budget_window(avg_budget: Optional[float]) -> Tuple[float, float]:
    if not avg_budget or avg_budget <= 0:
        return (0, float('inf'))
    return (avg_budget * (1 - BUDGET_TOLERANCE), avg_budget * (1 + BUDGET_TOLERANCE))

def _to_oid(x) -> Optional[ObjectId]:
    try:
        return ObjectId(str(x))
    except Exception:
        return None

# Same “stable for eval” relevance rule signature
def _is_relevant_rule(*, base_score: float, tag_overlap: float, style_matches: bool, neighbor_signal: float) -> int:
    """
    CF relevance: positive base AND any meaningful signal from neighbors or profile alignment.
    """
    signal = (neighbor_signal > 0.0) or (tag_overlap > 0.0) or style_matches
    return 1 if (base_score > 0.0 and signal) else 0

# ==== Main ====
async def following_collaborative_recs(
    user_profile: Dict[str, Any],
    *,
    return_eval: bool = False
) -> Union[List[Dict[str, Any]], Tuple[List[Dict[str, Any]], Dict[str, Any]]]:
    """
    user_profile: {
      userId, tags, avgBudget, travelStyle,
      likedTripsIds?, savedTripsIds?, followings?  # (optionally embedded)
    }
    """
    user_id = user_profile.get("userId")
    travel_style = user_profile.get("travelStyle")
    user_tags = _to_count_dict(user_profile.get("tags", {}))
    liked_ids  = set(str(i) for i in (user_profile.get("likedTripsIds") or []))
    saved_ids  = set(str(i) for i in (user_profile.get("savedTripsIds") or []))
    avg_budget = user_profile.get("avgBudget")

    # Load the live user doc to be safe / complete
    udoc = None
    oid = _to_oid(user_id)
    if oid:
        udoc = db.users.find_one({"_id": oid}, {"followings": 1, "travelStyle": 1})
    followings_raw = (udoc or {}).get("followings") or user_profile.get("followings") or []
    neighbor_ids: List[ObjectId] = [o for o in (_to_oid(x) for x in followings_raw) if o]

    # Backfill neighbors if empty or tiny: users with the same travelStyle
    if len(neighbor_ids) < 3 and travel_style:
        extra = db.users.find(
            {"travelStyle": travel_style, "_id": {"$ne": oid} if oid else {"$exists": True}},
            {"_id": 1}
        ).limit(50)
        for row in extra:
            rid = row["_id"]
            if oid and rid == oid:
                continue
            if rid not in neighbor_ids:
                neighbor_ids.append(rid)

    neighbor_set = set(neighbor_ids)

    # Gather neighbor interactions
    # We’ll use inverted membership tests by projecting only IDs
    projection = {"_id": 1, "likes": 1, "savedBy": 1, "userId": 1, "destination": 1,
                  "tags": 1, "budget": 1, "travelStyle": 1, "title": 1, "startDate": 1, "endDate": 1}
    min_bud, max_bud = _budget_window(avg_budget)

    # Candidate trips:
    #   - liked OR saved by any neighbor, OR authored by a neighbor
    #   - not by the user, not already liked/saved by the user
    base_filter: Dict[str, Any] = {}
    if oid:
        base_filter["userId"] = {"$ne": oid}

    # Build OR for neighbor signals
    neighbor_or: List[Dict[str, Any]] = []
    if neighbor_ids:
        neighbor_or.extend([
            {"likes":   {"$elemMatch": {"$in": neighbor_ids}}},
            {"savedBy": {"$elemMatch": {"$in": neighbor_ids}}},
            {"userId":  {"$in": neighbor_ids}},
        ])

    if not neighbor_or:
        # If absolutely no neighbors, bail early
        return [] if not return_eval else ([], {"recommendedTripIds": [], "relevantTripIds": [], "allCandidateTripIds": []})

    query: Dict[str, Any] = {"$or": neighbor_or, **base_filter}
    if avg_budget:
        query["budget"] = {"$gte": min_bud, "$lte": max_bud}

    # Optional tag narrowing if user tags exist
    if user_tags:
        query["tags"] = {"$in": list(user_tags.keys())}

    candidates = list(db.trips.find(query, projection))

    # Filter out user's already interacted trips
    def _omit_user_interacted(t) -> bool:
        sid = str(t.get("_id"))
        return (sid not in liked_ids) and (sid not in saved_ids)

    candidates = [t for t in candidates if _omit_user_interacted(t)]
    if not candidates:
        return [] if not return_eval else ([], {"recommendedTripIds": [], "relevantTripIds": [], "allCandidateTripIds": []})

    # Precompute for scoring
    tag_norm = math.sqrt(sum(v*v for v in user_tags.values())) or 1.0

    def tag_overlap_score(trip_tags: List[str]) -> float:
        return sum(user_tags.get(t, 0.0) for t in (trip_tags or []))

    def tag_cosine_like(trip_tags: List[str]) -> float:
        if not trip_tags:
            return 0.0
        return sum((user_tags.get(t, 0.0) / tag_norm) for t in trip_tags)

    def budget_similarity(u: float, b: float) -> float:
        if not u or not b or u <= 0 or b <= 0:
            return 0.0
        return 1 - abs(u - b) / max(u, b, 1)

    # Score components per trip
    def base_score(trip: Dict[str, Any]) -> Tuple[float, float, float, bool, float]:
        tlikes  = set(_to_oid(x) for x in (trip.get("likes") or []))
        tlikes  = set(x for x in tlikes if x is not None)
        tsaved  = set(_to_oid(x) for x in (trip.get("savedBy") or []))
        tsaved  = set(x for x in tsaved if x is not None)
        author  = trip.get("userId")

        liked_by_neighbors = len(neighbor_set & tlikes)
        saved_by_neighbors = len(neighbor_set & tsaved)
        authored_by_neighbor = 1 if (author in neighbor_set) else 0

        ttags = trip.get("tags", []) or []
        style_m = bool(travel_style and trip.get("travelStyle") == travel_style)
        bud_sim = budget_similarity(avg_budget, trip.get("budget"))
        tag_ov  = tag_overlap_score(ttags)
        tag_cos = tag_cosine_like(ttags)

        neighbor_signal = (
            WEIGHT_NEIGHBOR_LIKE * liked_by_neighbors +
            WEIGHT_NEIGHBOR_SAVE * saved_by_neighbors +
            WEIGHT_AUTHOR_FOLLOW * authored_by_neighbor
        )

        score = 0.0
        score += neighbor_signal
        if style_m:
            score += WEIGHT_TRAVEL_STYLE
        score += WEIGHT_TAG_OVERLAP * (tag_ov + 0.25 * tag_cos)
        score += WEIGHT_BUDGET_SIM * bud_sim

        return score, tag_ov, style_m, neighbor_signal, bud_sim

    # Score all candidates
    scored: List[Tuple[float, Dict[str, Any], Tuple[float, float, bool, float, float]]] = []
    all_candidate_ids: List[str] = []
    relevant_candidate_ids: List[str] = []

    for t in candidates:
        s, tag_ov, style_m, neigh_sig, bud_sim = base_score(t)
        tid = str(t["_id"])
        all_candidate_ids.append(tid)
        if s > 0:
            scored.append((s, t, (tag_ov, neigh_sig, style_m, bud_sim, 0.0)))
            if _is_relevant_rule(base_score=s, tag_overlap=tag_ov, style_matches=style_m, neighbor_signal=neigh_sig):
                relevant_candidate_ids.append(tid)

    if not scored:
        return [] if not return_eval else ([], {"recommendedTripIds": [], "relevantTripIds": [], "allCandidateTripIds": all_candidate_ids})

    scored.sort(key=lambda x: x[0], reverse=True)
    abs_max_base = scored[0][0]

    # MMR diversify by tag overlap
    def sim_trip(a: Dict[str, Any], b: Dict[str, Any]) -> float:
        return _jaccard(a.get("tags", []), b.get("tags", []))

    selected, selected_ids = [], set()
    dest_counts: Dict[str, int] = {}

    s0, t0, _ = scored[0]
    selected.append(t0)
    selected_ids.add(str(t0["_id"]))
    d0 = (t0.get("destination") or "").strip()
    if d0:
        dest_counts[d0] = 1

    while len(selected) < TOP_K and len(selected_ids) < len(scored):
        best, best_val = None, -1e9
        for base, t, _comp in scored:
            tid = str(t["_id"])
            if tid in selected_ids:
                continue
            max_sim = max((sim_trip(t, s) for s in selected), default=0.0)
            mmr = MMR_LAMBDA * base - (1 - MMR_LAMBDA) * max_sim
            dd = (t.get("destination") or "").strip()
            if dd and dest_counts.get(dd, 0) > 0:
                mmr -= DEST_DUPLICATE_DECAY * dest_counts[dd]
            if mmr > best_val:
                best, best_val = t, mmr
        if not best:
            break
        selected.append(best)
        selected_ids.add(str(best["_id"]))
        dd = (best.get("destination") or "").strip()
        if dd:
            dest_counts[dd] = dest_counts.get(dd, 0) + 1

    if len(selected) < TOP_K:
        for base, t, _comp in scored:
            if len(selected) >= TOP_K:
                break
            tid = str(t["_id"])
            if tid not in selected_ids:
                selected.append(t)
                selected_ids.add(tid)

    # Normalize + confidence + isRelevant (same curve as template)
    selected_scored: List[Tuple[float, Dict[str, Any], Tuple[float, float, bool, float, float]]] = []
    for t in selected[:TOP_K]:
        s, tag_ov, style_m, neigh_sig, bud_sim = base_score(t)
        selected_scored.append((s, t, (tag_ov, neigh_sig, style_m, bud_sim, 0.0)))

    sel_max = max(s for s, _, _ in selected_scored)
    sel_min = min(s for s, _, _ in selected_scored)
    sel_rng = max(1e-9, sel_max - sel_min)

    results: List[Dict[str, Any]] = []
    for s, trip, (tag_ov, neigh_sig, style_m, bud_sim, _) in selected_scored:
        score_norm = (s - sel_min) / sel_rng
        raw_ratio  = (s / abs_max_base) if abs_max_base > 0 else 0.0
        raw_ratio  = max(0.0, min(1.0, raw_ratio))
        curved     = raw_ratio ** CONF_GAMMA
        confidence = CONF_FLOOR + (CONF_CEIL - CONF_FLOOR) * curved

        out = _serialize_doc(trip)
        out["score"] = round(float(score_norm), 3)
        out["confidence"] = round(float(confidence), 3)
        out["confidenceLabel"] = f"{int(round(confidence * 100))}% likely to enjoy"

        out["isRelevant"] = _is_relevant_rule(
            base_score=s, tag_overlap=tag_ov, style_matches=style_m, neighbor_signal=neigh_sig
        )

        if DEBUG_LOG:
            out["_components"] = {
                "base_score": round(float(s), 4),
                "score_norm_minmax": round(float(score_norm), 4),
                "abs_ratio_to_best": round(float(raw_ratio), 4),
                "confidence": round(float(confidence), 4),
                "neighbor_like_save_author": round(float(neigh_sig), 4),
                "tag_overlap": round(float(tag_ov), 4),
                "style_match": style_m,
                "budget_sim": round(float(bud_sim), 4),
            }
            out["_conf_params"] = {"floor": CONF_FLOOR, "ceil": CONF_CEIL, "gamma": CONF_GAMMA}

        results.append(out)

    if not return_eval:
        return results

    eval_dict = {
        "recommendedTripIds": [str(t["_id"]) for t in results if "_id" in t],
        "relevantTripIds": list(dict.fromkeys(relevant_candidate_ids)),
        "allCandidateTripIds": list(dict.fromkeys(all_candidate_ids)),
    }
    return results, eval_dict