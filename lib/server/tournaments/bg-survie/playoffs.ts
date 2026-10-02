/**
 * BlueGenji Survie — phase éliminatoire (`docs/features/BG_SURVIE_MODE.md`) :
 *
 * - `startEndurancePlayoffs` — construit l'arbre selon le tableau imposé ;
 * - `repairPlayoffBracket` — réaligne l'arbre sur une correction de score amont ;
 * - `finalizePlayoffsIfDone` — enchaîne les tours, puis clôt le tournoi.
 */

import type { PoolConnection } from "mysql2/promise";
import type { EnduranceConfig } from "@/lib/shared/bg-survie/config";
import { playoffRoundIsStale } from "@/lib/shared/bg-survie/pairing-staleness";
import { planNextPlayoffRound, planPlayoffFirstRound } from "@/lib/shared/bg-survie/playoffs";
import { selectQualifiedTeamIds } from "@/lib/shared/bg-survie/qualification";
import { PLAYOFF_ROUND_OFFSET } from "@/lib/shared/bg-survie/rounds";
import type { EnduranceStanding } from "@/lib/shared/bg-survie/standings";
import { finalizeEndurance } from "./finalization";
import { loadPlayoffRoundMatches, loadPlayoffRoundNumbers, writePlayoffRound } from "./playoff-rounds";
import { loadEnduranceStandings } from "./standings-store";
import { configOf, loadTournament } from "./tournament-row";

/**
 * Construit la phase éliminatoire.
 *
 * À huit qualifiées, le tableau imposé (8v4, 6v2, 1v5, 3v7) est appliqué tel
 * quel. En dessous — tournoi sous-rempli — on retombe sur un appariement
 * classique haut contre bas, faute de tableau défini pour cet effectif. Le
 * tirage lui-même vit dans le module pur (`planPlayoffFirstRound`), partagé avec
 * la réparation de l'arbre : une correction de score ne doit jamais poser un
 * autre tableau que celui qu'un lancement aurait produit.
 */
export async function startEndurancePlayoffs(
  tournamentId: number,
  conn: PoolConnection,
): Promise<void> {
  const tournament = await loadTournament(conn, tournamentId);
  if (tournament?.format !== "BG_SURVIE") return;
  if (Number(tournament.endurance_playoffs_started) === 1) return;

  const config = configOf(tournament);
  const standings = await loadEnduranceStandings(conn, tournamentId);
  const qualified = selectQualifiedTeamIds(standings, config);

  if (qualified.length <= 1) {
    await finalizeEndurance(conn, tournamentId, standings);
    return;
  }

  await writePlayoffRound(
    conn,
    tournamentId,
    PLAYOFF_ROUND_OFFSET,
    planPlayoffFirstRound(qualified, config),
    [],
  );

  await conn.execute(
    `UPDATE bg_tournaments SET endurance_playoffs_started = 1 WHERE id = ?`,
    [tournamentId],
  );
}

/**
 * Réaligne l'arbre final sur le résultat des tours amont.
 *
 * `finalizePlayoffsIfDone` ne sait que **poser** le tour suivant : une fois les
 * demi-finales créées, corriger un quart de finale n'en changeait plus les
 * participantes — le tour existait déjà, et plus rien ne le relisait. C'est
 * l'exact pendant de `roundPairingsAreStale` en qualification, appliqué aux
 * tours de play-off.
 *
 * Le premier tour se relit sur le **classement** (une correction en
 * qualification peut réécrire qui est qualifiée, et dans quel ordre), les
 * suivants sur les vainqueurs du tour précédent. Un tour périmé est réécrit, et
 * tout ce qui en descendait est supprimé : le tour réécrit n'est plus joué, il
 * ne qualifie donc plus personne. Ce qu'il faut reposer le sera par le chemin
 * ordinaire, une fois ce tour terminé.
 *
 * Un tour portant la moindre saisie n'est **jamais** réécrit. Le cas ne devrait
 * pas se présenter — `checkDownstreamMatchesHaveNoScores` refuse la correction
 * amont —, mais entre un arbre périmé, qui se corrige, et un score attribué à
 * une équipe qui ne l'a pas disputé, qui ne se voit plus, le choix est fait.
 */
