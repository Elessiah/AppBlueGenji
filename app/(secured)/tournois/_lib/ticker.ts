import type { TournamentBuckets } from "@/lib/shared/types";
import { formatLocalDateTime } from "@/lib/shared/dates";
import { toParticipantType } from "@/lib/shared/participants";
import { FR_TOURNAMENTS_TEXT, type TournamentsText } from "@/lib/shared/tournaments-text";
import { cardDateTime } from "./card-display";

/**
 * Bandeau défilant de `/tournois`, dans la langue de la page (lot 8a). Les
 * nombres passent en **chaînes** au français (« 12 équipes engagées », rendu
 * inchangé) ; l'anglais accorde (« 1 team competing »).
 */
export function buildTickerItems(buckets: TournamentBuckets, text: TournamentsText = FR_TOURNAMENTS_TEXT): string[] {
  const { t } = text;
  const items: string[] = [];
  const solo = (type: Parameters<typeof toParticipantType>[0]) => toParticipantType(type) === "SOLO";

  buckets.running.slice(0, 3).forEach((tournament) => {
    items.push(
      t(solo(tournament.participantType) ? "ticker.runningSolo" : "ticker.runningTeam", {
        name: tournament.name,
        count: tournament.registeredTeams,
      }),
    );
  });

  buckets.registration.slice(0, 3).forEach((tournament) => {
    items.push(
      t(solo(tournament.participantType) ? "ticker.registrationSolo" : "ticker.registrationTeam", {
        name: tournament.name,
        registered: String(tournament.registeredTeams),
        max: String(tournament.maxTeams),
      }),
    );
  });

  buckets.upcoming.slice(0, 2).forEach((tournament) => {
    // Le français garde son rendu d'origine (`toLocaleString` du lecteur) ;
    // l'anglais s'écrit sur 24 h, sans secondes.
    const date = text.locale === "fr" ? formatLocalDateTime(tournament.startAt) : cardDateTime(tournament.startAt, text.locale);
    items.push(t("ticker.upcoming", { name: tournament.name, date }));
  });

  if (items.length === 0) {
    items.push(t("ticker.empty"));
  }

  return items;
}
