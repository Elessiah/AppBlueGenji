import { EventEmitter } from "node:events";

type TournamentLiveEvent = {
  /**
   * `deleted` annonce la disparition définitive du tournoi : les abonnés ne
   * doivent pas le recharger (l'API répondrait 404) mais quitter la fiche.
   */
  type: "updated" | "score_reported" | "score_resolved" | "deleted";
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

export function getSubscribersCount(tournamentId: number): number {
  return getEmitter().listenerCount(key(tournamentId));
}

export type { TournamentLiveEvent };
