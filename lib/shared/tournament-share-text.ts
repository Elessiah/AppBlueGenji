/**
 * Métadonnées d'une fiche de tournoi dans la langue de l'adresse (lot 8a-2).
 *
 * Le français reste celui de `share-metadata.ts` (`tournamentShareDescription`,
 * lu aussi par la carte d'aperçu) ; l'anglais est rédigé ici depuis l'espace
 * `tournament.share`, par les mêmes règles (état, format, effectif, prochaine
 * date à l'heure de Paris, description libre tronquée). Module à part : les
 * écrans client qui lisent `share-metadata.ts` n'ont pas à embarquer ce texte.
 */
import type { Locale } from "./locales";
import { localizedTournamentLabel } from "./tournament-labels";
import { scopedText } from "./scoped-text";
import {
  DESCRIPTION_MAX_LENGTH,
  FREE_TEXT_MAX_LENGTH,
  SHARE_TIME_ZONE,
  tournamentShareDescription,
  truncateForShare,
} from "./share-metadata";
import type { Messages } from "./i18n-messages";
import type { TournamentCard } from "./types";

function shareDate(iso: string, text: ReturnType<typeof scopedText<Messages["tournament"]["share"]>>): string | null {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  const date = new Date(time);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: SHARE_TIME_ZONE, day: "numeric", month: "long", year: "numeric" }).format(date);
  const hour = new Intl.DateTimeFormat("en-US", { timeZone: SHARE_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  return text.t("date", { day, hour });
}

function scheduleKey(card: TournamentCard, now: number): { key: keyof Messages["tournament"]["share"]["schedule"]; iso: string } {
  if (card.state === "FINISHED") return { key: "FINISHED", iso: card.startAt };
  if (card.state === "RUNNING") return { key: "RUNNING", iso: card.startAt };
  if (card.state === "REGISTRATION") return { key: "REGISTRATION", iso: card.registrationCloseAt };
  const opensAt = Date.parse(card.registrationOpenAt);
  if (Number.isFinite(opensAt) && now < opensAt) return { key: "OPENS", iso: card.registrationOpenAt };
  return { key: "KICKOFF", iso: card.startAt };
}

/** Description d'une fiche (balise `description`, encarts) dans la langue de la page. */
export function localizedTournamentShareDescription(
  card: TournamentCard,
  locale: Locale,
  messages: Pick<Messages, "tournament" | "labels">,
  now: number = Date.now(),
): string {
  if (locale === "fr") return tournamentShareDescription(card, now);
  const text = scopedText(locale, messages.tournament.share);
  const counts = { registered: String(card.registeredTeams), max: String(card.maxTeams) };
  const parts = [
    text.t(`states.${card.state}`),
    localizedTournamentLabel(messages.labels, "format", card.format),
    text.t(card.participantType === "SOLO" ? "engagedSolo" : "engagedTeam", counts),
  ];
  const next = scheduleKey(card, now);
  const date = shareDate(next.iso, text);
  if (date) parts.push(text.t(`schedule.${next.key}`, { date }));

  const facts = `${parts.join(" · ")}.`;
  const free = card.description ? truncateForShare(card.description, FREE_TEXT_MAX_LENGTH) : "";
  return truncateForShare(free ? `${free} — ${facts}` : facts, DESCRIPTION_MAX_LENGTH);
}
