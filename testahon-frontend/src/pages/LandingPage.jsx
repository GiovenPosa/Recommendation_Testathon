import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import ThemePool from "../components/ThemePool";
import "./pages_styles.css";
import TripCard from "../components/TripCard";

function LandingPage() {
  const navigate = useNavigate();

  const [likePools, setLikePools] = useState([]);

  const handleTogglePool = (pool) => {
    const key = pool.toLowerCase();
    setLikePools((prev) => prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]);
  };

  const [trips, setTrips] = useState({
    trip1: { title: "", destination: "", budget: "", startDate: "", endDate: "", tags: [] },
    trip2: { title: "", destination: "", budget: "", startDate: "", endDate: "", tags: [] },
    trip3: { title: "", destination: "", budget: "", startDate: "", endDate: "", tags: [] },
  });

  // expose named vars if you want
  const trip1Data = trips.trip1;
  const trip2Data = trips.trip2;
  const trip3Data = trips.trip3;

  const handleTripFieldChange = (tripKey, field, value) => {
    setTrips(prev => ({
      ...prev,
      [tripKey]: { ...prev[tripKey], [field]: value },
    }));
  };

  const [formData, setFormData] = useState({
    travelStyle: "",
    cohesionScore: "",
  });

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const { cohesionScore, travelStyle } = formData;

    // basic validation
    if (!Array.isArray(likePools) || likePools.length === 0) {
      alert("Like pools must be an array and not empty. Try again");
      return;
    }
    if (!cohesionScore || !travelStyle) {
      alert("Cohesion Score and Travel Style must be filled. Try again");
      return;
    }
     const normalizeTrip = (t) => ({
        title: t.title?.trim(),
        destination: t.destination?.trim(),
        budget: Number(t.budget),
        // send ISO-ish strings that Mongoose can cast to Date
        startDate: t.startDate, // e.g. "2025-08-15"
        endDate: t.endDate,     // e.g. "2025-08-20"
        // ensure array of non-empty strings
        tags: Array.isArray(t.tags) ? t.tags.filter(Boolean).map(s => s.trim()) : [],
      });

      const tripsArray = [
        normalizeTrip(trips.trip1),
        normalizeTrip(trips.trip2),
        normalizeTrip(trips.trip3),
      ].filter(t =>
        t.title && t.destination && !Number.isNaN(t.budget)
      );

      if (tripsArray.length === 0) {
        alert('Please complete at least one trip (title, destination, start & end dates, budget).');
        return;
      }

    try {

      const body = {
        cohesionScore: Number(formData.cohesionScore),
        likePools,                         // e.g. ["budget", "romantic"]
        travelStyle: formData.travelStyle, // e.g. "budget"
        trips: tripsArray,                 // ✅ ARRAY, not object
      };

      const res = await fetch('http://localhost:4000/api/test-user/createTestUser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        console.error('POST failed', res.status, await res.text());
        throw new Error(`Request failed: ${res.status}`);
      }

      const data = await res.json();
      console.log('Backend response:', data);
      localStorage.setItem('testUserId', data);
      alert("Profile successfully created. Generating preference profile now.");
      navigate(`/preview-profile/${data.userId}`, {
        state: { user: data.user, seeded: data.seeded }, // pass whatever you need
      });
    } catch (error) {
      console.error(error);
      alert("Profile did not finish creating. Check field format and try again :)");
    }
  };

  console.log('like pool:', likePools);
  console.log('trip:', trips);


  return (
    <>
      <div>
        <h1>WELCOME TO IBM TRAVEL RECOMMENDATIONS</h1>
        <h3>Complete the fields below to simulate your profile.</h3>

        {/* Make ThemePool controlled if possible */}
        <ThemePool selectedPool={likePools} onTogglePool={handleTogglePool} />

        {/* Wrap EVERYTHING you want submitted inside this one form */}
        <form onSubmit={handleSubmit} className="form_container">
          <div className="categoy_form">
            <div className="form_field">
              <label className="input_label" htmlFor="travelStyle">Travel style</label>
              <input
                id="travelStyle"
                className="input_field"
                type="text"
                placeholder="e.g. budget, luxury, adventure…"
                value={formData.travelStyle}
                onChange={(e) => handleChange("travelStyle", e.target.value)}
              />
            </div>

            <div className="form_field">
              <label className="input_label" htmlFor="cohesionScore">Cohesion score (1–5)</label>
              <input
                id="cohesionScore"
                className="input_field"
                type="number"
                min="1"
                max="5"
                placeholder="Enter a number 1–5"
                value={formData.cohesionScore}
                onChange={(e) => handleChange("cohesionScore", e.target.value)}
              />
            </div>
          </div>

          <div className="trips_container">
            <TripCard
              tripKey="trip1"
              data={trip1Data}
              onChange={handleTripFieldChange}
            />
            <TripCard
              tripKey="trip2"
              data={trip2Data}
              onChange={handleTripFieldChange}
            />
            <TripCard
              tripKey="trip3"
              data={trip3Data}
              onChange={handleTripFieldChange}
            />
          </div>

          <button type="submit">Create Profile</button>
        </form>
      </div>
    </>
  );
}

export default LandingPage;