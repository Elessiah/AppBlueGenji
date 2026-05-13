export function BotLatencyCard() {
  return (
    <section className="panel lat-card">
      <div className="panel-head">
        <span className="title">Santé du système</span>
        <span className="meta">SAMPLED 5s</span>
      </div>
      <div className="panel-body">
        <div className="lat-cell">
          <span className="l">API LATENCY</span>
          <span className="v ok">
            47 <span style={{ fontSize: 12, color: "var(--fg-mute)" }}>ms</span>
          </span>
          <div className="lat-bar">
            <i style={{ width: "12%" }} />
          </div>
        </div>
        <div className="lat-cell">
          <span className="l">GATEWAY</span>
          <span className="v ok">
            62 <span style={{ fontSize: 12, color: "var(--fg-mute)" }}>ms</span>
          </span>
          <div className="lat-bar">
            <i style={{ width: "18%" }} />
          </div>
        </div>
        <div className="lat-cell">
          <span className="l">CPU</span>
          <span className="v">
            14<span style={{ fontSize: 12, color: "var(--fg-mute)" }}>%</span>
          </span>
          <div className="lat-bar">
            <i style={{ width: "14%" }} />
          </div>
        </div>
        <div className="lat-cell">
          <span className="l">RAM</span>
          <span className="v">
            312 <span style={{ fontSize: 12, color: "var(--fg-mute)" }}>MB</span>
          </span>
          <div className="lat-bar">
            <i style={{ width: "31%" }} />
          </div>
        </div>
      </div>
    </section>
  );
}
