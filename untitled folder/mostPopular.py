import os, re
from pymongo import MongoClient
from typing import List, Dict, Tuple, Any
from bson import ObjectId

from datetime import datetime, timedelta, timezone

MONGO_URI = "mongodb://appuser1:appuser1@ac-pzmwfhj-shard-00-00.jxzjzuo.mongodb.net:27017,ac-pzmwfhj-shard-00-01.jxzjzuo.mongodb.net:27017,ac-pzmwfhj-shard-00-02.jxzjzuo.mongodb.net:27017/recommendation_dataset?ssl=true&replicaSet=atlas-tq5bms-shard-0&authSource=admin&retryWrites=true&w=majority&appName=Cluster0"
client = MongoClient(MONGO_URI, tz_aware=True, tzinfo=timezone.utc)
db = client.get_database('recommendation_dataset')

MOSTLIKED_MONTHS       = int(os.environ.get('REC_MOSTLIKED_MONTHS', os.environ.get('REC_POP_MONTHS', '0')))
MOSTLIKED_USE_DECAY    = os.environ.get('REC_MOSTLIKED_USE_DECAY', 'false').lower() == 'true'
DEST_DUPLICATE_DECAY   = float(os.environ.get('REC_DEST_DUP_DECAY', '0.12'))
LAST_N_MONTHS    = int(os.environ.get('REC_POP_MONTHS', str(MOSTLIKED_MONTHS)))
TOP_K                  = int(os.environ.get('REC_TOP_K', '10'))
TIME_DECAY_HALFLIFE_DAYS = float(os.environ.get('REC_POP_HALFLIFE_D', '90'))  # reuse your existing knob

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

async def most_liked_recs(user_profile: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Returns TOP_K trips sorted ONLY by 'likes' (desc).
    - Looks back MOSTLIKED_MONTHS months (set to 0 to disable window).
    - Optionally applies exponential time decay (toggle MOSTLIKED_USE_DECAY).
    - Light destination de-duplication using DEST_DUPLICATE_DECAY.
    Output includes a normalized 'score' (0..1) and 'likesCount'.
    """
    user_id = user_profile.get("userId")
    exclude_user_oid = None
    if user_id:
        try:
            exclude_user_oid = ObjectId(user_id)
        except Exception:
            exclude_user_oid = None

    # Time window
    base_filter: Dict[str, Any] = {}
    # Time window
    if MOSTLIKED_MONTHS and MOSTLIKED_MONTHS > 0:
        since = _now_utc() - timedelta(days=LAST_N_MONTHS * 30)
        base_filter["$or"] = [
            {"createdAt": {"$gte": since}},
            {"updatedAt": {"$gte": since}},
    ]


    if exclude_user_oid:
        base_filter["userId"] = {"$ne": exclude_user_oid}

    projection = {
        "_id": 1, "title": 1, "destination": 1, "tags": 1, "budget": 1, "travelStyle": 1,
        "createdAt": 1, "updatedAt": 1,
        # any field you may have:
        "likesCount": 1, "likes": 1, "likedBy": 1, "startDate": 1, "endDate": 1, "userId": 1,
    }

    trips = list(db.trips.find(base_filter, projection))
    if not trips:
        return []

    scored: List[Tuple[float, Dict[str, Any], Dict[str, float]]] = []  # (score, trip, comps)
    max_like_component = 1e-9

    for t in trips:
        # resolve like count from any schema variant you use
        likes = _safe_int(t.get("likesCount"))
        if not likes and isinstance(t.get("likes"), list):
            likes = len(t["likes"])
        if not likes and isinstance(t.get("likedBy"), list):
            likes = len(t["likedBy"])

        if likes <= 0:
            continue  # skip unliked items

        # optional time decay
        created = t.get("createdAt") or t.get("updatedAt")
        days = _days_since(created)
        decay = _exp_time_decay(days, TIME_DECAY_HALFLIFE_DAYS) if MOSTLIKED_USE_DECAY else 1.0

        like_component = float(likes) * decay
        max_like_component = max(max_like_component, like_component)

        comps = {
            "likes_raw": float(likes),
            "decay": float(decay),
            "like_component": like_component
        }
        scored.append((like_component, t, comps))

    if not scored:
        return []

    # Normalize like_component to [0,1]
    for i in range(len(scored)):
        like_comp, trip, comps = scored[i]
        like_norm = like_comp / max_like_component if max_like_component > 0 else 0.0
        scored[i] = (like_norm, trip, {**comps, "like_norm": like_norm})

    # Sort by normalized like score
    scored.sort(key=lambda x: x[0], reverse=True)

    # Light destination de-dup penalty
    picked: List[Tuple[float, Dict[str, Any], Dict[str, float]]] = []
    dest_counts: Dict[str, int] = {}
    for base_norm, trip, comps in scored:
        if len(picked) >= TOP_K:
            break
        dest = (trip.get("destination") or "").strip()
        penalty = DEST_DUPLICATE_DECAY * dest_counts.get(dest, 0)
        adjusted = base_norm - penalty
        picked.append((adjusted, trip, comps))
        if dest:
            dest_counts[dest] = dest_counts.get(dest, 0) + 1

    if not picked:
        return []

    # Re-normalize picked scores to 0..1 for UI display
    picked.sort(key=lambda x: x[0], reverse=True)
    max_s = picked[0][0]
    min_s = picked[-1][0]
    rng = max(1e-9, max_s - min_s)

    results: List[Dict[str, Any]] = []
    for total, trip, comps in picked[:TOP_K]:
        score_norm = (total - min_s) / rng
        out = _serialize_doc(trip)
        out["score"] = round(float(score_norm), 3)
        out["likesCount"] = int(comps.get("likes_raw", 0))
        if os.environ.get("REC_DEBUG", "false").lower() == "true":
            out["_components"] = {
                "likes_raw": int(comps.get("likes_raw", 0)),
                "decay": round(float(comps.get("decay", 1.0)), 4),
                "like_component": round(float(comps.get("like_component", 0.0)), 4),
                "like_norm": round(float(comps.get("like_norm", 0.0)), 4),
                "total_norm_after_penalty": round(float(score_norm), 4),
            }
        results.append(out)

    return results