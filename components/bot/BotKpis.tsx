import { Sparkline } from "./Sparkline";
import { ACTIVITY } from "./mocks";

export function BotKpis() {
  const kpis = [
    {
      lbl: "Serveurs",
      val: "15",
      delta: "+3",
      dir: "up" as const,
      data: [8, 9, 9, 10, 11, 11, 12, 13, 13, 14, 15, 15],
    },
    {
      lbl: "Channels relayés",
      val: "57",
      delta: "+12",
      dir: "up" as const,
      data: [30, 33, 35, 38, 40, 42, 45, 48, 50, 53, 55, 57],
    },
    {
      lbl: "Messages traités",
      val: "8 419",
      unit: "30j",
      delta: "+18 %",
      dir: "up" as const,
      data: [300, 420, 380, 500, 540, 610, 720, 690, 780, 850, 920, 1010],
    },
    {
      lbl: "Relais inter-serveur",
      val: "462",
      unit: "30j",
      delta: "+24 %",
      dir: "up" as const,
      data: ACTIVITY.slice(-12),
    },
  ];

  return (
    <div className="kpis">
      {kpis.map((kpi) => (
        <div key={kpi.lbl} className="card card-ticks kpi">
          <div className="kpi-head">
            <span className="kpi-lbl">{kpi.lbl}</span>
            <span className={`kpi-delta ${kpi.dir}`}>
              {kpi.dir === "up" ? "▲" : "▼"} {kpi.delta}
            </span>
          </div>
          <div className="kpi-val">
            {kpi.val}
            {kpi.unit && <span className="unit">/ {kpi.unit}</span>}
          </div>
          <div className="kpi-spark">
            <Sparkline data={kpi.data} />
          </div>
        </div>
      ))}
    </div>
  );
}
