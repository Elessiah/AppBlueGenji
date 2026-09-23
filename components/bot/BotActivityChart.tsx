"use client";

import { useState, useEffect } from "react";
import { BotActivity } from "@/lib/shared/types";
import { botPayloadLabel, botPayloadNumber } from "@/lib/shared/bot-payload";

export function BotActivityChart({ initial }: { initial: BotActivity | null }) {
  const [range, setRange] = useState<"7j" | "30j" | "90j">("30j");
  const [data, setData] = useState<BotActivity | null>(initial);

  useEffect(() => {
    if (range === "30j") {
      setData(initial);
      return;
    }

    const fetchData = async () => {
      try {
        const res = await fetch(`/api/bot/activity?range=${range}`);
        if (!res.ok) throw new Error("Failed to fetch");
        const result = await res.json();
        setData(result);
      } catch {
        setData(null);
      }
    };

    fetchData();
  }, [range, initial]);

  if (!data) {
    return (
      <section className="panel">
        <div className="panel-head">
          <span className="title">Activité · relais & scrims</span>
          <div className="chart-tools row gap-2">
            {["7j", "30j", "90j"].map((r) => (
              <button
                key={r}
                className={"chip " + (range === r ? "chip-on" : "")}
                onClick={() => setRange(r as "7j" | "30j" | "90j")}
                aria-label={`Filtrer par ${r}`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--ink-mute)" }}>
          <p>Données indisponibles</p>
        </div>
      </section>
    );
  }

  const relays = Array.isArray(data.relays) ? data.relays : [];
  const scrims = Array.isArray(data.scrims) ? data.scrims : [];
  // Un point ramené à un nombre affichable, **borné des deux côtés** — la même
  // règle que la colonne « tendance » de `BotServersTable`, et pour les mêmes
  // deux raisons : un point non numérique rendait `height: NaN%` et un point
  // négatif `height: -400%`, deux déclarations que le navigateur laisse
  // tomber en silence. La barre disparaît alors sans qu'aucune erreur ne le
  // signale — la panne muette, pas l'exception.
  const point = (v: unknown) => Math.max(0, botPayloadNumber(v) ?? 0);
  // `reduce` et non `Math.max(...relays, ...scrims, 1)` : ce dernier passe les
  // deux séries en arguments d'appel, ce qui est un `RangeError` au-delà de
  // ~100 000 points, et rendrait `NaN` sur un point non numérique — la charge
  // arrive par un `as BotActivityPayload` sur du JSON reçu. La graine à 1 reste
  // le garde-fou contre la division par zéro d'une série plate.
  const max = [...relays, ...scrims].reduce<number>((m, v) => Math.max(m, point(v)), 1);
  // `?? []` ne rattrape que `null` : des libellés rangés par index
  // (`{"0": "01/09"}`) passaient tout droit et `labels.map` levait
  // « labels.map is not a function ». `BotActivityChart` étant rendu côté
  // serveur dans `app/bot/page.tsx`, cette exception-là ne fait pas une case
  // vide : elle sert **toute** la page en 500 — bien pire que l'axe sans
  // libellés qu'on rend ici.
  const labels = Array.isArray(data.labels) ? data.labels : [];
  // Même charge non validée : un objet tombait dans `Math.round`, qui rend
  // `NaN`, et la légende annonçait « MOY. NaN / JOUR ».
  const avgPerDay = botPayloadNumber(data.avgPerDay) ?? 0;

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="title">Activité · relais & scrims</span>
        <div className="chart-tools row gap-2">
          {["7j", "30j", "90j"].map((r) => (
            <button
              key={r}
              className={"chip " + (range === r ? "chip-on" : "")}
              onClick={() => setRange(r as "7j" | "30j" | "90j")}
              aria-label={`Filtrer par ${r}`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <div className="chart-wrap">
        <div className="chart">
          <div className="y-axis">
            <span>0</span>
            <span>{Math.round(max * 0.25)}</span>
            <span>{Math.round(max * 0.5)}</span>
            <span>{Math.round(max * 0.75)}</span>
            <span>{max}</span>
          </div>
          <div className="bars">
            {relays.map((v, i) => {
              // Les hauteurs passaient les valeurs **brutes** alors que `max`
              // venait d'être durci : une série `scrims` plus courte que
              // `relays` (ou absente) donnait `scrims[i] === undefined`, donc
              // `height: NaN%` et un `title="undefined scrims"`. Les barres
              // ambre disparaissaient sans une erreur.
              const relay = point(v);
              const scrim = point(scrims[i]);
              return (
                <div key={i} style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 1.5, height: "100%" }}>
                  <div className="bar" style={{ height: `${(relay / max) * 100}%`, flex: 1 }} title={`${relay} relais`} />
                  <div
                    className="bar relais"
                    style={{ height: `${(scrim / max) * 100}%`, flex: 0.4 }}
                    title={`${scrim} scrims`}
                  />
                </div>
              );
            })}
          </div>
        </div>
        <div className="x-axis">
          {/* `key={d}` sur le libellé lui-même : deux dates identiques dans la
              série donnaient deux clés identiques, donc un avertissement React
              et une réconciliation qui ne tient plus au changement de plage.
              Et un libellé arrivé en objet tombait en enfant de React, qui
              lève — toute la page en 500. */}
          {labels.map((d, i) => (
            <span key={i}>{botPayloadLabel(d)}</span>
          ))}
        </div>
        <div className="chart-legend">
          <span className="lg">RELAIS INTER-SERVEUR</span>
          <span className="lg amber">SCRIMS PROPOSÉS</span>
          <span style={{ marginLeft: "auto" }}>MOY. {Math.round(avgPerDay)} / JOUR</span>
        </div>
      </div>
    </section>
  );
}
