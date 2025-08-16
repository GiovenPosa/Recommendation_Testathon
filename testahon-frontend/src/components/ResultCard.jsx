import React, { useEffect, useState } from 'react';

import img1 from '../assets/travel-img.jpeg';
import img2 from '../assets/travel-img.jpg';
import img3 from '../assets/travel-img1.jpg';
import img4 from '../assets/travel-img2.avif';
import img5 from '../assets/travel-img3.avif';
import img6 from '../assets/travel-img4.avif';
import img7 from '../assets/travel-img5.avif';


const travelImages = [img1, img2, img3, img4, img5, img6, img7];

function formatCurrency(n) {
  if (typeof n !== 'number') return null;
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n);
}

function formatDates(start, end) {
  try {
    const s = new Date(start);
    const e = new Date(end);
    if (isNaN(+s) || isNaN(+e)) return null;
    const opts = { day: 'numeric', month: 'short', year: 'numeric' };
    return `${s.toLocaleDateString(undefined, opts)} – ${e.toLocaleDateString(undefined, opts)}`;
  } catch { return null; }
}

function pickImageIndex(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % travelImages.length;
}

function initialsFromName(firstName, lastName) {
  const f = (firstName || '').trim();
  const l = (lastName || '').trim();
  const fi = f ? f[0].toUpperCase() : '';
  const li = l ? l[0].toUpperCase() : '';
  const joined = `${fi}${li}`;
  return joined || null;
}

const formatConfidence = (score) => {
  if (typeof score !== 'number') return null;
  // If backend sends 0–1, multiply by 100
  const pct = score <= 1 ? score * 100 : score;
  return `${Math.round(pct)}% think you'll like this`;
};

// helpers near the top of the file
const getLikesCount = (trip) => {
  if (Array.isArray(trip.likes)) return trip.likes.length;
  return trip.likesCount ?? trip.likes ?? 0;
};

const getSavesCount = (trip) => {
  if (Array.isArray(trip.savedBy)) return trip.savedBy.length;
  return trip.savedCount ?? trip.saves ?? 0;
};

export default function ResultCard({ trip, engine, onMarkRelevant }) {
  const [ user, setUser ] = useState(null);
  const [selected, setSelected] = useState(false); // visual feedback + lock


  if (!trip) return null;

  const imgSrc = React.useMemo(() => {
    const key =
      (trip._id && String(trip._id)) ||
      (trip.id && String(trip.id)) ||
      trip.title ||
      trip.destination ||
      Math.random().toString(36);
    return travelImages[pickImageIndex(key)];
  }, [trip._id, trip.id, trip.title, trip.destination]);

  // Duration (inclusive of both start & end)
  let days = null;
  if (trip.startDate && trip.endDate) {
    const s = new Date(trip.startDate);
    const e = new Date(trip.endDate);
    const diff = e - s;
    if (!isNaN(diff)) days = Math.ceil(diff / (1000 * 60 * 60 * 24)) + 1;
  }

  const dateRange = formatDates(trip.startDate, trip.endDate);
  const budgetText = formatCurrency(trip.budget);
  const userId = trip.userId;

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch(`http://localhost:4000/api/test-user/trip/${userId}/owner`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const { user } = await response.json();
        setUser(user);
      } catch (error) {
        console.log('no user');
      }
    })();
    
  }, [userId]);

  const initials = initialsFromName(user?.firstName, user?.lastName);

  const tripId = String((trip && (trip._id ?? trip.id ?? trip.tripId ?? (trip._id && trip._id.$oid))) ?? '');
  const handleClick = () => {
    if (!tripId) return;
    const next = !selected;
    setSelected(next);
    onMarkRelevant?.({ tripId, engine, value: next ? 1 : 0 });
  };


  return (
    <article 
      className={`result-card ${selected ? 'result-card--selected' : ''}`}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleClick()}
      >
      <div className="result-card__media">
        {/* Use coverImage if you have it; fallback to a gradient */}
          <img
            src={imgSrc}
            alt={trip.destination || trip.title || 'Trip image'}
            loading="lazy"
          />

        {days != null && (
          <span className="badge badge--duration">{days} {days > 1 ? 'days' : 'day'}</span>
        )}
      </div>

      <div className="result-card__body">
        <h4 className="result-card__title">{trip.title || trip.destination || 'Untitled trip'}</h4>

        {/* Owner strip */}
        <div className="result-card__owner">
          <div className="result-card__avatar">
            {user?.profileImage ? (
              <img
                src={user.profileImage}
                alt="Profile"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : initials ? (
              <span>{initials}</span>
            ) : (
              <span role="img" aria-label="user">👤</span>
            )}
          </div>
          <span className="result-card__owner-name">
            {user ? `${user.firstName} ${user.lastName}` : 'Loading user…'}
          </span>
        </div>

        <div className="result-card__sub">
          <span className="pill">{trip.destination || 'Unknown'}</span>
          {budgetText && <span className="pill">{budgetText}</span>}
        </div>

        {dateRange && <div className="result-card__dates">{dateRange}</div>}

        {Array.isArray(trip.tags) && trip.tags.length > 0 && (
          <div className="result-card__tags">
            {trip.tags.slice(0, 4).map(t => (
              <span key={t} className="chip">{t}</span>
            ))}
            {trip.tags.length > 4 && (
              <span className="chip chip--more">+{trip.tags.length - 4}</span>
            )}
          </div>
        )}

        {trip.confidence != null && (
          <div className="result-card__confidence">
            {formatConfidence(trip.confidence)}
          </div>
        )}


        <div className="result-card__meta">
          <div className="result-card__stat" title="Likes">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="result-card__heart_icon">
              <path d="M12.1 8.64l-.1.1-.11-.1C9.14 6.09 5 7.24 5 10.28c0 2.06 1.67 3.73 4.2 6.02.83.77 1.77 1.64 2.8 2.65 1.03-1.01 1.97-1.88 2.8-2.65 2.53-2.29 4.2-3.96 4.2-6.02 0-3.04-4.14-4.19-6.9-1.64z"/>
            </svg>
            <span>{getLikesCount(trip)}</span>
          </div>

          <div className="result-card__stat" title="Saves">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="result-card__icon">
              <path d="M6 2h12a2 2 0 0 1 2 2v18l-8-4-8 4V4a2 2 0 0 1 2-2z"/>
            </svg>
            <span>{getSavesCount(trip)}</span>
          </div>
        </div>
      </div>
    </article>
  );
}