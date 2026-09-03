/**
 * Inscription **en lot** d'engagés sans compte (équipes fantômes, ou joueurs
 * invités si le tournoi est individuel).
 *
 * Le staff `tournaments` remplissait un plateau une équipe à la fois : ouvrir
 * le dialogue, choisir dans un `<select>`, valider, recommencer. Sur un plateau
 * de 32 à compléter, le geste se répétait trente fois, et rien n'empêchait de
 * reproposer une équipe déjà engagée — le refus n'arrivait qu'après l'aller-
 * retour, sous forme d'`ALREADY_REGISTERED`.
 *
 * Ce module porte la partie purement décidable de la fonctionnalité : lire une
 * sélection venue du réseau, et composer les phrases qui en rendent compte. Il
 * ne connaît ni la base ni React, et sert des deux côtés — le serveur valide
 * avec, l'interface borne son bouton avec.
 *
 * **Tout ou rien.** Un lot est une seule intention : ou bien les engagés
 * choisis entrent tous, ou bien aucun n'entre. Le serveur l'écrit dans une
 * transaction unique (`registerGhostTeams`), et le refus nomme l'engagé qui a
 * bloqué — un résultat partiel obligerait le staff à recouper sa sélection
 * contre la liste des inscrites pour savoir ce qui est passé, et distribuerait
 * les rangs de départ à un préfixe arbitraire de la sélection.
 */
import type { ParticipantWording } from "./participants";

/**
 * Plafond de taille d'un lot. Sans rapport avec l'effectif du tournoi (borné,
 * lui, à 256 places par la validation de création) : c'est une borne de forme
 * sur le corps de la requête, pour qu'une sélection aberrante soit refusée
 * avant d'ouvrir une transaction.
 */
export const GHOST_BATCH_MAX = 256;

/** Refus de forme d'une sélection, avant toute lecture en base. */
export type GhostBatchRejection =
  /** Le corps ne porte pas une liste d'identifiants entiers positifs. */
  | "INVALID_TEAM_IDS"
  /** Liste vide : il n'y a rien à inscrire. */
  | "EMPTY_TEAM_SELECTION"
  /** Au-delà de {@link GHOST_BATCH_MAX}. */
  | "TOO_MANY_TEAMS";

export type GhostBatchSelection =
  | { ok: true; teamIds: number[] }
  | { ok: false; error: GhostBatchRejection };

/**
 * Lit une sélection d'engagés venue du réseau.
 *
 * Les doublons sont **écartés en silence**, dans l'ordre d'apparition : deux
 * fois le même identifiant dit la même intention (« inscris cet engagé »), et
 * le punir par un `ALREADY_REGISTERED` reviendrait à refuser tout le lot pour
 * une maladresse du client.
 */
export function parseGhostBatch(raw: unknown): GhostBatchSelection {
  if (!Array.isArray(raw)) return { ok: false, error: "INVALID_TEAM_IDS" };
  if (raw.length === 0) return { ok: false, error: "EMPTY_TEAM_SELECTION" };

  const teamIds: number[] = [];
  for (const value of raw) {
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
      return { ok: false, error: "INVALID_TEAM_IDS" };
    }
    if (!teamIds.includes(value)) teamIds.push(value);
  }

  if (teamIds.length > GHOST_BATCH_MAX) return { ok: false, error: "TOO_MANY_TEAMS" };

  return { ok: true, teamIds };
}

/**
 * Places encore libres. Jamais négatif : un tournoi dont l'effectif maximal a
 * été réduit après coup peut compter plus d'inscrites que de places, et une
 * valeur négative ferait écrire « -3 places restantes ».
 */
export function remainingSlots(maxTeams: number, registeredTeams: number): number {
  return Math.max(0, maxTeams - registeredTeams);
}

/**
 * Rapproche un nom d'une saisie de recherche, sans se soucier de la casse ni
 * des accents : la liste peut compter cent quarante équipes de remplissage, et
 * « equipe » doit y trouver « Équipe ».
 */
export function matchesTeamSearch(name: string, query: string): boolean {
  const needle = normalizeSearch(query);
  return needle.length === 0 || normalizeSearch(name).includes(needle);
}

/** Première et dernière marque diacritique combinante (bloc Unicode). */
const COMBINING_FIRST = 0x300;
const COMBINING_LAST = 0x36f;

/**
 * Minuscules sans accent. Le filtrage se fait par code de caractère plutôt que
 * par classe de regex : une classe portant des marques combinantes se lit mal
 * dans le source (elles se composent avec le crochet qui précède) et tombe sous
 * la règle ESLint `no-misleading-character-class`.
 */
function normalizeSearch(value: string): string {
  let stripped = "";
  for (const char of value.normalize("NFD")) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= COMBINING_FIRST && code <= COMBINING_LAST) continue;
    stripped += char;
  }
  return stripped.toLowerCase().trim();
}

/**
 * Confirmation après un lot. Le vocabulaire vient du type de participant :
 * « équipes fantômes » en tournoi par équipes, « joueurs invités » en
 * individuel — c'est la même ligne `bg_teams` dans les deux cas.
 */
export function guestBatchSuccessMessage(count: number, wording: ParticipantWording): string {
  return count <= 1 ? wording.guestSuccess : `${count} ${wording.guestManySuccess}`;
}

/**
 * Engagé nommé par une erreur d'inscription, s'il y en a un.
 *
 * Le moteur joint un `teamId` aux refus qui désignent un engagé précis
 * (`ALREADY_REGISTERED`, `NOT_A_GHOST_TEAM`…). La lecture vit ici, avec le reste
 * du pur : la route s'en sert pour joindre l'identifiant au corps de l'erreur,
 * l'interface pour retrouver le nom à afficher dans le toast.
 */
export function registrationErrorTeamId(error: unknown): number | undefined {
  const teamId = (error as { teamId?: unknown } | null)?.teamId;
  return typeof teamId === "number" && Number.isInteger(teamId) && teamId > 0 ? teamId : undefined;
}
