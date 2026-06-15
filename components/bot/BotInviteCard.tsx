import { Icon } from "./Icon";
import { botInviteUrl, DEFAULT_BOT_PERMISSIONS } from "@/lib/server/bot-invite";

export function BotInviteCard() {
  const inviteUrl = botInviteUrl();
  const permissions = process.env.DISCORD_BOT_PERMISSIONS?.trim() || DEFAULT_BOT_PERMISSIONS;
  const perms = [
    { lbl: "Envoyer des messages", scope: "SEND_MESSAGES" },
    { lbl: "Lire l'historique", scope: "READ_HISTORY" },
    { lbl: "Mentionner @everyone", scope: "MENTION_EVERYONE" },
    { lbl: "Embed links & attachments", scope: "EMBED · ATTACH" },
    { lbl: "Slash commands", scope: "APPLICATIONS.COMMANDS" },
  ];

  return (
    <div className="card card-ticks invite-card" style={{ marginTop: 28 }}>
      <div className="fabric" style={{ opacity: 0.7 }} />
      <div className="invite-inner">
        <div className="invite-copy">
          <span className="eyebrow">DÉPLOIEMENT · 90 SECONDES</span>
          <h3 style={{ marginTop: 16 }}>
            Connecte ton serveur à la scène
            <br />
            <span className="a">amateur francophone.</span>
          </h3>
          <p>
            Un seul OAuth, six modules, zéro configuration obligatoire. Le bot s'auto-déclare au démarrage et propose
            un wizard de setup directement dans ton serveur Discord.
          </p>
          <div className="row-actions">
            <a
              className="btn btn-primary"
              href={inviteUrl}
              target="_blank"
              rel="noreferrer"
              style={{ padding: "14px 22px" }}
            >
              <Icon name="discord" />
              Inviter le bot
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
            <a
              className="btn btn-ghost"
              href="https://docs.bluegenji-esport.fr/bot"
              target="_blank"
              rel="noreferrer"
            >
              Documentation
            </a>
          </div>
        </div>

        <div className="perms">
          <span className="title">PERMISSIONS DEMANDÉES</span>
          {perms.map((p) => (
            <div key={p.scope} className="perm">
              <svg className="check" width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path
                  d="M3 8.5l3 3 7-7.5"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="lbl">{p.lbl}</span>
              <span className="scope">{p.scope}</span>
            </div>
          ))}
          <div style={{ marginTop: 12, fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.16em", color: "var(--fg-dim)" }}>
            INTEGER · {permissions}
          </div>
        </div>
      </div>
    </div>
  );
}
