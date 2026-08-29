import { describe, expect, it, jest } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";
import { finalizeMatch } from "@/lib/server/tournaments/scoring";

/**
 * Antenne d'un match aval lors d'un ré-appariement.
 *
 * `finalizeMatch` pousse le vainqueur (et le perdant) dans le match suivant.
 * Quand ce créneau était déjà occupé par une **autre** équipe — le cas d'une
 * correction de score en amont — la ligne aval change d'affiche : l'antenne
 * ouverte sur l'ancienne rencontre doit être refermée, sans quoi le match
 * dérive encore `LIVE` et rallume le bouton « Regarder le live » de l'accueil
 * vers une chaîne qui ne montre pas cette rencontre.
 *
 * À l'inverse, remplir un créneau **encore vide** ne fait que matérialiser le
 * match prévu : une diffusion programmée à l'avance doit lui survivre.
 */

type Call = [string, unknown[]];

function connectionSpy(slots: { team1_id: number | null; team2_id: number | null }) {
  const calls: Call[] = [];
  const execute = jest.fn(async (sql: string, params: unknown[] = []) => {
    calls.push([sql, params]);
    if (sql.includes("SELECT team1_id, team2_id")) {
      return [[{ ...slots }]] as never;
    }
    return [{ affectedRows: 1 }] as never;
  });
  return { connection: { execute } as unknown as PoolConnection, calls, execute };
}

const downstream = {
  id: 10,
  team1_id: null,
  team2_id: null,
  next_winner_match_id: 20,
  next_winner_slot: 1,
  next_loser_match_id: null,
  next_loser_slot: null,
} as never;

function antennaResets(calls: Call[]): Call[] {
  return calls.filter(([sql]) => sql.includes("live_started_at = NULL"));
}

describe("finalizeMatch — antenne du match aval", () => {
  it("referme l'antenne quand le créneau change d'équipe", async () => {
    // Le créneau 1 du match aval porte déjà l'équipe 7 : la correction y pousse
    // l'équipe 9, l'affiche n'est plus la même.
    const { connection, calls } = connectionSpy({ team1_id: 7, team2_id: 8 });

    await finalizeMatch(connection, 1, downstream, {
      team1Score: 2,
      team2Score: 1,
      winnerTeamId: 9,
      loserTeamId: 8,
    });

    const resets = antennaResets(calls);
    expect(resets).toHaveLength(1);
    expect(resets[0][1]).toEqual([20]);
  });

  it("laisse la diffusion programmée intacte quand le créneau était vide", async () => {
    // Cas nominal : le match aval se remplit pour la première fois. Un caster a
    // pu marquer la demi-finale à l'avance — l'effacer ici la lui volerait.
    const { connection, calls } = connectionSpy({ team1_id: null, team2_id: null });

    await finalizeMatch(connection, 1, downstream, {
      team1Score: 2,
      team2Score: 1,
      winnerTeamId: 9,
      loserTeamId: 8,
    });

    expect(antennaResets(calls)).toHaveLength(0);
  });

  it("ne touche à rien quand la même équipe est repoussée", async () => {
    // Un rejeu qui réattribue le même vainqueur ne change pas l'affiche.
    const { connection, calls } = connectionSpy({ team1_id: 9, team2_id: 8 });

    await finalizeMatch(connection, 1, downstream, {
      team1Score: 2,
      team2Score: 1,
      winnerTeamId: 9,
      loserTeamId: 8,
    });

    expect(antennaResets(calls)).toHaveLength(0);
  });

  it("lit le bon créneau — un changement en slot 2 ne dépend pas du slot 1", async () => {
    const toSlotTwo = { ...(downstream as object), next_winner_slot: 2 } as never;
    // Slot 1 inchangé, slot 2 occupé par une autre équipe : c'est le slot 2 qui
    // compte, et l'antenne doit tomber.
    const { connection, calls } = connectionSpy({ team1_id: 7, team2_id: 8 });

    await finalizeMatch(connection, 1, toSlotTwo, {
      team1Score: 2,
      team2Score: 1,
      winnerTeamId: 9,
      loserTeamId: 8,
    });

    expect(antennaResets(calls)).toHaveLength(1);
  });

  it("ne touche à rien quand il n'y a pas de match aval", async () => {
    const orphan = {
      ...(downstream as object),
      next_winner_match_id: null,
      next_winner_slot: null,
    } as never;
    const { connection, calls } = connectionSpy({ team1_id: 7, team2_id: 8 });

    await finalizeMatch(connection, 1, orphan, {
      team1Score: 2,
      team2Score: 1,
      winnerTeamId: 9,
      loserTeamId: 8,
    });

    expect(antennaResets(calls)).toHaveLength(0);
  });
});
