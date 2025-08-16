import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

export default function PreviewProfile() {
  const { userId: userIdFromRoute } = useParams();
  const { state } = useLocation();               // <-- where user is passed
  const navigate = useNavigate();

  // 1) try router state, 2) try sessionStorage (refresh), 3) null
  const initialUser = useMemo(() => {
    if (state?.user) return state.user;
    const cached = sessionStorage.getItem("previewUser");
    return cached ? JSON.parse(cached) : null;
  }, [state]);

  const [user, setUser] = useState(initialUser);
  const [error, setError] = useState("");
  console.log('user:', user);

  // persist if we got it via router state (so refresh keeps it)
  useEffect(() => {
    if (state?.user) {
      sessionStorage.setItem("previewUser", JSON.stringify(state.user));
    }
  }, [state?.user]);

  // optional fallback: if no user object, fetch by id (or show a message)
  useEffect(() => {
    if (user || !userIdFromRoute) return;
    setError("No profile data in memory. Please go back and rebuild the profile.");
  }, [user, userIdFromRoute]);

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Preview Profile</h1>
        <p style={{ color: "crimson" }}>{error}</p>
        <button onClick={() => navigate("/")}>Back</button>
      </div>
    );
  }

  if (!user) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Preview Profile</h1>
        <p>Loading… (or no data)</p>
        <button onClick={() => navigate("/")}>Back</button>
      </div>
    );
  }

  const trips = Array.isArray(user.trips) ? user.trips : [];
  const followings = Array.isArray(user.followings) ? user.followings : [];
  const likedTrips = Array.isArray(user.likedTrips) ? user.likedTrips : [];
  const savedTrips = Array.isArray(user.savedTrips) ? user.savedTrips : [];

  return (
    <div style={{ padding: 24 }}>
      <h1>Preview Profile</h1>

      <section style={{ margin: "12px 0" }}>
        <div><strong>User ID:</strong> {user._id}</div>
        <div><strong>Email:</strong> {user.email}</div>
        <div><strong>Travel Style:</strong> {user.travelStyle || "—"}</div>
      </section>

      <section style={{ margin: "12px 0" }}>
        <h3>Trips</h3>
        {trips.length ? (
          <ul>
            {trips.map(t => (
              <li key={t._id}>
                <strong>{t.title}</strong> — {t.destination}
                {typeof t.budget === "number" ? ` (£${t.budget})` : ""}
                {Array.isArray(t.tags) && t.tags.length ? (
                  <span> — {t.tags.join(", ")}</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : <p>No trips</p>}
      </section>

      <section style={{ margin: "12px 0" }}>
        <h3>Followings</h3>
        {followings.length ? (
          <ul>
            {followings.map(f => (
              <li key={f._id}>{f._id} — {f.travelStyle || "—"}</li>
            ))}
          </ul>
        ) : <p>Not following anyone</p>}
      </section>

      <section style={{ margin: "12px 0" }}>
        {likedTrips.length ? (
        <h3>Liked Trips: {likedTrips.length} </h3>
        ) : <p>Not liked any trips</p>}
      </section>

      <section style={{ margin: "12px 0" }}>
        {savedTrips.length ? (
        <h3>Saved Trips: {savedTrips.length} </h3>
        ) : <p>Not saved any trips</p>}
      </section>

      <div className="preview_page_buttons" style={{ marginTop: 16 }}>
        <button onClick={() => navigate("/")}>↩️ Back to Builder</button>
        <button onClick={() => navigate(`/recommendation-results/${user._id}`)}>➡️ Recommend</button>
      </div>
    </div>
  );
}