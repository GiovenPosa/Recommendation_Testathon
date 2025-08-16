# recommenders/destinationSimilarityMap.py
import os, json, math, asyncio, re
from pymongo import MongoClient
from typing import List, Dict, Tuple, Any, Set, Optional, Union
from bson import ObjectId
import httpx

MONGO_URI = "mongodb://appuser1:appuser1@ac-pzmwfhj-shard-00-00.jxzjzuo.mongodb.net:27017,ac-pzmwfhj-shard-00-01.jxzjzuo.mongodb.net:27017,ac-pzmwfhj-shard-00-02.jxzjzuo.mongodb.net:27017/recommendation_dataset?ssl=true&replicaSet=atlas-tq5bms-shard-0&authSource=admin&retryWrites=true&w=majority&appName=Cluster0"
client = MongoClient(MONGO_URI)
db = client.get_database('recommendation_dataset')

# ==== Config ====
WEIGHT_TAG           = float(os.environ.get('REC_WEIGHT_TAG', '2.0'))
WEIGHT_REGION_SIM    = float(os.environ.get('REC_WEIGHT_REGION', '1.2'))
WEIGHT_CLIMATE_SIM   = float(os.environ.get('REC_WEIGHT_CLIMATE', '1.0'))
WEIGHT_TRAVEL_STYLE  = float(os.environ.get('REC_WEIGHT_STYLE', '1.8'))
WEIGHT_BUDGET        = float(os.environ.get('REC_WEIGHT_BUDGET', '0.8'))
MMR_LAMBDA           = float(os.environ.get('REC_MMR_LAMBDA', '0.7'))
DEST_DUPLICATE_DECAY = float(os.environ.get('REC_DEST_DUP_DECAY', '0.12'))
TOP_K                = int(os.environ.get('REC_TOP_K', '10'))
BUDGET_TOLERANCE     = float(os.environ.get('REC_BUDGET_TOL', '0.3'))  # ±30%
CONF_FLOOR   = float(os.environ.get('REC_CONF_FLOOR', '0.65'))
CONF_CEIL    = float(os.environ.get('REC_CONF_CEIL', '0.95'))
CONF_GAMMA   = float(os.environ.get('REC_CONF_GAMMA', '0.8'))

OLLAMA_URL           = os.environ.get('OLLAMA_URL', 'http://localhost:11434/api/chat')
OLLAMA_MODEL         = os.environ.get('OLLAMA_MODEL', 'mistral:7b')

# ==== Small utils ====
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

def _budget_window(avg_budget: float) -> Tuple[float, float]:
    if not avg_budget or avg_budget <= 0:
        return (0, float('inf'))
    return (avg_budget * (1 - BUDGET_TOLERANCE), avg_budget * (1 + BUDGET_TOLERANCE))

