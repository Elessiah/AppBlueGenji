"use client";

import { useState, useEffect } from "react";
import { BotStatus } from "@/lib/shared/types";
import {
  botStatusDisplay,
  botStatusOf,
  botStatusSummary,
  botUptimeLabel,
} from "@/lib/shared/bot-status-summary";
import { botPayloadNumber, botPayloadText } from "@/lib/shared/bot-payload";
import { useClientPower } from "@/lib/shared/hooks/useClientPower";

export function BotStatusStrip({ status }: { status: BotStatus | null }) {
  const [uptime, setUptime] = useState("—");
  // Onglet caché : l'horloge s'arrête, et la relecture au retour la recale.
  const { clocks } = useClientPower();

  // Le calcul lui-même vit dans `botUptimeLabel`, pur et testé : enfermé ici,
  // il était hors de portée des tests de rendu (`renderToStaticMarkup`
  // n'exécute aucun effet), et la remise au tiret comme la borne à zéro
  // pouvaient être retirées sans qu'une assertion bronche.
  useEffect(() => {
    // Le tiret est **reposé** à chaque charge : sortir sans rien écrire
    // laissait la case sur la durée de la charge précédente, si bien qu'une
    // charge devenue illisible affichait « 1j 04h 23m » juste à côté de « Le
    // bot n'a pas répondu à la page » — la contradiction entre cases voisines
    // que cette page retire.
    const first = botUptimeLabel(status, Date.now());
    // Tout de suite, puis chaque seconde : le seul `setInterval` laissait la
    // case au tiret une seconde pleine pendant que ses voisines affichaient
    // déjà leurs valeurs.
    setUptime(first ?? "—");
    // Rien à compter : pas d'horloge à faire tourner pour réécrire un tiret.
    if (first === null || !clocks) return;
    const id = setInterval(() => setUptime(botUptimeLabel(status, Date.now()) ?? "—"), 1000);
    return () => clearInterval(id);
  }, [status, clocks]);

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
