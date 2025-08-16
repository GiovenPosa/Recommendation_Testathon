import React from 'react';
import './components_styles.css';
import PoolCard from './PoolCard';

const themePool = [
    { pool: "solo", tags: ["Adventure","Budget","Camping","Digital Nomad","Hiking","Photography","Road Trip","Solo","Volunteering"] },
    { pool: "luxury", tags: ["Cruise","Island Hopping","Luxury","Romantic","Spa","Wellness","Relaxing","Middle East"] },
    { pool: "foodie", tags: ["City Break","Cooking Class","Foodie","Shopping","Street Art"] },
    { pool: "digital nomad", tags: ["Asia","Creative Retreat","Digital Nomad","Europe","Photography","Workation"] },
    { pool: "adventure", tags: ["Adventure","Camping","Desert","Extreme Sports","Hiking","Mountains","National Parks","Wildlife Safari","Water Sports","Ski & Snowboard"] },
    { pool: "nature", tags: ["Beach","Camping","Eco Travel","Forest","Mountains","National Parks","Wildlife Safari","Africa","Oceania","Pet-Friendly"] },
    { pool: "romantic", tags: ["Architecture","Beach","Island Hopping","Luxury","Romantic","Spa","Yoga Retreat"] },
    { pool: "budget", tags: ["Asia","Backpacking","Budget","Europe","Solo","Study Abroad","Weekend Getaway"] },
    { pool: "family", tags: ["Camping","Christmas","City Break","Family","National Parks","Wildlife Safari"] },
    { pool: "culture", tags: ["Architecture","Cultural","Film Locations","Historic Sites","Language Learning","Literary Travel","Street Art","Americas","Middle East"] },
    { pool: "party", tags: ["Festival","Group","New Year","Nightlife","Party","Summer"] },
    { pool: "seasonal", tags: ["Autumn","Christmas","Festival","New Year","Spring","Summer","Winter","Ski & Snowboard","Yoga Retreat"] },
  ];

function ThemePool({ selectedPool = [], onTogglePool }) {
  return (
    <>
      <div className='themePool_container'>
         <h2> Theme Pool </h2>
         <div className='pool_cards_container'>
          <div className='top_row'>
            {themePool.slice(0,6).map(p => (
          <PoolCard 
            key={p.pool} 
            poolName={p.pool}  
            tags={p.tags} 
            isSelected={selectedPool.includes(p.pool.toLowerCase())}
            onToggle={() => onTogglePool(p.pool)}
            />
          ))}
          </div>
          <div className='bottom_row'>
            {themePool.slice(6,12).map(p => (
          <PoolCard 
            key={p.pool} 
            poolName={p.pool} 
            tags={p.tags} 
            isSelected={selectedPool.includes(p.pool.toLowerCase())}
            onToggle={() => onTogglePool(p.pool)}
            />
          ))}
          </div>
          
         </div>

      </div>
     
    </>
  )
}

export default ThemePool;