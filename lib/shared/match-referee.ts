/**
 * Arbitre désigné d'un match, autogestion et réglages de la partie
 * (`docs/features/MATCH_REFEREE.md`) — règles pures, lues par le serveur et
 * par la carte du match.
 *
 * - Un **arbitre** se désigne lui-même (« Je prends ce match ») ou est désigné
 *   par le staff (permission `tournaments`). Il lui faut la permission
 *   `tournaments` et un tag Discord certifié ; en Overwatch, **aussi** un compte
 *   Battle.net rattaché, car les équipes l'ajoutent en jeu (hors Overwatch, on
 *   ne s'invite pas par BattleTag, décision 35 : pas de Battle.net demandé).
 *   Il peut aussi caster le match ;
 *   il ne peut pas le jouer.
 * - L'**autogestion** s'allume à la main, par le staff : désigner un arbitre
 *   l'éteint, l'allumer retire l'arbitre. Sans l'un ni l'autre, le match reste
 *   « sans décision » : rien ne bascule d'office (le staff est seulement averti
 *   au lancement).
 * - **Hôte** : celui que le staff a choisi, sinon — en BlueGenji Survie, phase
 *   finale — la meilleure tête de série, sinon l'équipe 1. Il prend le côté
 *   gauche ; l'autre équipe bannit la première.
 */
import { identityBlockIsDiscordOnly, identityComplete, type CasterIdentity } from "./match-launch";
import { visibleText } from "./visible-text";
import type { MatchStatus, TournamentGame } from "./types";

/** Ce qui empêche un compte d'arbitrer un match. */
/** `REFEREE_DISCORD_REQUIRED` : match Marvel Rivals, le seul tag Discord certifié manque (`CastBlock`). */
export type RefereeBlock = "NOT_REFEREE" | "REFEREE_IDENTITY_REQUIRED" | "REFEREE_DISCORD_REQUIRED";

/**
 * Pourquoi un compte ne peut pas arbitrer **ce** match, tel que la fenêtre
 * « Arbitrage » le dit : la condition d'arbitrage (`RefereeBlock`), le compte
 * qui joue le match, l'opposition retenue, ou le compte disparu (arbitre en
 * place seulement). Les codes du serveur, traduits FR/EN.
 */
export type RefereeIneligibility = RefereeBlock | "REFEREE_IS_PLAYER" | "REFEREE_OBJECTION" | "ACCOUNT_GONE";

// Un code ajouté au type sans entrée ici ne compile pas (`satisfies`).
const REFEREE_INELIGIBILITY_SET = {
  NOT_REFEREE: true,
  REFEREE_IDENTITY_REQUIRED: true,
  REFEREE_DISCORD_REQUIRED: true,
  REFEREE_IS_PLAYER: true,
  REFEREE_OBJECTION: true,
  ACCOUNT_GONE: true,
} satisfies Record<RefereeIneligibility, true>;

/** Tous les motifs, pour vérifier que chacun a son texte. */
export const REFEREE_INELIGIBILITIES = Object.keys(REFEREE_INELIGIBILITY_SET) as readonly RefereeIneligibility[];

/**
 * Motif qui empêche d'arbitrer, `null` si rien ne l'empêche.
 * `hasTournamentsPermission` est la permission `tournaments`.
 */
export function refereeBlockReason(
  hasTournamentsPermission: boolean,
  identity: CasterIdentity,
  game: TournamentGame,
): RefereeBlock | null {
  if (!hasTournamentsPermission) return "NOT_REFEREE";
  if (!identityComplete(identity, game)) return identityBlockIsDiscordOnly(game) ? "REFEREE_DISCORD_REQUIRED" : "REFEREE_IDENTITY_REQUIRED";
  return null;
}

/** Décision d'organisation d'un match : un arbitre, l'autogestion, ou rien encore. */
export type RefereeDecision = "REFEREE" | "SELF_MANAGED" | "UNDECIDED";

export function refereeDecision(match: { refereeAssigned: boolean; selfManaged: boolean }): RefereeDecision {
  if (match.refereeAssigned) return "REFEREE";
  if (match.selfManaged) return "SELF_MANAGED";
  return "UNDECIDED";
}

/** Longueur maximale de la première carte (`bg_matches.first_map`). */
export const FIRST_MAP_MAX_LENGTH = 64;

