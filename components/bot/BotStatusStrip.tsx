"use client";

import { useState, useEffect } from "react";

export function BotStatusStrip() {
  const [uptime, setUptime] = useState("21j 14h 32m 18s");

  useEffect(() => {
    const base = Date.now();
    const id = setInterval(() => {
      const s = 18 + Math.floor((Date.now() - base) / 1000);
      const sec = s % 60;
      const min = (32 + Math.floor(s / 60)) % 60;
      setUptime(`21j 14h ${String(min).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s`);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="status-strip">
      <div className="status-cell online">
        <span className="lbl">Status</span>
        <span className="val">OPERATIONAL</span>
        <span className="sub">Tous les modules nominaux</span>
      </div>
      <div className="status-cell">
        <span className="lbl">Uptime</span>
        <span className="val">{uptime}</span>
        <span className="sub">99.97 % · 90 derniers jours</span>
      </div>
      <div className="status-cell">
        <span className="lbl">Version</span>
        <span className="val">v2.4.1 · stable</span>
        <span className="sub">Build 4f8a · 03 Mai 2026</span>
      </div>
      <div className="status-cell">
        <span className="lbl">Gateway latency</span>
        <span className="val">47 ms</span>
        <span className="sub">Discord WS · OVH Gravelines</span>
      </div>
      <div className="status-cell">
        <span className="lbl">Shards</span>
        <span className="val">02 / 02</span>
        <span className="sub">Auto-sharding actif</span>
      </div>
    </div>
  );
}
