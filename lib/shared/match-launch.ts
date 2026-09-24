/**
 * Lancement d'un match : l'état « LANCEMENT », les trois « Prêt », l'équipe qui
 * héberge la partie et les contacts que la modale de lancement présente.
 *
 * Un match jouable (`READY`, deux engagées connues) ne se joue plus d'emblée :
 * à son heure de début — ou dès qu'il devient jouable s'il n'a pas d'horaire —
 * il entre en **lancement**. Les deux équipes, et le caster s'il y en a un,
 * déclarent alors qu'elles sont prêtes ; le match est **lancé** quand toutes
 * les parties le sont, quand l'arbitrage le force, ou d'office passé
 * {@link LAUNCH_AUTO_DELAY_MINUTES} minutes. Tant qu'il ne l'est pas, les
 * engagés ne peuvent pas y reporter de score (l'arbitrage garde la main).
 *
 * L'état n'est **pas une valeur de `bg_matches.status`** : l'ENUM du moteur
 * (`PENDING → READY → AWAITING_CONFIRMATION → COMPLETED`) est écrit par une
 * douzaine de chemins qui n'ont pas à connaître le lancement, et un statut de
 * plus les aurait tous obligés à choisir entre deux valeurs pour « jouable ».
 * Il se **dérive** d'un match `READY`, de son horaire et de `launched_at` —
 * comme l'état d'antenne d'une diffusion (`resolveMatchLiveState`).
 *
 * Module pur : serveur (qui refuse) et interface (qui ferme un bouton) lisent la
 * même règle.
 */

import type { MatchStatus, TeamRole } from "./types";

/**
 * Délai au-delà duquel un match en lancement part **d'office**, compté depuis
 * l'ouverture du lancement. Sans lui, une équipe absente — ou qui a oublié de
 * cliquer — tiendrait le plateau entier en otage jusqu'à ce qu'un arbitre passe.
 */
export const LAUNCH_AUTO_DELAY_MINUTES = 15;

/**
 * - `NONE` : rien à lancer (match à venir sans ses deux engagées, exemption,
 *   match terminé) ;
 * - `SCHEDULED` : jouable, mais son heure de début n'est pas atteinte ;
 * - `LOBBY` : **en lancement**, on attend les « Prêt » ;
 * - `LAUNCHED` : lancé, les scores peuvent être reportés.
 */
export type MatchLaunchPhase = "NONE" | "SCHEDULED" | "LOBBY" | "LAUNCHED";

/** Ce que la règle a besoin de savoir d'un match. */
export type MatchLaunchInput = {
  status: MatchStatus;
  team1Id: number | null;
  team2Id: number | null;
  /** ISO ; `null` = aucun horaire annoncé. */
  startAt: string | null;
  /** ISO ; `null` = pas encore lancé. */
  launchedAt: string | null;
};

function isoTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : time;
}

/**
 * Phase de lancement d'un match à l'instant `now` (ms).
 *
 * Un report déjà en attente de confirmation vaut lancé : il n'existe que parce
 * qu'on a joué — et les matchs en cours au déploiement sont ainsi rangés du bon
 * côté sans migration de données.
 */
export function matchLaunchPhase(match: MatchLaunchInput, now: number): MatchLaunchPhase {
  if (match.status === "COMPLETED" || match.status === "PENDING") return "NONE";
  if (match.team1Id === null || match.team2Id === null) return "NONE";
  if (match.status === "AWAITING_CONFIRMATION") return "LAUNCHED";
  if (match.launchedAt !== null) return "LAUNCHED";
  const start = isoTime(match.startAt);
  if (start !== null && start > now) return "SCHEDULED";
  return "LOBBY";
}

/**
 * Instant (ms) où la phase changera **sans écriture** — seule l'horloge fait
 * passer un match de `SCHEDULED` à `LOBBY`. `null` ailleurs : les autres
 * bascules sont des écritures, que le flux annonce.
 */
export function nextLaunchPhaseChangeAt(match: MatchLaunchInput, now: number): number | null {
  return matchLaunchPhase(match, now) === "SCHEDULED" ? isoTime(match.startAt) : null;
}

/**
 * Les engagés peuvent-ils reporter un score sur ce match ? Seulement lancé.
 * L'arbitrage n'est pas soumis à cette règle (forfait d'une équipe absente,
 * correction) : elle ne concerne que le report des joueurs.
 */