/**
 * Première carte saisie par le staff : forme affichable (`visibleText`), vide = aucune.
 * `null` en entrée comme en sortie veut dire « retirer ».
 *
 * @throws `INVALID_FIRST_MAP` si la valeur n'est pas un texte ou dépasse la longueur.
 */
export function normalizeFirstMap(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw new Error("INVALID_FIRST_MAP");
  const value = visibleText(raw);
  if (value === "") return null;
  if ([...value].length > FIRST_MAP_MAX_LENGTH) throw new Error("INVALID_FIRST_MAP");
  return value;
}

/**
 * Équipe hôte du match : celle que le staff a désignée (si elle joue encore
 * le match), sinon la meilleure tête de série quand le format en donne
 * (`seedOf`, rang 1 = meilleure — BlueGenji Survie, phase finale), sinon
 * l'équipe 1. `seeds` : rang de chaque engagée (`null` hors de ce cas).
 */
export function matchHostTeamId(
  storedHostTeamId: number | null,
  team1Id: number | null,
  team2Id: number | null,
  seeds?: { team1: number | null; team2: number | null },
): number | null {
  if (storedHostTeamId !== null && (storedHostTeamId === team1Id || storedHostTeamId === team2Id)) {
    return storedHostTeamId;
  }
  if (seeds && team2Id !== null && seeds.team1 !== null && seeds.team2 !== null && seeds.team2 < seeds.team1) {
    return team2Id;
  }
  return team1Id;
}

/** L'équipe qui bannit la première : celle qui n'héberge pas. `null` tant qu'un adversaire manque. */
export function firstBanTeamId(
  hostTeamId: number | null,
  team1Id: number | null,
  team2Id: number | null,
): number | null {
  if (hostTeamId === null || team1Id === null || team2Id === null) return null;
  return hostTeamId === team1Id ? team2Id : team1Id;
}

/**
 * Premier ban d'un match **dont l'arbitre désigné crée la partie** : l'équipe
 * qui n'est pas la meilleure tête de série (`matchHostTeamId` sans l'hôte choisi
 * par le staff — rang d'endurance en BlueGenji Survie, phase finale, sinon
 * l'équipe 1), quelle que soit la règle de premier ban du tournoi : aucune
 * équipe n'héberge. `null` tant qu'un adversaire manque.
 */
export function refereeHostedFirstBanTeamId(
  team1Id: number | null,
  team2Id: number | null,
  seeds?: { team1: number | null; team2: number | null },
): number | null {
  return firstBanTeamId(matchHostTeamId(null, team1Id, team2Id, seeds), team1Id, team2Id);
}

/** Un match entré en lancement sans arbitre ni autogestion, avant son alerte. */
export type NoRefereeCandidate = {
  matchId: number;
  /** Appariement lancé (`launchPairingKey`). */
  pairing: string;
  /** Le match a une heure (`start_at`) : il se joue à son heure, pas avec sa manche. */
  scheduled: boolean;
  phaseId: number;
  bracket: string;
  roundNumber: number;
};

/** Une manche sans horaire dont des matchs entrent en lancement sans décision, chacun avec son appariement. */
export type NoRefereeRound = {
  phaseId: number;
  bracket: string;
  roundNumber: number;
  matches: { matchId: number; pairing: string }[];
};

/**
 * Regroupe les alertes « sans arbitre ni autogestion » (décision de
 * l'utilisateur, 2026-10-27) : un match **planifié** garde son alerte à lui
 * (les matchs ne se jouent pas tous le même jour) ; les matchs **sans
 * horaire** d'une même manche (phase, tableau, numéro) partagent une seule
 * alerte qui les liste. Matchs triés par identifiant, manches dans l'ordre de
 * leur premier match.
 */
export function groupNoRefereeAlerts(candidates: readonly NoRefereeCandidate[]): {
  perMatch: NoRefereeCandidate[];
  perRound: NoRefereeRound[];
} {
  const sorted = [...candidates].sort((a, b) => a.matchId - b.matchId);
  const perMatch = sorted.filter((candidate) => candidate.scheduled);
  const rounds = new Map<string, NoRefereeRound>();
  for (const candidate of sorted) {
    if (candidate.scheduled) continue;
    const key = `${candidate.phaseId}:${candidate.bracket}:${candidate.roundNumber}`;
    const round = rounds.get(key);
    const match = { matchId: candidate.matchId, pairing: candidate.pairing };
    if (round) round.matches.push(match);
    else {
      rounds.set(key, {
        phaseId: candidate.phaseId,
        bracket: candidate.bracket,
        roundNumber: candidate.roundNumber,
        matches: [match],
      });
    }
  }
  return { perMatch, perRound: [...rounds.values()] };
}

