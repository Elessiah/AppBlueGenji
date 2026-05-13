import { BotServerEntry } from "@/lib/shared/types";

export function BotServersTable({ servers }: { servers: BotServerEntry[] | null }) {
  const list = servers ?? [];

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="title">Serveurs connectés</span>
        <span className="meta">{list.length} ACTIFS · TRIÉS PAR ACTIVITÉ 30J</span>
      </div>
      <div className="srv-table">
        <div className="srv-head">
          <span>#</span>
          <span>SERVEUR</span>
          <span style={{ textAlign: "right" }}>MEMBRES</span>
          <span style={{ textAlign: "right" }}>RELAIS 30J</span>
          <span style={{ textAlign: "right" }}>STATUS</span>
          <span style={{ textAlign: "right" }}>TENDANCE</span>
        </div>
        {list.map((s, rank) => (
          <div key={s.id} className="srv-row">
            <span className="srv-rank">{String(rank + 1).padStart(2, "0")}</span>
            <span className="srv-name">
              <span className="srv-sigil" style={{ "--c": s.accentColor } as React.CSSProperties}>
                {s.sigil}
              </span>
              {s.name}
            </span>
            <span className="srv-num">{s.memberCount.toLocaleString("fr-FR")}</span>
            <span className="srv-num">{s.relays30j}</span>
            <span className={"srv-status " + s.status}>
              {s.status === "ok" ? "● OK" : s.status === "lag" ? "● LAG" : "○ OFF"}
            </span>
            <span className="srv-spark">
              {s.sparkline.map((v, i) => (
                <span key={i} style={{ height: `${(v / Math.max(...s.sparkline, 1)) * 100}%` }} />
              ))}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
