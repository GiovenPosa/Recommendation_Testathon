import React, { useState } from 'react';

function PoolCard({poolName, tags = [], isSelected = false, onToggle}) {
  const [ open, setOpen ] = useState(false);
  
  return (
    <div
      className={`pool_card_item ${open ? "is-open" : ""} ${isSelected ? "is-selected" : ""} `}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={onToggle}
      tabIndex={0}
      role="button"
      aria-pressed={isSelected}
      aria-expanded={open}
      aria-label={`${poolName} tags`}
    >
      <div className="pool_card_header">{poolName}</div>

      <div className="pool_card_tags">
        {tags.length ? (
          tags.map((t) => (
            <span className="pool_tag_chip" key={t}>{t}</span>
          ))
        ) : (
          <span className="pool_tag_empty">No tags</span>
        )}
      </div>
    </div>
  );
}

export default PoolCard;