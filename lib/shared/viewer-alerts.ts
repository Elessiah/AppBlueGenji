/**
 * Ce qui mérite d'aller chercher le lecteur quand il ne regarde pas la page.
 *
 * Un joueur laisse l'onglet du tournoi sur un second écran, ou derrière son jeu :
 * la page ne se peint plus (ou presque, voir `lib/shared/client-power.ts`), mais
 * elle doit encore savoir **dire** que son match commence. Ce module compare deux
 * instantanés successifs et nomme l'évènement ; la page en fait un titre
 * d'onglet et, quand il le concerne, un signal sonore.
 *
 * Quatre évènements, du plus au moins pressant — un seul est retenu par
 * instantané, le plus précis : « ton match est prêt » dit déjà qu'une manche a
 * commencé.
 *
 * Module pur, testable sans navigateur.
 */

export type ViewerAlert =
  /** Un match du lecteur attend qu'il confirme (ou conteste) le score adverse. */
  | "SCORE_TO_CONFIRM"
  /** Un match du lecteur vient de devenir jouable : les deux engagées sont connues. */
  | "MATCH_READY"
  /** Le tournoi vient d'être lancé. */
  | "TOURNAMENT_STARTED"
  /** Une nouvelle manche (ou un nouveau tour) s'ouvre sur le plateau. */
  | "ROUND_STARTED";

/** Ordre de priorité : le premier présent l'emporte. */
export const VIEWER_ALERT_PRIORITY: readonly ViewerAlert[] = [
  "SCORE_TO_CONFIRM",
  "MATCH_READY",
  "TOURNAMENT_STARTED",
  "ROUND_STARTED",
];

type AlertMatch = {
  id: number;
  status: string;
  team1Id: number | null;
  team2Id: number | null;
  roundNumber: number;
  bracket: string;
  phaseId: number;
  /** Horodatage de la dernière écriture : change à chaque saisie sur la ligne. */
  updatedAt?: string;
};

/** Ce dont la comparaison a besoin — satisfait par `TournamentDetail`. */
export type ViewerAlertDetail = {
  card: { state: string };
  myTeamId: number | null;
  matches: ReadonlyArray<AlertMatch>;
};

function involves(match: AlertMatch, teamId: number | null): boolean {
  return teamId !== null && (match.team1Id === teamId || match.team2Id === teamId);
}

function isPlayable(match: AlertMatch): boolean {
  return match.status === "READY" && match.team1Id !== null && match.team2Id !== null;
}

function idsWhere(detail: ViewerAlertDetail, keep: (match: AlertMatch) => boolean): Set<number> {
  return new Set(detail.matches.filter(keep).map((match) => match.id));
}

/**
 * Manches ouvertes : celles qui portent au moins une rencontre jouable. La clé
 * mêle phase, tableau et numéro de manche — en double élimination, le tour 2 du
 * tableau principal et le tour 2 du repêchage sont deux manches.
 */
function openRounds(detail: ViewerAlertDetail): Set<string> {
  const keys = new Set<string>();
  for (const match of detail.matches) {
    if (isPlayable(match)) keys.add(`${match.phaseId}:${match.bracket}:${match.roundNumber}`);
  }
  return keys;
}

function gained<T>(before: Set<T>, after: Set<T>): boolean {
  for (const value of after) if (!before.has(value)) return true;
  return false;
}

/**
 * L'évènement que porte le passage de `previous` à `next`, ou `null`.
 *
 * Rien au premier instantané (`previous === null`) : ouvrir la page n'est pas
 * une nouvelle, et on sonnerait à chaque chargement d'un tournoi en cours.
 */
export function viewerAlert(
  previous: ViewerAlertDetail | null,
  next: ViewerAlertDetail,
): ViewerAlert | null {
  if (!previous) return null;
  const me = next.myTeamId;

  const found = new Set<ViewerAlert>();

  if (me !== null) {
    const awaiting = (match: AlertMatch) =>
      match.status === "AWAITING_CONFIRMATION" && involves(match, me);
    if (gained(idsWhere(previous, awaiting), idsWhere(next, awaiting))) {
      found.add("SCORE_TO_CONFIRM");
    }

    const playable = (match: AlertMatch) => isPlayable(match) && involves(match, me);
    if (gained(idsWhere(previous, playable), idsWhere(next, playable))) {
      found.add("MATCH_READY");
    }
  }

  if (previous.card.state !== "RUNNING" && next.card.state === "RUNNING") {
    found.add("TOURNAMENT_STARTED");
  }

  if (next.card.state === "RUNNING" && gained(openRounds(previous), openRounds(next))) {
    found.add("ROUND_STARTED");
  }

  return VIEWER_ALERT_PRIORITY.find((alert) => found.has(alert)) ?? null;
}

/**
 * L'évènement concerne-t-il le lecteur **personnellement** ? Seuls ceux-là ont
 * droit au signal sonore : un spectateur n'a pas à entendre sonner chaque
 * nouvelle manche d'un tournoi où il ne joue pas.
 */
export function isPersonalAlert(alert: ViewerAlert): boolean {
  return alert === "SCORE_TO_CONFIRM" || alert === "MATCH_READY";
}

/** Préfixe du titre d'onglet, tant que le lecteur n'est pas revenu. */
export function viewerAlertTitle(alert: ViewerAlert): string {
  switch (alert) {
    case "SCORE_TO_CONFIRM":
      return "Score à confirmer";
    case "MATCH_READY":
      return "Ton match est prêt";
    case "TOURNAMENT_STARTED":
      return "Le tournoi commence";
    case "ROUND_STARTED":
      return "Nouvelle manche";
  }
}

/** Titre complet : repère visuel, évènement, puis le titre d'origine. */
export function attentionDocumentTitle(alert: ViewerAlert, baseTitle: string): string {
  const base = baseTitle.trim();
  return base ? `● ${viewerAlertTitle(alert)} · ${base}` : `● ${viewerAlertTitle(alert)}`;
}

/**
 * L'instantané touche-t-il **le match du lecteur** ? Ce qui le concerne est
 * rendu sans attendre, même quand le reste du plateau est regroupé : c'est la
 * seule partie de la page qu'il regarde pendant sa partie.
 */
export function touchesViewerMatches(
  previous: ViewerAlertDetail | null,
  next: ViewerAlertDetail,
): boolean {
  if (!previous) return true;
  if (previous.card.state !== next.card.state) return true;
  const me = next.myTeamId;
  if (me === null) return false;
  return viewerMatchesFingerprint(previous, me) !== viewerMatchesFingerprint(next, me);
}

/** Empreinte des rencontres d'une engagée : ce qui, s'il bouge, doit se voir. */
function viewerMatchesFingerprint(detail: ViewerAlertDetail, teamId: number): string {
  return detail.matches
    .filter((match) => involves(match, teamId))
    .map(
      (match) =>
        `${match.id}:${match.status}:${match.team1Id ?? ""}:${match.team2Id ?? ""}:${match.updatedAt ?? ""}`,
    )
    .sort()
    .join("|");
}