export function canPlayersReportScore(match: MatchLaunchInput, now: number): boolean {
  return matchLaunchPhase(match, now) === "LAUNCHED";
}

/** Instant (ISO) du lancement d'office, depuis l'ouverture du lancement. */
export function autoLaunchAt(lobbyOpenedAt: string | null): string | null {
  const opened = isoTime(lobbyOpenedAt);
  if (opened === null) return null;
  return new Date(opened + LAUNCH_AUTO_DELAY_MINUTES * 60_000).toISOString();
}

/** Le délai de lancement d'office est-il écoulé ? */
export function isAutoLaunchDue(lobbyOpenedAt: string | null, now: number): boolean {
  const due = isoTime(autoLaunchAt(lobbyOpenedAt));
  return due !== null && due <= now;
}

/** État des « Prêt » d'un match. */
export type LaunchReadiness = {
  team1Ready: boolean;
  team2Ready: boolean;
  /** Un caster est inscrit : il doit lui aussi se déclarer prêt. */
  casterRequired: boolean;
  casterReady: boolean;
};

/** Ce qu'il faut savoir d'un match pour compter ses « Prêt ». */
export type LaunchReadinessInput = {
  team1ReadyAt: string | null;
  team2ReadyAt: string | null;
  /** Une fantôme n'a personne pour cliquer : elle est prête d'office. */
  team1IsGhost: boolean;
  team2IsGhost: boolean;
  casterUserId: number | null;
  casterReadyAt: string | null;
};

export function launchReadiness(input: LaunchReadinessInput): LaunchReadiness {
  return {
    team1Ready: input.team1IsGhost || input.team1ReadyAt !== null,
    team2Ready: input.team2IsGhost || input.team2ReadyAt !== null,
    casterRequired: input.casterUserId !== null,
    casterReady: input.casterUserId !== null && input.casterReadyAt !== null,
  };
}

/**
 * Toutes les parties attendues sont-elles prêtes ? Le caster n'est attendu que
 * s'il est inscrit : sans caster, les deux équipes suffisent.
 */
export function allPartiesReady(readiness: LaunchReadiness): boolean {
  return (
    readiness.team1Ready &&
    readiness.team2Ready &&
    (!readiness.casterRequired || readiness.casterReady)
  );
}

/** Nombre de parties prêtes sur le nombre attendu (« 2/3 prêts »). */
export function readyCount(readiness: LaunchReadiness): { ready: number; expected: number } {
  const parties = [readiness.team1Ready, readiness.team2Ready];
  if (readiness.casterRequired) parties.push(readiness.casterReady);
  return { ready: parties.filter(Boolean).length, expected: parties.length };
}

/**
 * Rôles qui peuvent déclarer une équipe prête : ceux qui l'engagent (`OWNER`,
 * `MANAGER`) et son capitaine, qui la conduit en jeu. Un joueur de roster voit
 * la modale et l'attente, sans le bouton.
 */
export const TEAM_READY_ROLES: readonly TeamRole[] = ["CAPITAINE", "MANAGER", "OWNER"];

export function canDeclareTeamReady(roles: readonly TeamRole[] | null | undefined): boolean {
  if (!roles) return false;
  return roles.some((role) => TEAM_READY_ROLES.includes(role));
}

/**
 * Équipe qui héberge la partie (crée le salon en jeu). L'arbitrage peut la
 * désigner ; à défaut — ou si la valeur stockée ne désigne plus une des deux
 * engagées, après une correction qui a changé l'appariement — c'est l'équipe 1.
 */
export function resolveHostTeamId(
  storedHostTeamId: number | null,
  team1Id: number | null,
  team2Id: number | null,
): number | null {
  if (storedHostTeamId !== null && (storedHostTeamId === team1Id || storedHostTeamId === team2Id)) {
    return storedHostTeamId;
  }
  return team1Id;
}

/**
 * Pour caster un match, il faut pouvoir être joint **et** retrouvé en jeu : tag
 * Discord certifié et compte Battle.net rattaché. Un caster se présente aux
 * deux équipes dans la modale de lancement ; un tag saisi à la main ne dirait
 * rien de qui l'on invite dans son salon.
 */
export type CasterIdentity = {
  discordVerified: boolean;
  blizzardLinked: boolean;
};

export type CastBlock = "NOT_CASTER" | "CASTER_IDENTITY_REQUIRED";

/**
 * Motif qui empêche de caster, `null` si rien ne l'empêche. `hasLivePermission`
 * est la permission `live` (caster, arbitre, admin).
 */
