import { Icon } from "./Icon";

export function BotHero() {
  return (
    <div className="bot-hero">
      <div className="bot-id">
        <div className="bot-avatar">
          <svg width="48" height="48" viewBox="0 0 40 40" fill="none">
            <path
              d="M20 3 L36 12 V28 L20 37 L4 28 V12 Z"
              stroke="#5ac8ff"
              strokeWidth="1.3"
              fill="rgba(90,200,255,0.08)"
            />
            <path
              d="M14 15 L20 12 L26 15 L26 25 L20 28 L14 25 Z"
              stroke="#5ac8ff"
              strokeWidth="1.3"
              fill="none"
            />
            <circle cx="20" cy="20" r="2.5" fill="#5ac8ff" />
          </svg>
        </div>

        <div className="bot-name">
          <span className="bot-tag">
            <span className="sq" />
            BOT DISCORD · INTER-SERVEURS
          </span>
          <h1 className="bot-title">
            BlueGenji <span className="accent">Relay</span>
          </h1>
          <div className="bot-handle">
            <span className="h">@bluegenji_relay#7340</span>
            <span className="badge">
              <Icon name="discord" /> APP
            </span>
            <span className="mono" style={{ fontSize: 10, letterSpacing: "0.18em", color: "var(--fg-dim)" }}>
              VERIFIÉ
            </span>
          </div>
        </div>
      </div>

      <div className="bot-cta">
        <div className="row-actions">
          <a className="btn btn-ghost" href="https://docs.bluegenji-esport.fr/bot" target="_blank" rel="noreferrer">
            Documentation
          </a>
          <a
            className="btn btn-primary"
            href="https://discord.com/api/oauth2/authorize?client_id=1234567890&permissions=1099511627776&scope=bot%20applications.commands"
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="discord" />
            Inviter sur mon serveur
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M3 8h10M9 4l4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </a>
        </div>
        <span className="mono" style={{ fontSize: 10, letterSpacing: "0.18em", color: "var(--fg-dim)" }}>
          OAUTH2 · BOT + APPLICATIONS.COMMANDS · GRATUIT
        </span>
      </div>
    </div>
  );
}
