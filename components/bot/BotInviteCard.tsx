import Link from "next/link";
import { DiscordIcon } from "./DiscordIcon";
import { CyberButton } from "@/components/cyber";
import { botInvitePermissions, botInviteUrl } from "@/lib/server/bot-invite";
import { decodeDiscordPermissions } from "@/lib/shared/discord-permissions";

export function BotInviteCard() {
  const inviteUrl = botInviteUrl();
  const permissions = botInvitePermissions();
  // La liste se **déduit** de l'entier envoyé à Discord : écrite à la main,
  // elle annonçait cinq permissions que l'invitation ne demandait pas.
  const perms = decodeDiscordPermissions(permissions);

  return (
    <div className="card card-ticks invite-card" style={{ marginTop: 28 }}>
      <div className="fabric" style={{ opacity: 0.7 }} />
      <div className="invite-inner">
        <div className="invite-copy">
          <span className="eyebrow">INVITATION</span>
          <h3 style={{ marginTop: 16 }}>
            Connecte ton serveur à la scène
            <br />
            <span className="a">amateur francophone.</span>
          </h3>
          <p>
            Un seul OAuth, et tous les modules sont actifs d'office. À son arrivée, le bot écrit en
            privé au propriétaire du serveur la liste des modules et les commandes pour les régler.
          </p>
          <div className="row-actions">
            <CyberButton asChild variant="primary" style={{ padding: "14px 22px" }}>
              <a href={inviteUrl} target="_blank" rel="noreferrer">
                <DiscordIcon />
                Inviter le bot
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M3 8h10M9 4l4 4-4 4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </a>
            </CyberButton>
            <CyberButton asChild variant="ghost">
              <Link href="/bot/docs">Documentation</Link>
            </CyberButton>
          </div>
        </div>

        <div className="perms">
          <span className="title">PERMISSIONS DEMANDÉES</span>
          {perms === null ? (
            <div className="perm">
              <span />
              <span className="lbl">Valeur de permissions illisible</span>
              <span className="scope">—</span>
            </div>
          ) : (
            <>
              {perms.map((p) => (
                <div key={p.bit} className="perm">
                  <svg className="check" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M3 8.5l3 3 7-7.5"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="lbl">{p.label}</span>
                  <span className="scope">{p.flag}</span>
                </div>
              ))}
              {perms.length === 0 && (
                <div className="perm">
                  <span />
                  <span className="lbl">Aucune permission de serveur</span>
                  <span className="scope">—</span>
                </div>
              )}
            </>
          )}
          <div style={{ marginTop: 12, fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.16em", color: "var(--ink-dim)" }}>
            SCOPES · BOT + APPLICATIONS.COMMANDS · INTEGER · {permissions}
          </div>
        </div>
      </div>
    </div>
  );
}