export function castBlockReason(
  hasLivePermission: boolean,
  identity: CasterIdentity,
): CastBlock | null {
  if (!hasLivePermission) return "NOT_CASTER";
  if (!identity.discordVerified || !identity.blizzardLinked) return "CASTER_IDENTITY_REQUIRED";
  return null;
}

export const CAST_IDENTITY_NOTICE =
  "Pour caster un match, certifie ton tag Discord et rattache ton compte Battle.net depuis ton profil.";

// ─────────────────────────────────────────────────────────────────────────────
// Contacts présentés dans la modale
// ─────────────────────────────────────────────────────────────────────────────

/** Un membre du roster tel que le choix des contacts le lit. */
export type ContactCandidate = {
  userId: number;
  pseudo: string;
  roles: readonly TeamRole[];
  /** Tag Discord stocké, certifié ou non. */
  discordTag: string | null;
  discordVerified: boolean;
  battletag: string | null;
  /** Compte Battle.net rattaché : le BattleTag vient de Blizzard. */
  blizzardLinked: boolean;
};

/** Contact affiché, déjà filtré : un tag non certifié n'en sort jamais. */
export type LaunchContact = {
  userId: number;
  pseudo: string;
  roles: TeamRole[];
  /** Tag Discord **certifié** ; `null` sinon. */
  discordTag: string | null;
  battletag: string | null;
  /** `true` si le BattleTag vient d'un compte Battle.net rattaché. */
  battletagVerified: boolean;
};

function roleRank(roles: readonly TeamRole[]): number {
  if (roles.includes("CAPITAINE")) return 0;
  if (roles.includes("MANAGER")) return 1;
  if (roles.includes("OWNER")) return 2;
  return 3;
}

function hasVerifiedDiscord(member: ContactCandidate): boolean {
  return member.discordVerified && Boolean(member.discordTag);
}

function hasVerifiedBattletag(member: ContactCandidate): boolean {
  return member.blizzardLinked && Boolean(member.battletag);
}

function verifiedKinds(member: ContactCandidate): number {
  return Number(hasVerifiedDiscord(member)) + Number(hasVerifiedBattletag(member));
}

/** Ordre de priorité d'un roster : vérifié d'abord, puis rôle, puis pseudo. */
function compareCandidates(a: ContactCandidate, b: ContactCandidate): number {
  const verifiedA = verifiedKinds(a) > 0 ? 0 : 1;
  const verifiedB = verifiedKinds(b) > 0 ? 0 : 1;
  if (verifiedA !== verifiedB) return verifiedA - verifiedB;
  const rank = roleRank(a.roles) - roleRank(b.roles);
  if (rank !== 0) return rank;
  const kinds = verifiedKinds(b) - verifiedKinds(a);
  if (kinds !== 0) return kinds;
  return a.pseudo.localeCompare(b.pseudo, "fr") || a.userId - b.userId;
}

function toContact(member: ContactCandidate): LaunchContact {
  return {
    userId: member.userId,
    pseudo: member.pseudo,
    roles: [...member.roles],
    discordTag: hasVerifiedDiscord(member) ? member.discordTag : null,
    battletag: member.battletag || null,
    battletagVerified: hasVerifiedBattletag(member),
  };
}

/**
 * Choisit les joueurs d'une équipe à présenter dans la modale de lancement.
 *
 * Priorité : capitaine, manager, propriétaire, puis un joueur — mais un joueur
 * dont le tag Discord **ou** le BattleTag est vérifié passe devant tous ceux qui
 * n'ont rien de vérifié, quel que soit leur rôle.
 *
 * Si le premier choisi n'a qu'**une** des deux vérifications, on cherche un
 * second joueur qui porte l'autre, pour avoir à la fois le contact (Discord) et
 * le profil de jeu (BattleTag). À défaut de toute vérification dans le roster,
 * le premier par rôle est présenté avec ce qu'il a de non vérifié — son
 * BattleTag seulement : un tag Discord non certifié ne sort jamais (règle de
 * `canViewDiscordTag`).
 */
