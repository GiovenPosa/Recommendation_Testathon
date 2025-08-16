import React, { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import ResultCategory from "../components/ResultCategory";

const getTripId = (t) => String(t?._id ?? t?.id ?? t?.tripId ?? t?._id?.$oid ?? '');

function RecommendationResults() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [choices, setChoices] = useState({});   // { engine: { tripId: 1 } }
  const [sending, setSending] = useState(false);
  const [sentMsg, setSentMsg] = useState("");
  const [evalData, setEvalData] = useState(null); // NEW

  useEffect(() => {
    if (!userId) return;
    const ac = new AbortController();

    (async () => {
      try {
        setLoading(true);
        setErr("");
        const res = await fetch(
          `http://localhost:4000/api/test-user/getPreferenceProfile/${userId}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId }),
            signal: ac.signal,
          }
        );

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setResults(data);
        setEvalData(data?._eval || null); // <-- capture sidecar for export
      } catch (e) {
        if (e.name !== "AbortError") setErr(e.message || "Request failed");
      } finally {
        setLoading(false);
      }
    })();

    return () => ac.abort();
  }, [userId]);

  // handle clicks from any ResultCard
  const onMarkRelevant = ({ tripId, engine, value }) => {
    const key = engine || "contentBased";
    // console.log('onMarkRelevant ->', { key, tripId, value });
    setChoices(prev => ({
      ...prev,
      [key]: { ...(prev[key] || {}), [tripId]: value ? 1 : 0 },
    }));
  };

  const payload = useMemo(() => {
    const models = {};

    // Create default evalData (all 0)
    const evalModels = {};

    if (results && typeof results === 'object') {
      for (const [engine, trips] of Object.entries(results)) {
        if (!Array.isArray(trips)) continue;

        for (const trip of trips) {
          const tid = getTripId(trip);
          if (!tid) continue;

          // Default relevant feedback to 0
          models[engine] = models[engine] || {};
          models[engine][tid] = 0;

          // Default eval model to 0
          evalModels[`eval_${engine}`] = evalModels[`eval_${engine}`] || {};
          evalModels[`eval_${engine}`][tid] = 0;
        }
      }
    }

    // Overlay actual user choices (1/0)
    for (const [engine, tripMap] of Object.entries(choices || {})) {
      models[engine] = models[engine] || {};
      for (const [tid, v] of Object.entries(tripMap)) {
        models[engine][tid] = v ? 1 : 0;
      }
    }

    return { userId, models: {...models}, _eval: evalData }
  }, [userId, results, choices]);

  const totalSelected = useMemo(() => {
    return Object.values(choices).reduce((sum, tripMap) => {
      return sum + Object.values(tripMap).filter(v => v === 1).length;
    }, 0);
  }, [choices]);

  const sendOutputResult = async () => {
    try {
      setSending(true);
      setSentMsg("");
      setErr("");
      const res = await fetch(`http://localhost:4000/api/test-user/trip/outputResult`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      console.log('eval sidecar:', data?._eval);
      setSentMsg(
        `Saved ${data.wrote} rows → ${data.file}` +
        (data.wroteEvalRows ? ` | eval rows: ${data.wroteEvalRows}` : "")
      );
    } catch (e) {
      setErr(e.message || "Failed to save feedback");
    } finally {
      setSending(false);
    }
  };

  const handleBack = () => navigate(-1);

  if (loading) return <p>Loading…</p>;
  if (err) return <p style={{ color: "crimson" }}>Error: {err}</p>;

  return (
    <div className="recommendation_container">
      <h1>Trips You Might Like</h1>
      {Object.entries(results || {}).map(([engine, trips]) => (
        Array.isArray(trips) && trips.length > 0 && (
          <ResultCategory
            key={engine}
            engine={engine}
            trips={trips}
            onMarkRelevant={onMarkRelevant}
            selectedMap={choices[engine] || {}}
          />
        )
      ))}

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 16 }}>
        <button
          onClick={handleBack}
          className="recommendation-btn recommendation-btn--secondary"
        >
          ↩️ Back to Builder
        </button>

        <button
          onClick={sendOutputResult}
          disabled={sending || totalSelected === 0}
          className="recommendation-btn"
          title={totalSelected ? `Sending ${totalSelected} selections` : "No selections yet"}
        >
          {sending ? "Sending…" : `Send feedback (${totalSelected})`}
        </button>

        {sentMsg && <span style={{ color: "green" }}>{sentMsg}</span>}
      </div>

      {/* Debug */}
      {/* <pre style={{marginTop: 16}}>{JSON.stringify(payload, null, 2)}</pre> */}
    </div>
  );
}

export default RecommendationResults;