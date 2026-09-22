"use client";

import { useState, useEffect } from "react";
import { BotStatus } from "@/lib/shared/types";
import { botStatusDisplay, botStatusOf, botStatusSummary } from "@/lib/shared/bot-status-summary";
import { botPayloadNumber, botPayloadText } from "@/lib/shared/bot-payload";

export function BotStatusStrip({ status }: { status: BotStatus | null }) {
  const [uptime, setUptime] = useState("—");

  useEffect(() => {
    const base = botPayloadNumber(status?.startupTs);
    const uptimeMs = botPayloadNumber(status?.uptimeMs);
    // Sans ces deux nombres, le compteur n'afficherait pas une erreur mais
    // « NaNj NaNh NaNm » — une panne muette de plus. Mieux vaut le tiret, et il
    // faut le **reposer** : sortir sans rien écrire laissait la case sur la
    // durée de la charge précédente, si bien qu'une charge devenue illisible
    // affichait « 1j 04h 23m » juste à côté de « Le bot n'a pas répondu à la
    // page » — la contradiction entre cases voisines que cette page retire.
    if (base === null || uptimeMs === null) {
      setUptime("—");
      return;
    }
    const startSec = Math.floor(uptimeMs / 1000);
    const tick = () => {
      // Borné à zéro : l'horloge du visiteur et celle du bot n'ont aucune
      // raison de concorder, et une dérive rendait « -1j 23h ».
      const s = Math.max(0, startSec + Math.floor((Date.now() - base - uptimeMs) / 1000));
      const d = Math.floor(s / 86400);
      const h = Math.floor((s % 86400) / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      setUptime(`${d}j ${h}h ${String(m).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s`);
    };
    // Tout de suite, puis chaque seconde : le seul `setInterval` laissait la
    // case au tiret une seconde pleine pendant que ses voisines affichaient
    // déjà leurs valeurs.
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [status]);

  const statusLabel = botStatusOf(status);
  const version = botPayloadText(status?.version);
  const buildHash = botPayloadText(status?.buildHash);
  const versionLabel = version ? (buildHash ? `${version} · ${buildHash.slice(0, 4)}` : version) : "—";
  const buildDate = botPayloadText(status?.buildDate) ?? "—";
  // Les champs **chiffrés** passent par `botPayloadNumber` et non par
  // `botPayloadText`, qui laisse filer n'importe quelle chaîne : la case
  // annonçait « vite ms » pendant que la carte « Santé du système », juste en
  // dessous, tirait un tiret du **même champ de la même charge**. Deux gardes
  // différentes sur une seule donnée, c'est une divergence qui finit par
  // s'afficher.
  const latency = botPayloadNumber(status?.gatewayLatency);
  const shardsActive = botPayloadNumber(status?.shardCount?.active);
  const shardsTotal = botPayloadNumber(status?.shardCount?.total);
  const shards =
    shardsActive !== null && shardsTotal !== null
      ? `${String(shardsActive).padStart(2, "0")} / ${String(shardsTotal).padStart(2, "0")}`
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
