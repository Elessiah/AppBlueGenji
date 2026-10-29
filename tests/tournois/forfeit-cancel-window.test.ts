import { describe, expect, it, jest } from "@jest/globals";
import { FR_ERRORS_TEXT, mapError, mapParticipantError } from "@/app/(secured)/tournois/[id]/_lib/error-map";
import { messagesFor } from "@/lib/server/i18n-messages";
import { loadCancellableForfeitIds } from "@/lib/server/tournaments/forfeit-window";
import { tournamentErrorsText } from "@/lib/shared/tournament-actions-text";
import { type SqlQuery, fakeConnection } from "../helpers/sql-double";

/**
 * L'interface ne propose « Annuler l'abandon » que dans la fenêtre que le
 * serveur accepte : aucune manche postérieure à l'abandon ne porte de saisie
 * (`FORFEIT_ROUND_PASSED` sinon). Hors fenêtre, la ligne affiche un verrou.
 */
function connection(lastRound: number | null) {
  const execute = jest.fn<SqlQuery>(async () => [[{ last_round: lastRound }], []]);
  return { execute, conn: fakeConnection({ execute }) };
}

describe("loadCancellableForfeitIds", () => {
  it("garde l'abandon tant que la dernière saisie est de sa manche", async () => {
    const { execute, conn } = connection(3);
    const ids = await loadCancellableForfeitIds(conn, 7, 0, [
      { teamId: 1, status: "ACTIVE", forfeitRound: null },
      { teamId: 2, status: "FORFEIT", forfeitRound: 3 },
      { teamId: 3, status: "FORFEIT", forfeitRound: 2 },
    ]);
    expect(ids).toEqual([2]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][1]).toEqual([7, 0]);
    expect(execute.mock.calls[0][0]).toContain("phase_id = ?");
  });

  it("garde un abandon sans manche notée tant que seule la manche 1 a une saisie", async () => {
    const one = connection(1);
    expect(await loadCancellableForfeitIds(one.conn, 7, 0, [{ teamId: 4, status: "FORFEIT", forfeitRound: null }])).toEqual([4]);
    const two = connection(2);
    expect(await loadCancellableForfeitIds(two.conn, 7, 0, [{ teamId: 4, status: "FORFEIT", forfeitRound: null }])).toEqual([]);
  });

  it("garde tous les abandons quand aucune manche n'a de saisie", async () => {
    const { conn } = connection(null);
    expect(await loadCancellableForfeitIds(conn, 7, 2, [{ teamId: 5, status: "FORFEIT", forfeitRound: 1 }])).toEqual([5]);
  });

  it("ne lit rien sans ligne forfait", async () => {
    const { execute, conn } = connection(9);
    expect(await loadCancellableForfeitIds(conn, 7, 0, [{ teamId: 1, status: "ELIMINATED", forfeitRound: 1 }])).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("loadCancellableForfeitIds — options", () => {
  const forfeits = [
    { teamId: 2, status: "FORFEIT", forfeitRound: 3 },
    { teamId: 3, status: "FORFEIT", forfeitRound: 2 },
  ];

  it("fenêtre fermée (open: false) : [] d'emblée, sans requête", async () => {
    const { execute, conn } = connection(3);
    expect(await loadCancellableForfeitIds(conn, 7, 0, forfeits, { open: false })).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("open: true se comporte comme l'absence d'option", async () => {
    const { execute, conn } = connection(3);
    expect(await loadCancellableForfeitIds(conn, 7, 0, forfeits, { open: true })).toEqual([2]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("borne déjà lue (lastInputRound) : aucune requête, même règle", async () => {
    const { execute, conn } = connection(99);
    expect(await loadCancellableForfeitIds(conn, 7, 0, forfeits, { lastInputRound: 3 })).toEqual([2]);
    expect(await loadCancellableForfeitIds(conn, 7, 0, forfeits, { lastInputRound: 0 })).toEqual([2, 3]);
    expect(await loadCancellableForfeitIds(conn, 7, 0, forfeits, { lastInputRound: 4 })).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("une borne de 0 n'est pas confondue avec « absente » : la requête est épargnée", async () => {
    const { execute, conn } = connection(5);
    expect(await loadCancellableForfeitIds(conn, 7, 0, forfeits, { lastInputRound: 0 })).toEqual([2, 3]);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("mapParticipantError — refus d'annulation d'un abandon", () => {
  const EN = tournamentErrorsText("en", messagesFor("en").tournamentErrors);

  it("parle d'un joueur dans un tournoi individuel, en français et en anglais", () => {
    expect(mapParticipantError("FORFEIT_ROUND_PASSED", "SOLO")).toContain("remettre le joueur en lice");
    expect(mapParticipantError("TEAM_NOT_FORFEITED", "SOLO")).toBe("Ce joueur n'a pas abandonné : il n'y a rien à annuler.");
    expect(mapParticipantError("TEAM_NOT_FORFEITED", "SOLO", EN)).toBe("This player hasn't withdrawn: there is nothing to cancel.");
  });

  it("tutoie, comme le reste de l'interface : « Reviens d'abord en arrière »", () => {
    for (const type of ["TEAM", "SOLO"] as const) {
      expect(mapParticipantError("FORFEIT_ROUND_PASSED", type)).toContain("Reviens d'abord en arrière.");
      expect(mapParticipantError("FORFEIT_ROUND_PASSED", type)).not.toContain("Revenez");
    }
  });

  it("garde la phrase d'équipe dans un tournoi par équipes", () => {
    expect(mapParticipantError("FORFEIT_ROUND_PASSED", "TEAM")).toBe(mapError("FORFEIT_ROUND_PASSED"));
    expect(mapParticipantError("FORFEIT_ROUND_PASSED", "TEAM", EN)).toBe(mapError("FORFEIT_ROUND_PASSED", EN));
  });

  it("retombe sur la table commune pour un code sans variante individuelle", () => {
    expect(mapParticipantError("TOURNAMENT_FULL", "SOLO")).toBe(mapError("TOURNAMENT_FULL", FR_ERRORS_TEXT));
    expect(mapParticipantError("SOMETHING_NEW", "SOLO", EN)).toBe(mapError("SOMETHING_NEW", EN));
  });

  it("les variantes individuelles existent dans les deux langues", () => {
    const fr = Object.keys(messagesFor("fr").tournamentErrors.soloCodes).sort();
    const en = Object.keys(messagesFor("en").tournamentErrors.soloCodes).sort();
    expect(en).toEqual(fr);
  });
});
