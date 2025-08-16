import os, re
from pymongo import MongoClient
from typing import List, Dict, Tuple, Any, Union
from bson import ObjectId

from datetime import datetime, timedelta, timezone

MONGO_URI = "mongodb://appuser1:appuser1@ac-pzmwfhj-shard-00-00.jxzjzuo.mongodb.net:27017,ac-pzmwfhj-shard-00-01.jxzjzuo.mongodb.net:27017,ac-pzmwfhj-shard-00-02.jxzjzuo.mongodb.net:27017/recommendation_dataset?ssl=true&replicaSet=atlas-tq5bms-shard-0&authSource=admin&retryWrites=true&w=majority&appName=Cluster0"
client = MongoClient(MONGO_URI, tz_aware=True, tzinfo=timezone.utc)
db = client.get_database('recommendation_dataset')

WEIGHT_POPULARITY = float(os.environ.get('REC_WEIGHT_POP', '5.2'))
POPULARITY_LIKE_WEIGHT = float(os.environ.get('REC_POP_LIKE_W', '0.2'))
POPULARITY_SAVE_WEIGHT = float(os.environ.get('REC_POP_SAVE_W', '0.2'))
TIME_DECAY_HALFLIFE_DAYS = float(os.environ.get('REC_POP_HALFLIFE_D', '90'))  # exponential half-life for recency
WEIGHT_INTERACT_TAGS = float(os.environ.get('REC_W_INTER_TAGS', '0.8'))
WEIGHT_INTERACT_DEST = float(os.environ.get('REC_W_INTER_DEST', '0.6'))
WEIGHT_TAG           = float(os.environ.get('REC_WEIGHT_TAG', '1.0'))
WEIGHT_REGION_SIM    = float(os.environ.get('REC_WEIGHT_REGION', '1.2'))
WEIGHT_CLIMATE_SIM   = float(os.environ.get('REC_WEIGHT_CLIMATE', '1.0'))
WEIGHT_TRAVEL_STYLE  = float(os.environ.get('REC_WEIGHT_STYLE', '1.8'))
WEIGHT_BUDGET        = float(os.environ.get('REC_WEIGHT_BUDGET', '0.8'))
MMR_LAMBDA           = float(os.environ.get('REC_MMR_LAMBDA', '0.7'))
DEST_DUPLICATE_DECAY = float(os.environ.get('REC_DEST_DUP_DECAY', '0.12'))
TOP_K                = int(os.environ.get('REC_TOP_K', '10'))
BUDGET_TOLERANCE     = float(os.environ.get('REC_BUDGET_TOL', '0.3'))  # ±30%
CONF_FLOOR   = float(os.environ.get('REC_CONF_FLOOR', '0.65'))  # min displayed confidence (65%)
CONF_CEIL    = float(os.environ.get('REC_CONF_CEIL', '0.98'))   # max displayed confidence (98%)
CONF_GAMMA   = float(os.environ.get('REC_CONF_GAMMA', '0.8'))   # curve <1 lifts tail; >1 compresses tail

LAST_N_MONTHS = int(os.environ.get('REC_POP_MONTHS', '12'))

def _serialize_doc(doc):
    from bson import ObjectId
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

def _safe_int(x, default=0) -> int:
    try:
        return int(x or 0)
    except Exception:
        return default

def _now_utc() -> datetime:
    return datetime.now(timezone.utc)

def _to_aware_utc(dt: datetime) -> datetime:
    if not isinstance(dt, datetime):
        return None
    # Mongo with tz_aware=True already returns aware; this is just defensive
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)

def _days_since(dt: datetime) -> float:
    dt_aware = _to_aware_utc(dt)
    if not dt_aware:
        return 1e9
    return max(0.0, (_now_utc() - dt_aware).total_seconds() / 86400.0)

def _exp_time_decay(days: float, half_life_days: float) -> float:
    if half_life_days <= 0:
        return 1.0
    return 0.5 ** (days / half_life_days)

