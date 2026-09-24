import { EventEmitter } from "node:events";

type TournamentLiveEvent = {
  /**
   * `match_updated` : un match a changé sans que son résultat bouge (lancement,
   * antenne, horaire…). Distinct de `updated`, qui dit qu'un tournoi a changé,
   * pour qu'aucun abonné ne confonde les deux mesures.
   */
  type: "updated" | "match_updated" | "score_reported" | "score_resolved";
  tournamentId: number;
  matchId?: number;
  emittedAt: string;
};

type GlobalWithEmitter = typeof globalThis & {
  __bgTournamentEmitter?: EventEmitter;
};

function getEmitter(): EventEmitter {
  const globalRef = globalThis as GlobalWithEmitter;
  if (!globalRef.__bgTournamentEmitter) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(200);
    globalRef.__bgTournamentEmitter = emitter;
  }
  return globalRef.__bgTournamentEmitter;
}

function key(id: number): string {
  return `tournament:${id}`;
}

export function publishTournamentEvent(event: TournamentLiveEvent): void {
  getEmitter().emit(key(event.tournamentId), event);
}

export function subscribeTournament(
  tournamentId: number,
  callback: (event: TournamentLiveEvent) => void,
): () => void {
  const emitter = getEmitter();
  const listener = (event: TournamentLiveEvent): void => callback(event);
  emitter.on(key(tournamentId), listener);
  return () => emitter.off(key(tournamentId), listener);
}

export type { TournamentLiveEvent };
