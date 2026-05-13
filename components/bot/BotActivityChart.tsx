"use client";

import { useState, useEffect } from "react";
import { BotActivity } from "@/lib/shared/types";

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

  const relays = data.relays ?? [];
  const scrims = data.scrims ?? [];
  const max = Math.max(...relays, ...scrims, 1);
  const labels = data.labels ?? [];
  const avgPerDay = data.avgPerDay ?? 0;

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
            {relays.map((v, i) => (
              <div key={i} style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 1.5, height: "100%" }}>
                <div className="bar" style={{ height: `${(v / max) * 100}%`, flex: 1 }} title={`${v} relais`} />
                <div
                  className="bar relais"
                  style={{ height: `${(scrims[i] / max) * 100}%`, flex: 0.4 }}
                  title={`${scrims[i]} scrims`}
                />
              </div>
            ))}
          </div>
        </div>
        <div className="x-axis">
          {labels.length > 0 ? labels.map((d) => <span key={d}>{d}</span>) : null}
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
