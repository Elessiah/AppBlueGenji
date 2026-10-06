import { DiscordIcon } from "./DiscordIcon";
import { CyberButton } from "@/components/cyber";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { FR_BOT_TEXT, type BotText } from "@/lib/shared/bot-text";
import { botInvitePermissions, botInviteScopesLabel, botInviteUrl } from "@/lib/server/bot-invite";
import { decodeDiscordPermissions } from "@/lib/shared/discord-permissions";

export function BotInviteCard({ text = FR_BOT_TEXT }: Readonly<{ text?: BotText }>) {
  const { t } = text;
  const inviteUrl = botInviteUrl();
  const permissions = botInvitePermissions();
  // La liste se **déduit** de l'entier envoyé à Discord : écrite à la main,
  // elle annonçait cinq permissions que l'invitation ne demandait pas.
  const perms = decodeDiscordPermissions(permissions, text);
  // Une seule ligne d'absence, dont seul le motif change.
  let emptyNotice: string | null = null;
  if (perms === null) emptyNotice = t("invite.unreadable");
  else if (perms.length === 0) emptyNotice = t("invite.none");

  return (
    <div className="card card-ticks invite-card" style={{ marginTop: 28 }}>
      <div className="fabric" style={{ opacity: 0.7 }} />
      <div className="invite-inner">
        <div className="invite-copy">
          <span className="eyebrow">{t("invite.eyebrow")}</span>
          <h3 style={{ marginTop: 16 }}>
            {t("invite.titleLead")}
            <br />
            <span className="a">{t("invite.titleAccent")}</span>
          </h3>
          <p>{t("invite.body")}</p>
          <div className="row-actions">
            <CyberButton asChild variant="primary">
              <a href={inviteUrl} target="_blank" rel="noreferrer">
                <DiscordIcon />
                {t("invite.invite")}
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
              <LocaleLink href="/bot/docs">{t("invite.docs")}</LocaleLink>
            </CyberButton>
          </div>
        </div>

        <div className="perms">
          <span className="title">{t("invite.permissions")}</span>
          {perms?.map((p) => (
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
          {emptyNotice && (
            <div className="perm">
              <span />
              <span className="lbl">{emptyNotice}</span>
              <span className="scope">—</span>
            </div>
          )}
          <div className="perms-foot">
            <span>{t("invite.scopes", { scopes: botInviteScopesLabel() })}</span>
            <span>{t("invite.integer", { value: permissions })}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