def _collect_interaction_prefs(user_profile: Dict[str, Any]) -> Tuple[Dict[str, float], Dict[str, float]]:
    """
    Look at likedTripsIds & savedTripsIds and build preference counts for tags & destinations.
    Returns: (tag_pref_counts, dest_pref_counts)
    """
    tag_pref: Dict[str, float] = {}
    dest_pref: Dict[str, float] = {}

    liked_ids = [ObjectId(i) for i in user_profile.get('likedTripsIds') or [] if re.fullmatch(r"[0-9a-fA-F]{24}", str(i))]
    saved_ids = [ObjectId(i) for i in user_profile.get('savedTripsIds') or [] if re.fullmatch(r"[0-9a-fA-F]{24}", str(i))]

    boost_liked = 1.0
    boost_saved = 1.3  # tiny extra weight for "saved" as stronger intent

    def bump(d: Dict[str, float], key: str, w: float = 1.0):
        if not key:
            return
        d[key] = d.get(key, 0.0) + w

    if liked_ids:
        for t in db.trips.find({"_id": {"$in": liked_ids}}, {"tags": 1, "destination": 1}):
            for tag in (t.get("tags") or []):
                bump(tag_pref, tag, boost_liked)
            bump(dest_pref, (t.get("destination") or "").strip(), boost_liked)

    if saved_ids:
        for t in db.trips.find({"_id": {"$in": saved_ids}}, {"tags": 1, "destination": 1}):
            for tag in (t.get("tags") or []):
                bump(tag_pref, tag, boost_saved)
            bump(dest_pref, (t.get("destination") or "").strip(), boost_saved)

    return tag_pref, dest_pref
  
def _is_relevant_rule(components: Dict[str, float], travel_style_match: bool) -> int:
    """
    Ground-truth relevance label used for evaluation.
    Adjust to your preferred definition. Current rule:
      Relevant if (style matches) OR (there was any interaction boost).
    """
    has_interaction = (components.get("inter_tags", 0.0) > 0.0) or (components.get("inter_dest", 0.0) > 0.0)
    return 1 if (travel_style_match or has_interaction) else 0

