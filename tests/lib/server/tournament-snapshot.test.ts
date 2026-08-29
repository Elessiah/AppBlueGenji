import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

/**
 * L'instantané partagé est la pièce maîtresse de la refonte : c'est lui qui fait
 * qu'un score rapporté devant cent spectateurs coûte **un** calcul et non cent.
 *
 * Cette propriété-là ne peut pas être vérifiée depuis `tournament-broadcast`,
 * qui remplace ce module par un bouchon : son « ne calcule qu'une fois pour
 * toute la salle » prouve seulement que la salle n'appelle qu'une fois. On
 * exerce donc ici le vrai module, base bouchonnée — comme le fait déjà
 * `state-running-maintenance.test.ts`.
 */
jest.mock("@/lib/server/tournaments/repository");
jest.mock("@/lib/server/tournaments/state");
jest.mock("@/lib/server/tournaments/list-cache");
jest.mock("@/lib/server/solo-entries-service");
jest.mock("@/lib/server/database");

import {
  getTournamentSnapshot,
  getTournamentSnapshotFrame,
  invalidateTournamentSnapshot,
} from "@/lib/server/tournaments/snapshot";
import {
  getMatchRows,
  getRegistrationRows,
  getTournamentListRow,
  loadTournamentRow,
} from "@/lib/server/tournaments/repository";
import { hasPendingStateTransition, syncTournamentState } from "@/lib/server/tournaments/state";
import { invalidateTournamentLists } from "@/lib/server/tournaments/list-cache";
import { getDatabase } from "@/lib/server/database";
import { clearCache } from "@/lib/server/cache";

const TOURNAMENT_ID = 5;

/** Ligne de tournoi en cours, plateau déjà construit : aucun entretien requis. */
function runningRow(overrides: Record<string, unknown> = {}) {
  const past = new Date(Date.now() - 86_400_000).toISOString();
  return {
    id: TOURNAMENT_ID,
    state: "RUNNING",
    format: "SINGLE",
    participant_type: "TEAM",
    finished_at: null,
    registration_open_at: past,
    registration_close_at: past,
    start_at: past,
    bracket_size: 8,
    ...overrides,
  };
}

/** Ligne de liste, telle que `mapCard` l'attend. */
function listRow(overrides: Record<string, unknown> = {}) {
  const past = new Date(Date.now() - 86_400_000).toISOString();
  return {
    id: TOURNAMENT_ID,
    name: "Tournoi",
    description: null,
    format: "SINGLE",
    game: "OW2",
    max_teams: 8,
    state: "RUNNING",
    start_visibility_at: past,
    registration_open_at: past,
    registration_close_at: past,
    start_at: past,
    bracket_size: 8,
    created_at: past,
    organizer_user_id: 1,
    finished_at: null,
    has_third_place_match: 0,
    survival_rounds_before_first_cut: null,
    survival_rounds_per_cut: null,
    survival_current_round: null,
    participant_type: "TEAM",
    match_format_type: null,
    match_format_value: null,
    registered_teams: 2,
    ...overrides,
  };
}

/**
 * Connexion bouchonnée : le module en emprunte une pour lire, et une seconde
 * (transactionnelle) quand l'entretien s'impose.
 */
const connection = {
  release: jest.fn(),
  beginTransaction: jest.fn(async () => undefined),
  commit: jest.fn(async () => undefined),
  rollback: jest.fn(async () => undefined),
};
let expiredRows: unknown[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
  expiredRows = [];

  (getDatabase as jest.Mock).mockResolvedValue({
    getConnection: jest.fn(async () => connection),
    execute: jest.fn(async () => [expiredRows]),
  } as never);

  (loadTournamentRow as jest.Mock).mockResolvedValue(runningRow() as never);
  (hasPendingStateTransition as jest.Mock).mockResolvedValue(false as never);
  (syncTournamentState as jest.Mock).mockResolvedValue({
    row: runningRow(),
    stateChanged: false,
  } as never);
  (getTournamentListRow as jest.Mock).mockResolvedValue(listRow() as never);
  (getRegistrationRows as jest.Mock).mockResolvedValue([] as never);
  (getMatchRows as jest.Mock).mockResolvedValue([] as never);
});

afterEach(() => {
  clearCache();
  jest.restoreAllMocks();
});

