"use client";

import { useState, useEffect } from "react";
import { BotStatus } from "@/lib/shared/types";
import { botStatusDisplay, botStatusOf, botStatusSummary } from "@/lib/shared/bot-status-summary";

/**
 * Un champ de la charge du bot, ramené à du texte affichable — ou `null`.
 *
 * `fetchBotStatus` rend cette charge par un simple `as BotStatus` sur du JSON
 * reçu par le réseau : **aucun** de ces champs n'est garanti, malgré le type.
 * Un `.slice()` sur un `buildHash` absent, ou un `.active` sur un `shardCount`
 * absent, lève pendant le rendu — et comme la bande est rendue par un composant
 * serveur, c'est toute la page `/bot` qui part en 500. Une case fade vaut
 * infiniment mieux, et c'est déjà la règle du tableau d'à côté.
 */
function field(value: unknown): string | null {
  if (typeof value === "string") return value.length > 0 ? value : null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function BotStatusStrip({ status }: { status: BotStatus | null }) {
  const [uptime, setUptime] = useState("—");

  useEffect(() => {
    if (!status) return;
    // Sans ces deux nombres, le compteur n'afficherait pas une erreur mais
    // « NaNj NaNh NaNm » — une panne muette de plus. Mieux vaut le tiret.
    if (!Number.isFinite(status.startupTs) || !Number.isFinite(status.uptimeMs)) return;
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

  const statusLabel = botStatusOf(status);
  const version = field(status?.version);
  const buildHash = field(status?.buildHash);
  const versionLabel = version ? (buildHash ? `${version} · ${buildHash.slice(0, 4)}` : version) : "—";
  const buildDate = field(status?.buildDate) ?? "—";
  const latency = field(status?.gatewayLatency);
  const shardsActive = field(status?.shardCount?.active);
  const shardsTotal = field(status?.shardCount?.total);
  const shards =
    shardsActive && shardsTotal
      ? `${shardsActive.padStart(2, "0")} / ${shardsTotal.padStart(2, "0")}`
      : "—";

  return (
    <div className="status-strip">
      <div className={`status-cell ${statusLabel === "OPERATIONAL" ? "online" : ""}`}>
        <span className="lbl">Status</span>
        <span className="val">{botStatusDisplay(statusLabel)}</span>
        <span className="sub">{botStatusSummary(statusLabel)}</span>
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
        <span className="val">{latency === null ? "—" : `${latency} ms`}</span>
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
