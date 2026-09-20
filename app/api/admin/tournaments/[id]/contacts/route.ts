import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { loadTournamentContacts } from "@/lib/server/tournaments/contacts";
import { can } from "@/lib/shared/permissions";

/**
 * Contacts Discord des engagés d'un tournoi.
 *
 * Réservé au staff `tournaments` — administrateur **ou** arbitre : c'est le
 * métier même de tenir un plateau, et la règle de visibilité du tag
 * (`lib/shared/discord-identity.ts`) accorde justement à l'arbitrage les joueurs
 * engagés dans un tournoi vivant. Le cast (`casting`) n'y a pas droit : diffuser
 * n'est pas joindre.
 *
 * Volontairement **hors de l'instantané du tournoi** : celui-ci est diffusé tel
 * quel à tous les abonnés du flux. Voir `lib/server/tournaments/contacts.ts`.
 */
export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  const { id } = await context.params;
  const tournamentId = Number(id);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return fail("INVALID_TOURNAMENT_ID", 400);
  }

  return ok({ entrants: await loadTournamentContacts(tournamentId) });
}
