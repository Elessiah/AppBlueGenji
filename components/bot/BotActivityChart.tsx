"use client";

import { useState } from "react";
import { ACTIVITY, SCRIMS } from "./mocks";

export function BotActivityChart() {
  const [range, setRange] = useState<"7j" | "30j" | "90j">("30j");
  const data = range === "30j" ? ACTIVITY : ACTIVITY.slice(-7);
  const data2 = range === "30j" ? SCRIMS : SCRIMS.slice(-7);
  const max = Math.max(...data, ...data2);

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
            {data.map((v, i) => (
              <div key={i} style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 1.5, height: "100%" }}>
                <div className="bar" style={{ height: `${(v / max) * 100}%`, flex: 1 }} title={`${v} relais`} />
                <div
                  className="bar relais"
                  style={{ height: `${(data2[i] / max) * 100}%`, flex: 0.4 }}
                  title={`${data2[i]} scrims`}
                />
              </div>
            ))}
          </div>
        </div>
        <div className="x-axis">
          {range === "30j"
            ? ["04 AVR", "10", "16", "22", "28", "03 MAI"].map((d) => <span key={d}>{d}</span>)
            : ["LUN", "MAR", "MER", "JEU", "VEN", "SAM", "DIM"].map((d) => <span key={d}>{d}</span>)}
        </div>
        <div className="chart-legend">
          <span className="lg">RELAIS INTER-SERVEUR</span>
          <span className="lg amber">SCRIMS PROPOSÉS</span>
          <span style={{ marginLeft: "auto" }}>MOY. {Math.round(data.reduce((a, b) => a + b, 0) / data.length)} / JOUR</span>
        </div>
      </div>
    </section>
  );
}