export async function repairPlayoffBracket(
  conn: PoolConnection,
  tournamentId: number,
  standings: EnduranceStanding[],
  config: EnduranceConfig,
): Promise<boolean> {
  const rounds = await loadPlayoffRoundNumbers(conn, tournamentId);
  if (rounds.length === 0) return false;

  let plan = planPlayoffFirstRound(selectQualifiedTeamIds(standings, config), config);

  for (const round of rounds) {
    const matches = await loadPlayoffRoundMatches(conn, tournamentId, round);

    if (playoffRoundIsStale(plan, matches)) {
      if (matches.some((match) => match.hasScoreInput)) return false;

      await writePlayoffRound(conn, tournamentId, round, plan, matches);
      await conn.execute(`DELETE FROM bg_matches WHERE tournament_id = ? AND round_number > ?`, [
        tournamentId,
        round,
      ]);
      return true;
    }

    // Tour conforme : le suivant se déduit de ses résultats — encore faut-il
    // qu'il soit joué. Une finale (une seule rencontre décisive) ne mène nulle
    // part : `planNextPlayoffRound` rend un plan vide, et il n'y a plus rien à
    // relire en aval.
    const decisive = matches.filter((match) => match.bracket !== "THIRD_PLACE");
    if (decisive.some((match) => match.status !== "COMPLETED")) return false;

    plan = planNextPlayoffRound(decisive);
    if (plan.length === 0) return false;
  }
  return false;
}

/**
 * Enchaîne les tours de play-offs : dès qu'un tour est complet, crée le suivant
 * avec les vainqueurs (et la petite finale lorsqu'il ne reste que les demies).
 *
 * Le tirage du tour suivant est celui du module pur (`planNextPlayoffRound`),
 * le même que relit `repairPlayoffBracket` : poser un tour et le réparer ne
 * peuvent pas diverger.
 */
export async function finalizePlayoffsIfDone(conn: PoolConnection, tournamentId: number): Promise<void> {
  // Plusieurs tours d'affilée peuvent se poser en un seul entretien : un double
  // forfait laisse un créneau vacant, et le tour suivant naît alors **déjà
  // joué** — une exemption, que `writePlayoffRound` clôt sur place. Sans cette
  // boucle, l'arbre attendrait un score que personne n'a à saisir. Le nombre de
  // tours d'un arbre borne l'itération ; le plafond n'est qu'un garde-fou.
  for (let step = 0; step < MAX_PLAYOFF_STEPS; step += 1) {
    if (!(await advancePlayoffsOneStep(conn, tournamentId))) return;
  }
}

/**
 * Un pas de `finalizePlayoffsIfDone` : clôt le tournoi ou pose le tour
 * suivant. Rend `true` seulement quand le tour posé est né joué et qu'il faut
 * donc relire l'arbre aussitôt.
 */
async function advancePlayoffsOneStep(conn: PoolConnection, tournamentId: number): Promise<boolean> {
  const rounds = await loadPlayoffRoundNumbers(conn, tournamentId);
  if (rounds.length === 0) return false;

  const lastRound = rounds.at(-1)!;
  const matches = await loadPlayoffRoundMatches(conn, tournamentId, lastRound);

  const decisive = matches.filter((match) => match.bracket !== "THIRD_PLACE");
  if (decisive.length === 0 || decisive.some((match) => match.status !== "COMPLETED")) return false;

  // Une seule rencontre décisive terminée = finale jouée : reste à s'assurer
  // que la petite finale l'est aussi avant de clore.
  if (decisive.length === 1) {
    if (matches.some((match) => match.status !== "COMPLETED")) return false;
    const standings = await loadEnduranceStandings(conn, tournamentId);
    await finalizeEndurance(conn, tournamentId, standings, matches);
    return false;
  }

  const plan = planNextPlayoffRound(decisive);

  // Les doubles forfaits ont vidé **tous** les créneaux du tour suivant : il
  // n'y a plus personne pour jouer, et attendre ne ferait rien venir. Le
  // tournoi se clôt sans championne, sur le classement de qualification.
  if (!plan.some((entry) => entry.bracket === "UPPER")) {
    if (decisive.some((match) => match.doubleForfeit)) {
      const standings = await loadEnduranceStandings(conn, tournamentId);
      await finalizeEndurance(conn, tournamentId, standings);
    }
    return false;
  }

  await writePlayoffRound(conn, tournamentId, lastRound + 1, plan, []);

  // On ne reboucle que sur un tour **né joué** — rien que des exemptions : un
  // tour portant une vraie rencontre attend son score, et le relire tout de
  // suite ne ferait qu'y constater qu'il n'est pas terminé.
  return !plan.some((entry) => entry.pairing.teamBId !== null);
}

/** Plafond de tours posés en un seul entretien (un arbre en compte bien moins). */
const MAX_PLAYOFF_STEPS = 16;
