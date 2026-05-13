import { Sparkline } from "./Sparkline";
import { BotKpis as BotKpisType } from "@/lib/shared/types";

export function BotKpis({ kpis }: { kpis: BotKpisType | null }) {
  const entries = [
    {
      key: "servers",
      lbl: "Serveurs",
      data: kpis?.servers,
    },
    {
      key: "channels",
      lbl: "Channels relayés",
      data: kpis?.channels,
    },
    {
      key: "messages",
      lbl: "Messages traités",
      unit: "30j",
      data: kpis?.messages,
    },
    {
      key: "relays",
      lbl: "Relais inter-serveur",
      unit: "30j",
      data: kpis?.relays,
    },
  ];

  return (
    <div className="kpis">
      {entries.map((entry) => (
        <div key={entry.key} className="card card-ticks kpi">
          <div className="kpi-head">
            <span className="kpi-lbl">{entry.lbl}</span>
            <span className="kpi-delta up">
              ▲ {entry.data?.delta ?? "—"}
            </span>
          </div>
          <div className="kpi-val">
            {entry.data ? entry.data.value.toLocaleString("fr-FR") : "—"}
            {entry.unit && <span className="unit">/ {entry.unit}</span>}
          </div>
          <div className="kpi-spark">
            {entry.data?.series ? <Sparkline data={entry.data.series} /> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
