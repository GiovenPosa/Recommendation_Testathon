import React, { useEffect, useState } from "react";

export default function TripCard({ tripKey, data, onChange }) {
  // Local input buffer for the tags text field
  const [tagInput, setTagInput] = useState("");

  // Keep local buffer in sync if parent wipes tags or resets the card
  useEffect(() => {
    if (!Array.isArray(data?.tags) || data.tags.length === 0) {
      setTagInput("");
    }
  }, [data?.tags]);

  const updateField = (field) => (e) => onChange(tripKey, field, e.target.value);

  // Helpers
  const sanitize = (s) => s.trim();
  const splitCSV = (str) =>
    str
      .split(",")
      .map(sanitize)
      .filter(Boolean);

  const commitTags = (parts) => {
    if (!parts?.length) return;
    const current = Array.isArray(data.tags) ? data.tags : [];
    // Merge + dedupe (case-insensitive)
    const merged = [...current, ...parts];
    const deduped = Array.from(
      new Map(merged.map((t) => [t.toLowerCase(), t])).values()
    );
    onChange(tripKey, "tags", deduped);
  };

  // Input handlers for the tags field
  const handleTagChange = (e) => {
    setTagInput(e.target.value); // do NOT split on every keystroke
  };

  const handleTagKeyDown = (e) => {
    // Enter or comma commits current buffer
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const parts = splitCSV(tagInput);
      commitTags(parts);
      setTagInput("");
      return;
    }

    // Backspace: if buffer is empty, remove the last tag
    if (e.key === "Backspace" && tagInput === "") {
      const current = Array.isArray(data.tags) ? [...data.tags] : [];
      if (current.length > 0) {
        current.pop();
        onChange(tripKey, "tags", current);
      }
    }
  };

  // Paste: allow pasting "party, foodie, beach"
  const handleTagPaste = (e) => {
    const text = (e.clipboardData || window.clipboardData).getData("text");
    if (text.includes(",")) {
      e.preventDefault();
      const parts = splitCSV(tagInput + text);
      commitTags(parts);
      setTagInput("");
    }
  };

  // On blur: commit whatever is in the buffer
  const handleTagBlur = () => {
    if (tagInput.trim()) {
      commitTags(splitCSV(tagInput));
      setTagInput("");
    }
  };

  const removeTag = (idx) => {
    const current = Array.isArray(data.tags) ? [...data.tags] : [];
    current.splice(idx, 1);
    onChange(tripKey, "tags", current);
  };

  return (
    <div className="trip_card_container">
      <h3>{tripKey.toUpperCase()}</h3>

      <div className="trip_card_inputs">
        <input
          placeholder="Title"
          value={data.title}
          onChange={updateField("title")}
        />
        <input
          placeholder="Destination"
          value={data.destination}
          onChange={updateField("destination")}
        />
        <input
          type="number"
          placeholder="Budget"
          value={data.budget}
          onChange={updateField("budget")}
        />
        <input
          type="date"
          value={data.startDate}
          onChange={updateField("startDate")}
        />
        <input
          type="date"
          value={data.endDate}
          onChange={updateField("endDate")}
        />

        {/* Tags chips + input */}
        <div className="trip_tags_container">
          {(Array.isArray(data.tags) ? data.tags : []).map((tag, i) => (
            <span className="trip_tag_chip" key={`${tag}-${i}`}>
              {tag}
              <button
                type="button"
                className="trip_tag_remove"
                onClick={() => removeTag(i)}
                aria-label={`Remove ${tag}`}
              >
                ×
              </button>
            </span>
          ))}

          <input
            className="trip_tag_input"
            placeholder="Add tag (Enter or ,)"
            value={tagInput}
            onChange={handleTagChange}
            onKeyDown={handleTagKeyDown}
            onBlur={handleTagBlur}
            onPaste={handleTagPaste}
          />
        </div>
      </div>
    </div>
  );
}