// ResultCategory.jsx
import React from 'react';
import ResultCard from './ResultCard';

const ENGINE_LABELS = {
  contentBased: 'Top Picks For You:',
  mostLiked: 'Popular Right Now:',
  newDestinations: 'New Destinations',
  trendingByStyle: 'Trending Based On Travel Style',
  similarDestinationMap: '"Same Vibe, Different Trips"',
  collabFilt: 'Based On You Followings',
  
};

export default function ResultCategory({ engine, trips = [], onMarkRelevant, selectedMap = {} }) {

  const heading = ENGINE_LABELS[engine];

  if (!Array.isArray(trips) || trips.length === 0) {
    return (
      <section className="result-category-container">
        <h2>{engine}</h2>
        <p>No trips available</p>
      </section>
    );
  }

  console.log(' rec eng:', engine[heading]);

  return (
    <section className="result-category-container">
      <h2>{heading}</h2>
      <div className="result-grid">
        {trips.map((trip, idx) => {
          const selected = !!selectedMap[trip._id];
        return (
          <ResultCard key={trip._id || `${engine}-${idx}`} trip={trip} engine={engine}
          selected={selected}
          onMarkRelevant={onMarkRelevant}/>
        
        );
        })} 
      </div>
    </section>
  );
}