/** Pseudo d'arbitre lié à l'empreinte de sa désignation (`TournamentViewerContext.refereeNames`). */
type RefereeNameEntry = { matchId: number; refereeKey: string; pseudo: string; mine?: true };

/** Ce qu'il faut d'un match pour savoir s'il nomme son arbitre. */
type RefereeNamedMatch = { id: number; refereeKey: string | null; status: MatchStatus };

/**
 * Ce match nomme-t-il son arbitre aux membres (décision 52) ? Désignation
 * montrée (empreinte non nulle) **et** score pas encore déclaré
 * (`PENDING`/`READY`) : textes RGPD « jusqu'à la déclaration de son score ou
 * la fin du tournoi ». L'empreinte, elle, reste jusqu'à la fin du match pour
 * la fenêtre « Contacts ».
 */
export function showsRefereeName(match: RefereeNamedMatch): boolean {
  return match.refereeKey !== null && (match.status === "PENDING" || match.status === "READY");
}

/**
 * Pseudo de l'arbitre à montrer sur ce match (décision 52), `null` pour lire
 * « Arbitre désigné » : sans arbitre montré, sur la page sans compte (empreinte
 * nulle), ou quand le pseudo connu est celui d'une autre désignation.
 */
export function refereeNameOf(
  match: RefereeNamedMatch,
  names: readonly RefereeNameEntry[],
): string | null {
  if (!showsRefereeName(match)) return null;
  const entry = names.find((name) => name.matchId === match.id && name.refereeKey === match.refereeKey);
  // Une entrée sans pseudo (arbitre reconnu de lui seul, `markViewerReferee`) ne nomme personne.
  return entry && entry.pseudo !== "" ? entry.pseudo : null;
}

/**
 * Le lecteur est-il l'arbitre désigné **montré** de ce match (`mine` posé par
 * `markViewerReferee`, même empreinte que l'instantané) ? Ouvre la
 * configuration de diffusion (médiation, `CAST_SETTINGS.md`). Comme le pseudo,
 * vaut tant que le score n'est pas déclaré (`showsRefereeName`).
 */
export function viewerRefereesMatch(match: RefereeNamedMatch, names: readonly RefereeNameEntry[]): boolean {
  if (!showsRefereeName(match)) return false;
  return names.some(
    (name) => name.matchId === match.id && name.refereeKey === match.refereeKey && name.mine === true,
  );
}

/**
 * Empreintes des désignations montrées dont le pseudo manque, en une clé
 * stable (`""` : rien ne manque). Une nouvelle clé déclenche **une** relecture
 * des pseudos ; la même ne la relance pas (pseudo vide, lecture en retard).
 */
export function missingRefereeNamesKey(
  matches: readonly RefereeNamedMatch[],
  names: readonly RefereeNameEntry[],
): string {
  const missing: string[] = [];
  for (const match of matches) {
    if (refereeNameMissing(match, names)) missing.push(`${match.id}:${match.refereeKey}`);
  }
  return missing.join(",");
}

/**
 * Désignation montrée que `names` ne résout pas : ni pseudo, ni marque de
 * l'arbitre lui-même (`mine`, posée même quand son pseudo n'est pas lisible —
 * `markViewerReferee` : la relire n'apprendrait rien de plus).
 */
function refereeNameMissing(match: RefereeNamedMatch, names: readonly RefereeNameEntry[]): boolean {
  if (!showsRefereeName(match)) return false;
  const entry = names.find((name) => name.matchId === match.id && name.refereeKey === match.refereeKey);
  return entry === undefined || (entry.pseudo === "" && entry.mine !== true);
}

/**
 * Faut-il relire les pseudos, et quel essai retenir ? `missing` : la clé de
 * {@link missingRefereeNamesKey} ; `attempted` : celle du dernier essai.
 *
 * - rien ne manque : **l'essai est oublié**. Un pseudo élagué de l'état du
 *   client (score déclaré) puis de nouveau montré (score rejeté) redonne la
 *   même clé, qui doit relancer une relecture — sinon « Arbitre désigné »
 *   resterait, et l'arbitre perdrait sa marque `mine` jusqu'à la reconnexion ;
 * - même clé que le dernier essai : pas de relecture (pseudo vide, réponse en retard) ;
 * - clé nouvelle : une relecture.
 */
