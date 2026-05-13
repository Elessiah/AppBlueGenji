export function BotCrumb() {
  return (
    <div className="bot-crumb">
      <span>BLUEGENJI</span>
      <span className="sep">/</span>
      <span>DASHBOARD</span>
      <span className="sep">/</span>
      <span className="here">BOT DISCORD</span>
      <span className="endpoint">
        <span className="dot" />
        <span className="mono" style={{ fontSize: 10, letterSpacing: "0.14em", color: "var(--fg)" }}>
          api.bluegenji.fr/bot/v2
        </span>
      </span>
    </div>
  );
}
