import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/server/auth";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { can } from "@/lib/shared/permissions";
import { planningRoundMessages } from "@/lib/shared/planning-round";
import { scopedText } from "@/lib/shared/scoped-text";
import { PlanningBoard } from "./_components/PlanningBoard";
import styles from "./planning.module.css";

/**
 * Page « Planning » (`docs/features/CAST_PLANNING.md`). Le contrôle de la
 * mise en page est refait ici : Next rend page et mise en page en parallèle.
 * Les textes de l'écran partent avec la page (l'espace `planning`, plus les
 * seuls mots des tours de `tournament.bracket`, `planningRoundMessages`) ; les
 * données se lisent par `GET /api/planning`.
 */
export default async function PlanningPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  if (!can(user, "planning")) notFound();
  const locale = await requestLocale();
  const messages = messagesFor(locale).planning;
  const { t } = scopedText(locale, messages);
  return (
    <section className={`container ${styles.page}`}>
      <header>
        <span className="eyebrow">{t("eyebrow")}</span>
        <h1 className={`display text-gradient ${styles.title}`}>{t("title")}</h1>
        <p className={styles.lead}>{t("lead")}</p>
      </header>
      <PlanningBoard locale={locale} messages={messages} roundMessages={planningRoundMessages(messagesFor(locale))} />
    </section>
  );
}
