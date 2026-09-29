export function BotCrumb() {
  return (
    <div className="bot-crumb">
      <span>BLUEGENJI</span>
      <span className="sep">/</span>
      <span>DASHBOARD</span>
      <span className="sep">/</span>
      <span className="here">BOT DISCORD</span>
      <span className="endpoint">
        <span className="mono" style={{ fontSize: 11, letterSpacing: "0.14em", color: "var(--ink)" }}>
          bluegenji-esport.fr/bot
        </span>
      </span>
    </div>
  );
}
