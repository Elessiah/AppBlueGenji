import { SERVERS } from "./mocks";

export function BotServersTable() {
  return (
    <section className="panel">
      <div className="panel-head">
        <span className="title">Serveurs connectés</span>
        <span className="meta">15 ACTIFS · TRIÉS PAR ACTIVITÉ 30J</span>
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
        {SERVERS.map((s) => (
          <div key={s.rank} className="srv-row">
            <span className="srv-rank">{String(s.rank).padStart(2, "0")}</span>
            <span className="srv-name">
              <span className="srv-sigil" style={{ "--c": s.c } as React.CSSProperties}>
                {s.name[0]}
              </span>
              {s.name}
            </span>
            <span className="srv-num">{s.members.toLocaleString("fr-FR")}</span>
            <span className="srv-num">{s.relays}</span>
            <span className={"srv-status " + s.status}>
              {s.status === "ok" ? "● OK" : s.status === "lag" ? "● LAG" : "○ OFF"}
            </span>
            <span className="srv-spark">
              {s.trend.map((v, i) => (
                <span key={i} style={{ height: `${(v / Math.max(...s.trend)) * 100}%` }} />
              ))}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
