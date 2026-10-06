import { FR_BOT_TEXT, type BotText } from "@/lib/shared/bot-text";

export function BotCrumb({ text = FR_BOT_TEXT }: Readonly<{ text?: BotText }>) {
  const { t } = text;
  return (
    <div className="bot-crumb">
      <span>{t("crumb.brand")}</span>
      <span className="sep">/</span>
      <span>{t("crumb.dashboard")}</span>
      <span className="sep">/</span>
      <span className="here">{t("crumb.here")}</span>
      <span className="endpoint">
        <span className="mono" style={{ fontSize: 11, letterSpacing: "0.14em", color: "var(--ink)" }}>
          {t("crumb.endpoint")}
        </span>
      </span>
    </div>
  );
}
