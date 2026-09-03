/**
 * Lien profond vers **un match** d'un tournoi — module pur, partagé.
 *
 * La carte « en cours » de l'accueil met un match en avant sans qu'on puisse
 * l'ouvrir : le visiteur lit deux noms d'équipes et doit ensuite retrouver la
 * manche à la main dans un plateau qui peut compter 127 cartes. Le chemin
 * `/tournois/[id]#match-[matchId]` répond aux deux moitiés du problème — il
 * ouvre le tournoi, et il dit **lequel** de ses matchs on venait voir.
 *
 * Trois raisons de poser la règle ici plutôt qu'à chaque écran :
 *
 * 1. **L'ancre est un contrat entre deux pages.** Celle qui écrit le lien
 *    (l'accueil) et celle qui le consomme (la fiche du tournoi) ne partagent
 *    rien d'autre ; deux `\`match-\${id}\`` écrits à la main dériveraient sans
 *    qu'aucun test ne s'en aperçoive — le lien mènerait simplement au haut de
 *    la page, panne muette s'il en est.
 * 2. **Le fragment revient du navigateur**, donc d'une source qu'on ne choisit
 *    pas : `parseMatchAnchor` refuse tout ce qui n'est pas un identifiant
 *    positif écrit en clair, plutôt que de laisser un `NaN` traverser jusqu'à
 *    un `document.getElementById`.
 * 3. **Le format à onglets** (`MULTI`) rend le match d'une seule phase à la
 *    fois : révéler la cible demande de choisir la bonne phase *avant* de
 *    chercher l'élément. C'est une décision, pas un effet de bord du DOM —
 *    elle se teste donc ici (`phaseRevealingMatch`), pas dans un hook.
 *
 * Le défilement lui-même reste dans le hook `useMatchAnchor` : lui seul touche
 * au DOM.
 */

/** Préfixe des identifiants DOM portés par les cartes de match. */
export const MATCH_ANCHOR_PREFIX = "match-";

/** Vrai pour un identifiant de match exploitable (entier strictement positif). */
function isMatchId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * Identifiant DOM de la carte d'un match.
 *
 * Unique point d'écriture : `MatchRow` le pose, `useMatchAnchor` le cherche, et
 * `tournamentMatchHref` le publie dans l'URL.
 */
export function matchAnchorId(matchId: number): string {
  return `${MATCH_ANCHOR_PREFIX}${matchId}`;
}

/**
 * Identifiant de match porté par un fragment d'URL, ou `null`.
 *
 * Accepte `#match-42` comme `match-42` (`window.location.hash` garde le dièse,
 * un attribut `id` non). Tout le reste est refusé, y compris les formes qui
 * *pourraient* se convertir : `match-0`, `match-1.5`, `match-01`, `match-+1`,
 * `match-1e3`. Un identifiant de match est écrit en base 10 sans fioriture, et
 * une tolérance ici se paierait en cible fantôme sur la fiche du tournoi.
 */
export function parseMatchAnchor(hash: string | null | undefined): number | null {
  if (typeof hash !== "string") return null;
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw.startsWith(MATCH_ANCHOR_PREFIX)) return null;

  const digits = raw.slice(MATCH_ANCHOR_PREFIX.length);
  if (!/^[1-9][0-9]*$/.test(digits)) return null;

  const matchId = Number(digits);
  return isMatchId(matchId) ? matchId : null;
}

/**
 * Chemin de la fiche d'un tournoi, ancré sur un match quand on en désigne un.
 *
 * `matchId` absent ou inexploitable → le tournoi seul : mieux vaut une page
 * ouverte en haut qu'une ancre qui ne désigne rien.
 */
export function tournamentMatchHref(
  tournamentId: number,
  matchId?: number | null,
): string {
  const base = `/tournois/${tournamentId}`;
  return isMatchId(matchId) ? `${base}#${matchAnchorId(matchId)}` : base;
}

/** Vue minimale d'un match pour la résolution de phase. */
export type PhasedMatch = {
  id: number;
  /** Phase du match ; `0` = tournoi sans phases. */
  phaseId: number;
};

/**
 * Phase à sélectionner pour que le match visé soit rendu, ou `null` s'il n'y a
 * rien à changer.
 *
 * `null` couvre quatre cas volontairement confondus — dans tous, la vue
 * courante est celle qu'il faut : match encore inconnu (le plateau n'est pas
 * arrivé), tournoi sans phases (`phaseId === 0`), phase déjà sélectionnée, et
 * sélection encore indéterminée alors que le match est hors phase.
 *
 * Ne renvoie **jamais** deux fois la même correction : c'est à l'appelant de
 * n'appliquer la bascule qu'une fois par cible, sans quoi un clic sur une autre
 * phase serait aussitôt défait par l'ancre — la page deviendrait impossible à
 * naviguer tant que le fragment resterait dans l'URL.
 */
export function phaseRevealingMatch(
  matches: readonly PhasedMatch[] | null | undefined,
  matchId: number | null,
  selectedPhaseId: number | null,
): number | null {
  if (matchId === null || !matches) return null;

  const match = matches.find((candidate) => candidate.id === matchId);
  if (!match) return null;
  if (match.phaseId === 0) return null;
  if (match.phaseId === selectedPhaseId) return null;

  return match.phaseId;
}