export function pickLaunchContacts(members: readonly ContactCandidate[]): LaunchContact[] {
  if (members.length === 0) return [];
  const sorted = [...members].sort(compareCandidates);
  const primary = sorted[0];
  const contacts = [toContact(primary)];

  const discord = hasVerifiedDiscord(primary);
  const battletag = hasVerifiedBattletag(primary);
  if (discord === battletag) return contacts;

  const missing = discord ? hasVerifiedBattletag : hasVerifiedDiscord;
  const secondary = sorted.slice(1).find(missing);
  if (secondary) contacts.push(toContact(secondary));
  return contacts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ce que la modale reçoit
// ─────────────────────────────────────────────────────────────────────────────

export type LaunchSide = {
  teamId: number;
  name: string;
  logoUrl: string | null;
  isGhost: boolean;
  /** Entrée solo : l'engagé est un joueur, pas une équipe. */
  isSolo: boolean;
  ready: boolean;
  /** Vide pour une fantôme, et tant que le match n'est pas en lancement. */
  contacts: LaunchContact[];
};

export type LaunchCaster = {
  userId: number;
  pseudo: string;
  discordTag: string | null;
  battletag: string | null;
  /** `true` si le BattleTag vient d'un compte Battle.net rattaché. */
  battletagVerified: boolean;
  ready: boolean;
};

export type LaunchViewerRole = "TEAM1" | "TEAM2" | "CASTER";

export type MatchLaunchInfo = {
  matchId: number;
  tournamentId: number;
  tournamentName: string;
  phase: MatchLaunchPhase;
  startAt: string | null;
  lobbyOpenedAt: string | null;
  autoLaunchAt: string | null;
  launchedAt: string | null;
  hostTeamId: number | null;
  team1: LaunchSide;
  team2: LaunchSide;
  caster: LaunchCaster | null;
  viewer: {
    role: LaunchViewerRole;
    /** Le lecteur peut-il cliquer « Prêt » pour sa partie ? */
    canDeclareReady: boolean;
    /** Sa partie est-elle déjà déclarée prête ? */
    ready: boolean;
  };
};

/**
 * Doit-on ouvrir la modale d'office pour ce match ? Au lancement, pour appeler
 * les « Prêt » ; puis une fois lancé, pour l'annoncer. Clé par phase : fermer la
 * modale du lancement ne fait pas taire l'annonce du départ.
 */
export function launchModalKey(info: Pick<MatchLaunchInfo, "matchId" | "phase">): string {
  return `${info.matchId}:${info.phase}`;
}

export const LAUNCH_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  MATCH_NOT_FOUND: "Match introuvable.",
  MATCH_NOT_IN_LOBBY: "Ce match n'est pas en lancement.",
  MATCH_NOT_LAUNCHABLE: "Ce match ne peut pas être lancé : ses deux engagées ne sont pas connues ou il est terminé.",
  MATCH_ALREADY_LAUNCHED: "Ce match est déjà lancé.",
  MATCH_NOT_LAUNCHED: "Le match n'est pas encore lancé : toutes les parties doivent se déclarer prêtes.",
  NOT_MATCH_PARTY: "Tu ne joues ni ne castes ce match.",
  NOT_TEAM_READY_ROLE: "Seul le capitaine, un manager ou le propriétaire peut déclarer l'équipe prête.",
  NOT_CASTER: "Caster un match demande le rôle caster.",
  CASTER_IDENTITY_REQUIRED: CAST_IDENTITY_NOTICE,
  CASTER_IS_PLAYER: "Tu joues ce match : tu ne peux pas le caster.",
  MATCH_ALREADY_CASTED: "Ce match a déjà un caster.",
  MATCH_ALREADY_COMPLETED: "Ce match est terminé.",
  NOT_MATCH_CASTER: "Tu ne castes pas ce match.",
  INVALID_HOST_TEAM: "L'équipe hôte doit être l'une des deux engagées du match.",
  TOURNAMENT_NOT_RUNNING: "Le tournoi n'est pas en cours.",
};

/** Message français d'un refus du lancement. */
export function launchErrorMessage(code: string | null | undefined): string {
  return (code && LAUNCH_ERROR_MESSAGES[code]) || "L'action n'a pas pu aboutir. Réessaie dans un instant.";
}

/**
 * Événement de fenêtre qui ouvre la modale de lancement sur un match
 * (`detail.matchId`) depuis n'importe quel écran — la carte d'un match sur la
 * fiche du tournoi, par exemple. La modale vit dans la mise en page racine :
 * un événement évite de faire descendre un contexte à travers tout le site.
 */
export const MATCH_LAUNCH_OPEN_EVENT = "bg:match-launch-open";

/** Invite la modale globale à se rafraîchir (après un « Prêt » posé ailleurs). */
export const MATCH_LAUNCH_REFRESH_EVENT = "bg:match-launch-refresh";