async def most_popular_trending_recs(user_profile: Dict[str, Any], *, return_eval: bool = False) -> Union[List[Dict[str, Any]], Tuple[List[Dict[str, Any]], Dict[str, Any]]]:
    """
    Strategy:
      1) Pull trips created in the last N months.
      2) Compute popularity = like_w * likes + save_w * saves, with time decay (newer = stronger).
      3) Relevance:
         - Big boost for matching travelStyle (dominant factor).
         - Soft boosts for tags/destinations the user interacted with (liked/saved).
      4) Sort by total score, diversify a bit by destination, return TOP_K with a normalized 'score' (0..1).
    """
    user_id      = user_profile.get("userId")
    travel_style = (user_profile.get("travelStyle") or "").strip()
    exclude_user_oid = None
    if user_id:
        try:
            exclude_user_oid = ObjectId(user_id)
        except Exception:
            exclude_user_oid = None

    # Build interaction-derived preferences
    interact_tag_pref, interact_dest_pref = _collect_interaction_prefs(user_profile)

    # Query trips from last 12 months
    since = datetime.now(timezone.utc) - timedelta(days=LAST_N_MONTHS * 30)
    base_filter: Dict[str, Any] = {
        "$or": [
            {"createdAt": {"$gte": since}},
            {"updatedAt": {"$gte": since}},
        ]
    }
    if exclude_user_oid:
        base_filter["userId"] = {"$ne": exclude_user_oid}

    projection = {
        "_id": 1, "destination": 1, "tags": 1, "budget": 1, "travelStyle": 1, "userId": 1,
        "title": 1, "createdAt": 1, "updatedAt": 1, "startDate": 1, "endDate": 1,
        # Optional counters/arrays if present:
        "likes": 1, "savedBy": 1
    }

    candidates = list(db.trips.find(base_filter, projection))
    if not candidates:
        return []

    # Compute popularity and relevance components
    pop_vals: List[Tuple[float, Dict[str, Any], Dict[str, float]]] = []  # (score, trip, components)
    max_pop_component = 1e-9

    for t in candidates:
        created = t.get("createdAt") or t.get("updatedAt")
        days = _days_since(created) if created else 365.0
        decay = _exp_time_decay(days, TIME_DECAY_HALFLIFE_DAYS)

        # handle both counters or arrays
        likes = _safe_int(t.get("likesCount"))
        saves = _safe_int(t.get("savesCount"))
        if not likes and isinstance(t.get("likes"), list):
            likes = len(t["likes"])
        if not saves and isinstance(t.get("savedBy"), list):
            saves = len(t["savedBy"])

        popularity_raw = POPULARITY_LIKE_WEIGHT * likes + POPULARITY_SAVE_WEIGHT * saves
        popularity = popularity_raw * decay

        # style relevance (dominant)
        style_match = 1.0 if travel_style and t.get("travelStyle") == travel_style else 0.0

        # interaction boosts
        ttags = t.get("tags") or []
        tag_inter_boost = sum(interact_tag_pref.get(tag, 0.0) for tag in ttags)
        dest_name = (t.get("destination") or "").strip()
        dest_inter_boost = interact_dest_pref.get(dest_name, 0.0)

        components = {
            "popularity": popularity,
            "style": style_match * WEIGHT_TRAVEL_STYLE,
            "inter_tags": tag_inter_boost * WEIGHT_INTERACT_TAGS,
            "inter_dest": dest_inter_boost * WEIGHT_INTERACT_DEST,
        }

        # keep track for normalization
        max_pop_component = max(max_pop_component, components["popularity"])
        pop_vals.append((0.0, t, components))

    # First normalize the popularity component to [0,1]
    for i in range(len(pop_vals)):
        _, t, comp = pop_vals[i]
        pop_norm = comp["popularity"] / max_pop_component if max_pop_component > 0 else 0.0

        # final score = weighted popularity + components
        total = (
            WEIGHT_POPULARITY * pop_norm
            + comp["style"]
            + comp["inter_tags"]
            + comp["inter_dest"]
        )
        pop_vals[i] = (total, t, comp | {"pop_norm": pop_norm})

    # Sort by total score
    pop_vals.sort(key=lambda x: x[0], reverse=True)

     # Light destination de-dup (same idea as your duplicate decay)
    picked: List[Tuple[float, Dict[str, Any], Dict[str, float]]] = []
    dest_counts: Dict[str, int] = {}

    for total, trip, comp in pop_vals:
        if len(picked) >= TOP_K:
            break
        dest = (trip.get("destination") or "").strip()
        penalty = DEST_DUPLICATE_DECAY * dest_counts.get(dest, 0)
        adjusted = total - penalty
        picked.append((adjusted, trip, comp))
        if dest:
            dest_counts[dest] = dest_counts.get(dest, 0) + 1

    # If nothing made it through, bail early
    if not picked:
        return []

    # === Probability-like confidence mapping (similar to your other engines) ===
    # Work on the adjusted totals (post de-dup penalty)
    # 1) Sort by adjusted score (desc) for presentation
    finals = sorted(picked, key=lambda x: x[0], reverse=True)

    # 2) Legacy 0..1 min-max normalization within the selected set (for sorting/UI)
    max_s = finals[0][0]
    min_s = finals[-1][0]
    rng   = max(1e-9, max_s - min_s)

    # 3) Probability-like confidence: ratio-to-best with gamma curve, clamped to [CONF_FLOOR..CONF_CEIL]
    #    (gamma < 1 lifts the tail so the last item doesn't show near-0%)
    max_adjusted = max(adjusted for adjusted, _, _ in picked)

    results: List[Dict[str, Any]] = []
    for adjusted, trip, comp in finals[:TOP_K]:
        # legacy normalized score (0..1 within selected)
        score_norm = (adjusted - min_s) / rng

        # probability-like confidence
        raw_ratio  = (adjusted / max_adjusted) if max_adjusted > 0 else 0.0
        curved     = raw_ratio ** CONF_GAMMA
        confidence = CONF_FLOOR + (CONF_CEIL - CONF_FLOOR) * curved

        out = _serialize_doc(trip)
        out["score"] = round(float(score_norm), 3)          # legacy 0..1
        out["confidence"] = round(float(confidence), 3)     # e.g. 0.65..0.98
        out["confidenceLabel"] = f"{int(round(confidence * 100))}% likely to enjoy"

        # NEW: stable, per-item ground-truth label for evaluation
        style_match_bool = bool(comp.get("style", 0) > 0)
        out["isRelevant"] = _is_relevant_rule(comp, style_match_bool)

        if os.environ.get("REC_DEBUG", "false").lower() == "true":
            out["_components"] = {
                "adjusted": round(float(adjusted), 4),
                "score_norm_minmax": round(float(score_norm), 4),
                "raw_ratio_to_best": round(float(raw_ratio), 4),
                "confidence": round(float(confidence), 4),
                **{k: (round(float(v), 4) if isinstance(v, (int, float)) else v) for k, v in comp.items()},
            }
            out["_conf_params"] = {"floor": CONF_FLOOR, "ceil": CONF_CEIL, "gamma": CONF_GAMMA}

        results.append(out)
        
    if not return_eval:
        # Backward-compatible: return just the list
        return results

    # === Eval sidecar (for precision/recall/F1) ===
    # Recommended = the TOP_K we return.
    recommended_ids = [str(t["_id"]) for t in results if "_id" in t]
    # Relevant = compute over the *candidate pool* using the same rule
    # (so recall can drop below 1.0 if we missed relevant items).
    all_candidate_ids: List[str] = []
    relevant_candidate_ids: List[str] = []
    for total, cand, comp in pop_vals:
        all_candidate_ids.append(str(cand["_id"]))
        style_match_bool = bool(comp.get("style", 0) > 0)
        if _is_relevant_rule(comp, style_match_bool) == 1:
            relevant_candidate_ids.append(str(cand["_id"]))

    eval_dict = {
        "recommendedTripIds": recommended_ids,
        "relevantTripIds": relevant_candidate_ids,     # ground-truth among all candidates
        "allCandidateTripIds": all_candidate_ids       # optional but useful
    }

    return results, eval_dict