"use client";

import { useState, useEffect } from "react";
import { FEED } from "./mocks";

export function BotLiveFeed() {
  const [items, setItems] = useState(FEED);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      setItems((prev) =>
        prev.map((it) => {
          const [hh, mm, ss] = it.ts.split(":").map(Number);
          const total = hh * 3600 + mm * 60 + ss + 1;
          const h = Math.floor(total / 3600) % 24;
          const m = Math.floor(total / 60) % 60;
          const s = total % 60;
          return {
            ...it,
            ts: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`,
          };
        })
      );
    }, 1000);
    return () => clearInterval(id);
  }, [paused]);

  return (
    <section className="panel" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <div className="panel-head">
        <span className="title">Flux temps réel</span>
        <div className="row gap-2">
          <button
            className={"chip " + (paused ? "" : "chip-on")}
            onClick={() => setPaused((p) => !p)}
            aria-label={paused ? "Reprendre le flux" : "Mettre en pause le flux"}
          >
            {paused ? "▶ REPRENDRE" : "■ PAUSE"}
          </button>
        </div>
      </div>
      <div className="feed" style={{ flex: 1, maxHeight: 420, overflow: "hidden" }}>
        {items.slice(0, 13).map((f, i) => (
          <div key={i} className="feed-row">
            <span className="ts">{f.ts}</span>
            <span className={"tag " + f.tag}>{f.tag.toUpperCase()}</span>
            <span className="msg">{f.msg}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