export function refereeNamesAttempt(missing: string, attempted: string): { read: boolean; attempted: string } {
  if (missing === "") return { read: false, attempted: "" };
  return { read: missing !== attempted, attempted };
}

/**
 * Désignation déjà résolue (`held`) : seule la marque `mine` (éligibilité de
 * l'arbitre, relue par le serveur) peut avoir changé sous la même empreinte.
 * L'entrée relue qui la change, `"drop"` quand la marque tombe sur un pseudo
 * illisible (absent de la liste commune), `null` sinon. Une réponse qui connaît
 * le match sous une autre empreinte (`otherKey`, en retard) ne retire rien.
 */
function refereeMarkChange<T extends RefereeNameEntry>(held: T | undefined, found: T | undefined, otherKey: boolean): T | "drop" | null {
  if (held === undefined) return null;
  if (held.mine !== true) return found?.mine === true ? found : null;
  if (otherKey) return null;
  if (found === undefined) return "drop";
  return found.mine === true ? null : found;
}

/**
 * Fusionne une liste de pseudos relue dans celle qu'on a : chaque désignation
 * montrée encore sans pseudo que la réponse **résout** (même empreinte, pseudo
 * ou marque `mine`) prend l'entrée relue, de même qu'une désignation déjà
 * résolue dont la marque `mine` a changé sous la même empreinte (arbitre devenu
 * éligible ou ne l'étant plus) ; le reste est gardé tel quel. Une
 * réponse en retard (lue avant une désignation plus récente, ou doublée par le
 * contexte d'une reconnexion) n'écrase donc jamais une liste plus à jour, et
 * une réponse qui résout un **autre** sous-ensemble n'est pas perdue.
 *
 * `names` : la liste fusionnée, `null` si la réponse ne résout rien.
 * `stale` : la réponse connaît une désignation manquante sous une **autre**
 * empreinte — le serveur retardait : la relecture est à refaire plus tard.
 */
export function mergeRefereeNames<T extends RefereeNameEntry>(
  matches: readonly RefereeNamedMatch[],
  current: readonly T[],
  incoming: readonly T[],
): { names: T[] | null; stale: boolean } {
  const added: T[] = [];
  const dropped = new Set<number>();
  let stale = false;
  for (const match of matches) {
    const found = incoming.find((name) => name.matchId === match.id && name.refereeKey === match.refereeKey);
    const otherKey = incoming.some((name) => name.matchId === match.id && name.refereeKey !== match.refereeKey);
    if (!refereeNameMissing(match, current)) {
      const held = current.find((name) => name.matchId === match.id && name.refereeKey === match.refereeKey);
      const change = refereeMarkChange(held, found, otherKey);
      if (change === "drop") dropped.add(match.id);
      else if (change !== null) added.push(change);
      continue;
    }
    if (found && (found.pseudo !== "" || found.mine === true)) added.push(found);
    else if (otherKey) stale = true;
  }
  if (added.length === 0 && dropped.size === 0) return { names: null, stale };
  for (const name of added) dropped.add(name.matchId);
  return { names: [...current.filter((name) => !dropped.has(name.matchId)), ...added], stale };
}

/** Plus courte attente avant de relire les pseudos après un échec (429, 5xx, réseau, réponse en retard). */
export const REFEREE_NAMES_RETRY_MS = 10_000;

/**
 * Attente avant de relire les pseudos après un échec : l'en-tête `Retry-After`
 * (secondes) d'un refus de quota, jamais moins de {@link REFEREE_NAMES_RETRY_MS}.
 */
export function refereeNamesRetryDelay(retryAfter: string | null): number {
  const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
  const asked = Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : 0;
  return Math.max(REFEREE_NAMES_RETRY_MS, asked);
}

/** Liste de pseudos d'arbitre reçue d'une réponse (forme contrôlée), `null` si elle n'en est pas une. */
export function parseRefereeNames(value: unknown): RefereeNameEntry[] | null {
  if (!Array.isArray(value)) return null;
  const names: RefereeNameEntry[] = [];
  for (const item of value as unknown[]) {
    if (!item || typeof item !== "object") continue;
    const { matchId, refereeKey, pseudo, mine } = item as Record<string, unknown>;
    if (typeof matchId !== "number" || typeof refereeKey !== "string" || typeof pseudo !== "string") continue;
    names.push(mine === true ? { matchId, refereeKey, pseudo, mine } : { matchId, refereeKey, pseudo });
  }
  return names;
}
