import asyncio
from flask import Flask, request, jsonify
import os
from contentbasedModel import contentBasedRec
from newDestinationCBM import contentBasedNewPlaces
from destinationSimilarityMapLLM import destination_similarity_map_recs
from mostPopularByTravelStyle import most_popular_trending_recs
from mostPopular import most_liked_recs
from collaborativeFil import following_collaborative_recs 
from data.top_cities import TopCities

DEBUG_LOG = os.environ.get('REC_DEBUG', 'false').lower() == 'true'

app = Flask(__name__)

@app.get('/')
def home():
  return jsonify(message="Hello from Flask on localhost:8888")

@app.get('/health')
def health():
  return jsonify(status='ok')

@app.post('/recommend')
def recommend():
  top_cities = TopCities();
  try:
    user_profile = request.get_json(force=True, silent=True)
    # print('User profile received:', user_profile)

    if not user_profile or not user_profile.get('userId'):
      return jsonify({'error': 'Missing userId'}), 400

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        content_based, new_destinations, ( trending_style, trending_eval ), mostLiked, ( destinationSimilarity, destSimEval), ( collabFilt, collabFilEval ) = loop.run_until_complete(
            asyncio.gather(
                contentBasedRec(user_profile),          # async
                contentBasedNewPlaces(user_profile),    # async
                most_popular_trending_recs(user_profile, return_eval=True),
                most_liked_recs(user_profile),
                destination_similarity_map_recs(user_profile, top_cities, return_eval=True), # <-- async (MUST be awaited)
                following_collaborative_recs(user_profile, return_eval=True)
            )
        )
    finally:
        loop.close()

    # Make sure each is an array (fallback to [])
    content_based    = content_based or []
    new_destinations = new_destinations or []
    trending_style   = trending_style or []
    trending_eval = trending_eval or []
    mostliked = mostLiked or []
    destinationSimilarity = destinationSimilarity or []
    destSimEval = destSimEval or []
    collabFilt = collabFilt or []
    collabFilEval = collabFilEval or []
        
    return jsonify({
        "contentBased": content_based,
        "newDestinations": new_destinations,
        "similarDestinationMap": destinationSimilarity,   # <-- key your UI will loop over
        "mostLiked": mostliked,
        "trendingByStyle": trending_style,
        "collabFil": collabFilt,
        "_eval": {
          "trendingByStyle": trending_eval,
          "similarDestinationMap": destSimEval,
          "collabFil": collabFilEval,
        }
    }), 200
  except Exception as e:
    # You’ll get JSON even on errors
    return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
  app.run(host='0.0.0.0', port=8888, debug=True)