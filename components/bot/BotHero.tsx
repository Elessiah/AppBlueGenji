import { DiscordIcon } from "./DiscordIcon";
import { CyberButton } from "@/components/cyber";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { FR_BOT_TEXT, type BotText } from "@/lib/shared/bot-text";
import { botInviteScopesLabel, botInviteUrl } from "@/lib/server/bot-invite";
import { botStatusOf, isBotOnline } from "@/lib/shared/bot-status-summary";
import type { BotStatus } from "@/lib/shared/types";

export function BotHero({ status, text = FR_BOT_TEXT }: Readonly<{ status: BotStatus | null; text?: BotText }>) {
  const { t } = text;
  const inviteUrl = botInviteUrl();
  // La pastille verte de l'avatar suit la case « État » : allumée sur un bot
  // opérationnel, absente sinon (injoignable, dégradé, état illisible).
  const online = isBotOnline(botStatusOf(status));
  return (
    <div className="bot-hero">
      <div className="bot-id">
        <div className={online ? "bot-avatar online" : "bot-avatar"}>
          <svg width="48" height="48" viewBox="0 0 40 40" fill="none" aria-hidden="true">
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
            {/* NOSONAR S6772 — étiquette en flex avec `gap` */}
            {t("hero.tag")}
          </span>
          <h1 className="bot-title">
            {t("hero.titleLead")} <span className="accent">{t("hero.titleAccent")}</span>
          </h1>
          {/* Ni identifiant ni « vérifié » : le site ne lit ni le pseudo
              Discord du bot ni son statut de vérification, et un « #8242 »
              inventé se lisait comme l'adresse à laquelle le trouver. */}
          <div className="bot-handle">
            <span className="badge">
              <DiscordIcon /> {t("hero.app")}
            </span>
          </div>
        </div>
      </div>

      <div className="bot-cta">
        <div className="row-actions">
          <CyberButton asChild variant="ghost">
            <LocaleLink href="/bot/docs">{t("hero.docs")}</LocaleLink>
          </CyberButton>
          <CyberButton asChild variant="primary">
            <a href={inviteUrl} target="_blank" rel="noreferrer">
              <DiscordIcon />
              {t("hero.invite")}
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
        </div>
        <span className="mono" style={{ fontSize: 11, letterSpacing: "0.18em", color: "var(--ink-dim)" }}>
          {t("hero.oauth", { scopes: botInviteScopesLabel() })}
        </span>
      </div>
    </div>
  );
}
