/**
 * Publication des événements de tournoi.
 *
 * Point de passage unique de « quelque chose a changé sur ce tournoi ». Il tient
 * donc deux rôles : réveiller les abonnés du flux SSE, et **invalider les
 * caches de lecture** — l'instantané partagé du tournoi et la liste publique.
 * Les deux vont ensemble : c'est parce que toute écriture passe ici que les
 * caches peuvent se permettre des durées de vie confortables sans jamais
 * afficher un score périmé.
 */
import { publishTournamentEvent } from "@/lib/server/live";
import { sendBotLog } from "@/lib/server/bot-integration";
import { invalidateLandingAggregates } from "@/lib/server/landing-cache";
import { invalidateTournamentLists } from "./list-cache";
import { invalidateTournamentPreview } from "./preview-cache";
import { invalidateTournamentSnapshot } from "./snapshot";

/**
 * Le tournoi lui-même a changé : plateau, inscrites, état.
 *
 * Seul cet événement vide la liste publique — c'est le seul dont le contenu s'y
 * voie (colonnes de `bg_tournaments` et nombre d'inscrites) — et, pour la même
 * raison, les agrégats de la vitrine.
 */
export function publishUpdatedEvent(tournamentId: number): void {
  invalidateTournamentSnapshot(tournamentId);
  // Une inscription change le tirage prévisible : l'aperçu suit.
  invalidateTournamentPreview(tournamentId);
  invalidateTournamentLists();
  // L'accueil agrège les tournois par ses propres requêtes (compteur,
  // classement depuis `bg_matches`, ticker) : ses entrées ne descendent pas du
  // cache des listes. Sans cette ligne, un tournoi **supprimé** y resterait une
  // minute, ticker et lien vers une page introuvable compris.
  invalidateLandingAggregates();
  publishTournamentEvent({
    type: "updated",
    tournamentId,
    emittedAt: new Date().toISOString(),
  });
}

/**
 * Un score a bougé.
 *
 * On oublie l'instantané du tournoi, **pas les listes** : un score ne touche ni
 * les colonnes de `bg_tournaments` ni le nombre d'inscrites. Les vider ici
 * garderait froid le cache le plus rentable du site pendant toute une soirée de
 * tournois — les scores tombent en rafales, et l'accueil relancerait alors son
 * agrégat sur tous les tournois à presque chaque visite.
 *
 * Le cas où un score change bien l'état — celui qui clôt le tournoi — est
 * traité par l'appelant, qui compare l'état avant et après sa transaction
 * (`invalidateListsIfStateChanged`).
 */
export function publishScoreReportedEvent(tournamentId: number, matchId: number): void {
  invalidateTournamentSnapshot(tournamentId);
  publishTournamentEvent({
    type: "score_reported",
    tournamentId,
    matchId,
    emittedAt: new Date().toISOString(),
  });
}

/** Idem : l'arbitrage d'un score ne déplace pas un tournoi dans la liste. */
export function publishScoreResolvedEvent(tournamentId: number, matchId: number): void {
  invalidateTournamentSnapshot(tournamentId);
  publishTournamentEvent({
    type: "score_resolved",
    tournamentId,
    matchId,
    emittedAt: new Date().toISOString(),
  });
}

export async function sendBotLogAsync(message: string): Promise<void> {
  void sendBotLog(message);
}