describe("getTournamentSnapshotFrame — mutualisation", () => {
  it("ne construit qu'un instantané pour cent lecteurs simultanés", async () => {
    // La propriété qui justifie toute la refonte : avant, chacun reconstruisait
    // le détail pour lui-même — cent fois le même travail, en même temps, sur un
    // pool de 25 connexions.
    const readers = Array.from({ length: 100 }, () => getTournamentSnapshotFrame(TOURNAMENT_ID));
    const frames = await Promise.all(readers);

    expect(getTournamentListRow).toHaveBeenCalledTimes(1);
    // Tous repartent avec exactement la même trame, encodée une seule fois.
    for (const frame of frames) expect(frame).toBe(frames[0]);
  });

  it("resert l'instantané en cache aux lectures suivantes", async () => {
    await getTournamentSnapshotFrame(TOURNAMENT_ID);
    await getTournamentSnapshotFrame(TOURNAMENT_ID);

    expect(getTournamentListRow).toHaveBeenCalledTimes(1);
  });

  it("le reconstruit dès qu'une écriture l'invalide", async () => {
    // C'est ce qui permet une durée de vie confortable sans jamais afficher un
    // score périmé.
    await getTournamentSnapshotFrame(TOURNAMENT_ID);
    invalidateTournamentSnapshot(TOURNAMENT_ID);
    await getTournamentSnapshotFrame(TOURNAMENT_ID);

    expect(getTournamentListRow).toHaveBeenCalledTimes(2);
  });

  it("porte une empreinte qui suit le contenu", async () => {
    const first = await getTournamentSnapshotFrame(TOURNAMENT_ID);

    invalidateTournamentSnapshot(TOURNAMENT_ID);
    (getTournamentListRow as jest.Mock).mockResolvedValue(
      listRow({ registered_teams: 3 }) as never,
    );
    const second = await getTournamentSnapshotFrame(TOURNAMENT_ID);

    expect(second!.version).not.toBe(first!.version);
  });

  it("rend null pour un tournoi inexistant", async () => {
    (loadTournamentRow as jest.Mock).mockResolvedValue(null as never);
    expect(await getTournamentSnapshot(TOURNAMENT_ID)).toBeNull();
  });
});

describe("getTournamentSnapshotFrame — entretien à la lecture", () => {
  it("n'ouvre aucune transaction quand il n'y a rien à faire", async () => {
    await getTournamentSnapshotFrame(TOURNAMENT_ID);
    expect(syncTournamentState).not.toHaveBeenCalled();
  });

  it("déclenche une bascule d'état en retard, quel que soit l'état courant", async () => {
    // Auparavant l'entretien était réservé aux tournois déjà `RUNNING` : la page
    // d'un tournoi dont l'heure de début était passée restait aux inscriptions
    // jusqu'à ce que quelqu'un aille charger la liste.
    (loadTournamentRow as jest.Mock).mockResolvedValue(
      runningRow({ state: "REGISTRATION" }) as never,
    );
    (hasPendingStateTransition as jest.Mock).mockResolvedValue(true as never);

    await getTournamentSnapshotFrame(TOURNAMENT_ID);

    expect(syncTournamentState).toHaveBeenCalled();
  });

  it("construit le plateau manquant d'un tournoi en cours", async () => {
    (loadTournamentRow as jest.Mock).mockResolvedValue(
      runningRow({ bracket_size: null }) as never,
    );

    await getTournamentSnapshotFrame(TOURNAMENT_ID);

    expect(syncTournamentState).toHaveBeenCalled();
  });

  it("arbitre un report de score expiré", async () => {
    expiredRows = [{ 1: 1 }];

    await getTournamentSnapshotFrame(TOURNAMENT_ID);

    expect(syncTournamentState).toHaveBeenCalled();
  });

  it("fait connaître aux listes une bascule déclenchée à la lecture", async () => {
    // La même bascule déclenchée depuis la liste publie un événement ; sans ce
    // pendant, un tournoi démarré parce qu'un spectateur a ouvert sa page
    // resterait annoncé « Inscriptions » dans la liste en cache.
    (hasPendingStateTransition as jest.Mock).mockResolvedValue(true as never);
    (syncTournamentState as jest.Mock).mockResolvedValue({
      row: runningRow(),
      stateChanged: true,
    } as never);

    await getTournamentSnapshotFrame(TOURNAMENT_ID);

    expect(invalidateTournamentLists).toHaveBeenCalled();
  });

  it("ne touche pas aux listes quand rien n'a basculé", async () => {
    (hasPendingStateTransition as jest.Mock).mockResolvedValue(true as never);

    await getTournamentSnapshotFrame(TOURNAMENT_ID);

    expect(invalidateTournamentLists).not.toHaveBeenCalled();
  });
});
