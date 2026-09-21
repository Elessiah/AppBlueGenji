import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { loadTournamentContacts, loadContactTournamentState } from "@/lib/server/tournaments/contacts";
import { tournamentGrantsContactAccess } from "@/lib/shared/discord-identity";
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
 *
 * **L'accès s'éteint avec le tournoi.** La règle de visibilité du tag n'ouvre
 * l'arbitrage que sur un tournoi *vivant* (`tournamentGrantsContactAccess`), et
 * sans cette garde le panneau l'aurait contournée : six mois après la finale, un
 * arbitre y aurait encore lu les coordonnées de tous ceux qui ont joué. La fiche
 * d'un joueur, elle, applique déjà la borne — deux chemins vers la même donnée
 * doivent s'arrêter au même endroit.
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

  const state = await loadContactTournamentState(tournamentId);
  if (state === null) return fail("TOURNAMENT_NOT_FOUND", 404);
  if (!tournamentGrantsContactAccess(state)) return fail("TOURNAMENT_FINISHED", 409);

  return ok({ entrants: await loadTournamentContacts(tournamentId) });
}