# ==== Ollama ====
async def _ollama_similar_regions(recent_city_country: List[str], top_tags: List[str], timeout=25) -> Dict[str, Any]:
    if not recent_city_country:
        return {"countries": [], "cities": []}

    system_msg = (
        "You are a travel geographer. Given a list of visited city-country pairs, "
        "return other countries and cities that are similar by region/culture and climate. "
        "Respond ONLY as JSON with keys 'countries' and 'cities'. "
        "Each item must include 'name', 'region_sim' (0..1), and 'climate_sim' (0..1). "
        "Do not repeat any input cities."
    )
    user_payload = {
        "visited": recent_city_country,
        "tags_hint": top_tags[:10],
        "instructions": "Propose 10-20 countries and 15-30 cities. Be conservative with similarity scores."
    }

    body = {
        "model": OLLAMA_MODEL,
        "messages": [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": json.dumps(user_payload)}
        ],
        "stream": False,
        "options": {"temperature": 0.2}
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(OLLAMA_URL, json=body)
            r.raise_for_status()
            data = r.json()
            content = (data.get("message") or {}).get("content", "")
            try:
                parsed = json.loads(content)
            except json.JSONDecodeError:
                start, end = content.find('{'), content.rfind('}')
                parsed = json.loads(content[start:end+1]) if start != -1 and end != -1 else {}
            countries = parsed.get("countries", []) or []
            cities = parsed.get("cities", []) or []

            def clean(rows):
                cleaned, seen = [], set()
                for row in rows:
                    name = (row.get("name") or "").strip()
                    if not name or name in seen:
                        continue
                    try:
                        rs = float(row.get("region_sim", 0.0))
                        cs = float(row.get("climate_sim", 0.0))
                    except Exception:
                        rs, cs = 0.0, 0.0
                    cleaned.append({
                        "name": name,
                        "region_sim": max(0.0, min(1.0, rs)),
                        "climate_sim": max(0.0, min(1.0, cs))
                    })
                    seen.add(name)
                return cleaned

            return {"countries": clean(countries), "cities": clean(cities)}
    except Exception:
        return {"countries": [], "cities": []}

# === Relevance rule (stable for eval)
def _is_relevant_rule(*, base_score: float, rs: float, cs: float, tag_overlap: float, style_matches: bool) -> int:
    """
    Label as relevant if the candidate shows any meaningful alignment:
      - positive base score AND (region/climate signal OR tag overlap OR style match)
    Tweak as you like, but keep it stable across runs for consistent eval.
    """
    signal = (rs > 0.0) or (cs > 0.0) or (tag_overlap > 0.0) or style_matches
    return 1 if (base_score > 0.0 and signal) else 0

# ==== Main entry ====
async def destination_similarity_map_recs(
    user_profile: Dict[str, Any],
    top_cities,
    *,
    return_eval: bool = False
) -> Union[List[Dict[str, Any]], Tuple[List[Dict[str, Any]], Dict[str, Any]]]:
    """
    user_profile: { userId, tags, avgBudget, travelStyle, recentDestinations, likedTripsIds, savedTripsIds }
    top_cities: instance with match_destination()
    """
    user_id = user_profile.get('userId')
    user_tags = _to_count_dict(user_profile.get('tags', {}))
    avg_budget = user_profile.get('avgBudget')
    travel_style = user_profile.get('travelStyle')
    visited_dict = _to_count_dict(user_profile.get('recentDestinations', {}))

    visited_names: Set[str] = set(visited_dict.keys())
    if user_id:
        try:
            oid = ObjectId(user_id)
            for t in db.trips.find({"userId": oid}, {"destination": 1}):
                d = (t.get("destination") or "").strip()
                if d:
                    visited_names.add(d)
        except Exception:
            pass

    recent_city_country: List[str] = []
    for raw in visited_names:
        matches = top_cities.match_destination(raw)
        if matches:
            cc = f"{matches[0].city}, {matches[0].country}"
            recent_city_country.append(cc)
        else:
            recent_city_country.append(raw)

    tag_items = sorted(user_tags.items(), key=lambda kv: kv[1], reverse=True)
    top_tags = [k for k, _ in tag_items[:12]]

    # 1) LLM for similar places
    sim_map = await _ollama_similar_regions(recent_city_country, top_tags)
    sim_countries = {row["name"]: (row["region_sim"], row["climate_sim"]) for row in sim_map.get("countries", [])}
    sim_cities    = {row["name"]: (row["region_sim"], row["climate_sim"]) for row in sim_map.get("cities", [])}

    # 2) Candidates query
    min_bud, max_bud = _budget_window(avg_budget)
    base_filter = { "destination": {"$nin": list(visited_names)} }
    if user_id:
        try:
            base_filter["userId"] = {"$ne": ObjectId(user_id)}
        except Exception:
            pass

    tag_list = list(user_tags.keys())
    tag_clause = {"tags": {"$in": tag_list}} if tag_list else {}
    budget_clause = {"budget": {"$gte": min_bud, "$lte": max_bud}} if avg_budget else {}

    dest_whitelist = set(sim_cities.keys())
    dest_clause = {"destination": {"$in": list(dest_whitelist)}} if dest_whitelist else {}

    mongo_query = {**base_filter, **tag_clause, **budget_clause, **dest_clause}
    projection = {
        "_id": 1, "destination": 1, "tags": 1, "budget": 1, "travelStyle": 1,
        "userId": 1, "title": 1, "startDate": 1, "endDate": 1, "likes": 1, "savedBy": 1
    }
    candidates = list(db.trips.find(mongo_query, projection))

    if not candidates:
        mongo_query = {**base_filter, **tag_clause, **budget_clause}
        candidates = list(db.trips.find(mongo_query, projection))

    if not candidates:
        return [] if not return_eval else ([], {"recommendedTripIds": [], "relevantTripIds": [], "allCandidateTripIds": []})

    # 3) Scoring helpers
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

    def region_climate_score(dest: str) -> Tuple[float, float]:
        if dest in sim_cities:
            return sim_cities[dest]
        matches = top_cities.match_destination(dest)
        if matches:
            key = f"{matches[0].city}, {matches[0].country}"
            if key in sim_cities:
                return sim_cities[key]
            country = matches[0].country
            if country in sim_countries:
                return sim_countries[country]
        return (0.0, 0.0)

    def base_score(trip: Dict[str, Any]) -> Tuple[float, float, float, float, bool]:
        ttags = trip.get("tags", []) or []
        dest = (trip.get("destination") or "").strip()

        # components
        tag_ov  = tag_overlap_score(ttags)
        tag_cos = tag_cosine_like(ttags)
        rs, cs  = region_climate_score(dest)
        style_m = bool(travel_style and trip.get("travelStyle") == travel_style)
        bud_sim = budget_similarity(avg_budget, trip.get("budget"))

        score = 0.0
        score += WEIGHT_TAG * tag_ov
        score += 0.25 * tag_cos
        score += WEIGHT_REGION_SIM * rs
        score += WEIGHT_CLIMATE_SIM * cs
        if style_m:
            score += WEIGHT_TRAVEL_STYLE
        score += WEIGHT_BUDGET * bud_sim

        return score, rs, cs, tag_ov, style_m

    # score all candidates
    scored: List[Tuple[float, Dict[str, Any], Tuple[float, float, float, bool]]] = []
    all_candidate_ids: List[str] = []
    relevant_candidate_ids: List[str] = []

    for t in candidates:
        s, rs, cs, tag_ov, style_m = base_score(t)
        tid = str(t["_id"])
        all_candidate_ids.append(tid)
        if s > 0:
            scored.append((s, t, (rs, cs, tag_ov, style_m)))
            # ground-truth relevance over candidate pool
            if _is_relevant_rule(base_score=s, rs=rs, cs=cs, tag_overlap=tag_ov, style_matches=style_m):
                relevant_candidate_ids.append(tid)

    if not scored:
        return [] if not return_eval else ([], {"recommendedTripIds": [], "relevantTripIds": [], "allCandidateTripIds": all_candidate_ids})

    scored.sort(key=lambda x: x[0], reverse=True)
    abs_max_base = scored[0][0]

    # 4) MMR diversify + duplicate decay
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

    # 5) Confidence + normalized score + isRelevant
    selected_scored: List[Tuple[float, Dict[str, Any], Tuple[float, float, float, bool]]] = []
    for t in selected[:TOP_K]:
        s, rs, cs, tag_ov, style_m = base_score(t)
        selected_scored.append((s, t, (rs, cs, tag_ov, style_m)))

    sel_max = max(s for s, _, _ in selected_scored)
    sel_min = min(s for s, _, _ in selected_scored)
    sel_rng = max(1e-9, sel_max - sel_min)

    results: List[Dict[str, Any]] = []
    for s, trip, (rs, cs, tag_ov, style_m) in selected_scored:
        score_norm = (s - sel_min) / sel_rng
        raw_ratio  = (s / abs_max_base) if abs_max_base > 0 else 0.0
        raw_ratio  = max(0.0, min(1.0, raw_ratio))
        curved     = raw_ratio ** CONF_GAMMA
        confidence = CONF_FLOOR + (CONF_CEIL - CONF_FLOOR) * curved

        out = _serialize_doc(trip)
        out["score"] = round(float(score_norm), 3)
        out["confidence"] = round(float(confidence), 3)
        out["confidenceLabel"] = f"{int(round(confidence * 100))}% likely to enjoy"

        # NEW: per-item ground-truth label
        out["isRelevant"] = _is_relevant_rule(
            base_score=s, rs=rs, cs=cs, tag_overlap=tag_ov, style_matches=style_m
        )

        if os.environ.get("REC_DEBUG", "false").lower() == "true":
            out["_components"] = {
                "base_score": round(float(s), 4),
                "score_norm_minmax": round(float(score_norm), 4),
                "abs_ratio_to_best": round(float(raw_ratio), 4),
                "confidence": round(float(confidence), 4),
                "region_sim": round(float(rs), 4),
                "climate_sim": round(float(cs), 4),
                "tag_overlap": round(float(tag_ov), 4),
                "style_match": style_m,
            }
            out["_conf_params"] = {"floor": CONF_FLOOR, "ceil": CONF_CEIL, "gamma": CONF_GAMMA}

        results.append(out)

    if not return_eval:
        return results

    # === Eval sidecar ===
    eval_dict = {
        "recommendedTripIds": [str(t["_id"]) for t in results if "_id" in t],
        "relevantTripIds": list(dict.fromkeys(relevant_candidate_ids)),  # de-dupe keep order
        "allCandidateTripIds": list(dict.fromkeys(all_candidate_ids)),
    }
    return results, eval_dict