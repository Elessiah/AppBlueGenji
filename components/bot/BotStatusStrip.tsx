"use client";

import { useState, useEffect } from "react";
import { BotStatus } from "@/lib/shared/types";

/**
 * Sous-titre de la case « Status » : il **dit l'état affiché juste au-dessus**.
 *
 * Il annonçait des « modules nominaux » — quel que soit l'état, et alors que
 * plus rien sur `/bot` ne parle de modules depuis que la grille qui les
 * montrait a été retirée. Une phrase fixe sous une valeur qui varie finit par
 * la contredire : elle annonçait « nominaux » sous un `DOWN`.
 */
const STATUS_SUB: Record<BotStatus["status"] | "UNKNOWN", string> = {
  OPERATIONAL: "Tous les services répondent",
  DEGRADED: "Service dégradé — certaines réponses tardent",
  DOWN: "Le bot ne répond plus",
  UNKNOWN: "Le bot n'a pas répondu à la page",
};

export function BotStatusStrip({ status }: { status: BotStatus | null }) {
  const [uptime, setUptime] = useState("—");

  useEffect(() => {
    if (!status) return;
    const base = status.startupTs;
    const startSec = Math.floor(status.uptimeMs / 1000);
    const id = setInterval(() => {
      const s = startSec + Math.floor((Date.now() - base - status.uptimeMs) / 1000);
      const d = Math.floor(s / 86400);
      const h = Math.floor((s % 86400) / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      setUptime(`${d}j ${h}h ${String(m).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s`);
    }, 1000);
    return () => clearInterval(id);
  }, [status]);

  const statusLabel = status?.status ?? "UNKNOWN";
  const versionLabel = status ? `${status.version} · ${status.buildHash.slice(0, 4)}` : "—";
  const buildDate = status?.buildDate ?? "—";
  const latency = status?.gatewayLatency ?? "—";
  const shards = status ? `${String(status.shardCount.active).padStart(2, "0")} / ${String(status.shardCount.total).padStart(2, "0")}` : "—";

  return (
    <div className="status-strip">
      <div className={`status-cell ${statusLabel === "OPERATIONAL" ? "online" : ""}`}>
        <span className="lbl">Status</span>
        <span className="val">{statusLabel === "UNKNOWN" ? "—" : statusLabel}</span>
        <span className="sub">{STATUS_SUB[statusLabel]}</span>
      </div>
      <div className="status-cell">
        <span className="lbl">Uptime</span>
        <span className="val">{uptime}</span>
        <span className="sub">99.97 % · 90 derniers jours</span>
      </div>
      <div className="status-cell">
        <span className="lbl">Version</span>
        <span className="val">{versionLabel}</span>
        <span className="sub">Build · {buildDate}</span>
      </div>
      <div className="status-cell">
        <span className="lbl">Gateway latency</span>
        <span className="val">{latency === "—" ? "—" : `${latency} ms`}</span>
        <span className="sub">Discord WS · OVH Gravelines</span>
      </div>
      <div className="status-cell">
        <span className="lbl">Shards</span>
        <span className="val">{shards}</span>
        <span className="sub">Auto-sharding actif</span>
      </div>
    </div>
  );
}
