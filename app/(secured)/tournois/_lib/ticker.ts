import type { TournamentBuckets } from "@/lib/shared/types";
import { formatLocalDateTime } from "@/lib/shared/dates";
import { participantWording } from "@/lib/shared/participants";

export function buildTickerItems(buckets: TournamentBuckets): string[] {
  const items: string[] = [];

  buckets.running.forEach((t) => {
    items.push(
      `RÉSULTAT · ${t.name} · ${t.registeredTeams} ${participantWording(t.participantType).manyEngaged}`,
    );
  });

  buckets.registration.slice(0, 3).forEach((t) => {
    items.push(
      `INSCRIPTIONS · ${t.name} · ${t.registeredTeams}/${t.maxTeams} ${
        participantWording(t.participantType).many
      }`,
    );
  });

  buckets.upcoming.slice(0, 2).forEach((t) => {
    items.push(`À VENIR · ${t.name} · ${formatLocalDateTime(t.startAt)}`);
  });

  if (items.length === 0) {
    items.push("Aucune actualité tournoi pour le moment");
  }

  return items;
}
