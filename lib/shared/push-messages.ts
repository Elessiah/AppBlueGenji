/**
 * Ce que dit chaque notification push — un rédacteur par sujet de
 * `PUSH_TOPICS`.
 *
 * Une notification push n'est pas un message Discord raccourci : elle s'affiche
 * sur un écran verrouillé, en deux lignes, parfois sous les yeux d'un autre. Les
 * règles sont donc les mêmes partout :
 *
 * - le **titre** dit l'évènement, le **corps** ce qu'il faut faire ou savoir ;
 * - **aucun pseudo de joueur**, même règle que les journaux Discord
 *   (`lib/shared/log-privacy.ts`) : les noms d'équipe restent, ils sont publics ;
 * - le **lien** est un chemin du site, qui ouvre la page où agir.
 *
 * Module pur : chaque rédacteur se teste sans réseau.
 */
import { formatMatchStart } from "./discord-notifications";
import { tournamentMatchHref } from "./match-anchor";
import { REPORT_CATEGORY_DEFINITIONS, reportConcernedHref, type ReportCategory } from "./content-reports";
import type { PushContent } from "./push-notifications";

type MatchSide = {
  tournamentId: number;
  tournamentName: string;
  matchId: number;
  teamName: string;
  opponentName: string;
  /**
   * Tournoi individuel : le nom d'un engagé y **est** le pseudo d'un joueur.
   * La notification dit alors « ton match », sans nommer personne — elle
   * s'affiche sur un écran verrouillé, et la règle ne connaît pas d'exception.
   */
  solo?: boolean;
};

/** « Renards contre Nova », ou « Ton match » quand les engagés sont des joueurs. */
function pairing(side: MatchSide): string {
  return side.solo ? "Ton match" : `${side.teamName} contre ${side.opponentName}`;
}

/** Étiquette d'un match : les notifications d'un même match se remplacent. */
function matchTag(matchId: number): string {
  return `rencontre-${matchId}`;
}

/**
 * Départ d'un match : il entre en lancement (`LOBBY`, les « Prêt » sont
 * attendus) ou il vient d'être lancé sans être passé par là (lancement forcé
 * par l'arbitrage). Même étiquette pour les deux : l'annonce du départ
 * remplace l'appel aux « Prêt » au lieu de s'y empiler.
 */
export function matchStartPush(side: MatchSide, phase: "LOBBY" | "LAUNCHED"): PushContent {
  return {
    title: phase === "LOBBY" ? "Ton match commence" : "Ton match est lancé",
    body:
      `${pairing(side)} · ${side.tournamentName}. ` +
      (phase === "LOBBY" ? "Déclare-toi prêt." : "Bonne partie !"),
    url: tournamentMatchHref(side.tournamentId, side.matchId),
    tag: matchTag(side.matchId),
  };
}

/** Rappel d'un match programmé (`offsetLabel` : « une semaine », « 1 h »…), ou annonce de son horaire. */
export function matchReminderPush(
  side: MatchSide & { roundLabel: string; startAt: string | Date },
  offsetLabel: string | null,
): PushContent {
  return {
    title: offsetLabel ? `Match dans ${offsetLabel}` : "Match programmé",
    body: `${pairing(side)} · ${side.tournamentName}, ${side.roundLabel}. Coup d'envoi ${formatMatchStart(side.startAt)} (heure de Paris).`,
    url: tournamentMatchHref(side.tournamentId, side.matchId),
    tag: `${matchTag(side.matchId)}-reminder`,
  };
}

/** L'adversaire a saisi un score : à confirmer, ou à contester. */
export function scoreToConfirmPush(side: MatchSide): PushContent {
  return {
    title: "Score à confirmer",
    body: `${side.solo ? "Ton adversaire" : side.opponentName} a saisi le score de votre match (${side.tournamentName}). Confirme-le, ou conteste-le.`,
    url: tournamentMatchHref(side.tournamentId, side.matchId),
    tag: `${matchTag(side.matchId)}-score`,
  };
}

/** Un tournoi où l'équipe du joueur est engagée vient d'être lancé. */
export function tournamentStartPush(input: { tournamentId: number; tournamentName: string }): PushContent {
  return {
    title: "Le tournoi commence",
    body: `${input.tournamentName} est lancé. Retrouve ton premier match sur la page du tournoi.`,
    url: `/tournois/${input.tournamentId}`,
    tag: `tournament-${input.tournamentId}-start`,
  };
}

/** Un joueur demande à rejoindre une équipe que le destinataire gère. */
export function teamJoinRequestPush(input: { teamId: number; teamName: string }): PushContent {
  return {
    title: "Demande d'adhésion",
    body: `Un joueur demande à rejoindre ${input.teamName}. Réponds depuis la fiche de l'équipe.`,
    url: `/equipes/${input.teamId}`,
    tag: `team-${input.teamId}-join`,
  };
}

/** Un signalement vise le destinataire ou son équipe. */
export function contentReportPush(input: { reportId: number; category: ReportCategory }): PushContent {
  return {
    title: "Un signalement te concerne",
    body: `Signalement (${REPORT_CATEGORY_DEFINITIONS[input.category].label}) : aucune décision n'est prise. Consulte-le et conteste-le s'il est infondé.`,
    url: reportConcernedHref(input.reportId),
    tag: `report-${input.reportId}`,
  };
}

export type ModerationPushKind = "HIDDEN" | "REMOVED" | "RESTORED";

/**
 * Décision de modération sur une image : le logo d'une équipe (`teamName`) ou
 * l'avatar du destinataire (`teamName` absent). Le lien mène au signalement
 * quand il y en a un — c'est là qu'on conteste.
 */
export function moderationPush(input: {
  kind: ModerationPushKind;
  teamName?: string | null;
  teamId?: number | null;
  reportId: number | null;
}): PushContent {
  const subject = input.teamName ? `Le logo de ${input.teamName}` : "Ton avatar";
  const verb = { HIDDEN: "a été masqué", REMOVED: "a été supprimé", RESTORED: "a été rétabli" }[input.kind];
  const next =
    input.kind === "RESTORED"
      ? "La contestation a été acceptée."
      : input.reportId !== null
        ? "Tu peux contester la décision."
        : "Écris à l'association si tu en détiens les droits.";
  const fallback = input.teamId ? `/equipes/${input.teamId}` : "/profil";
  return {
    title: "Décision de modération",
    body: `${subject} ${verb}. ${next}`,
    url: input.reportId !== null ? reportConcernedHref(input.reportId) : fallback,
    tag: input.teamId ? `moderation-team-${input.teamId}` : "moderation-avatar",
  };
}

/** Des changements du traitement des données sont à lire — une information, aucun accord n'est demandé. */
export function privacyChangePush(titles: readonly string[]): PushContent {
  const first = titles[0] ?? "Traitement de tes données";
  const more = titles.length > 1 ? ` (et ${titles.length - 1} autre${titles.length > 2 ? "s" : ""})` : "";
  return {
    title: "Tes données : ce qui change",
    body: `${first}${more}. Le détail t'attend à ta prochaine visite.`,
    url: "/rgpd",
    tag: "privacy-change",
  };
}

/**
 * Alerte d'arbitrage. Le texte Discord porte déjà l'essentiel en une ligne ; le
 * push en reprend la phrase, sans la mise en forme Markdown qu'une
 * notification afficherait telle quelle.
 */
export function refereeAlertPush(message: string, key: string): PushContent {
  // Le lien du tournoi est dans la ligne (URL absolue) : c'est là qu'on
  // arbitre. `buildPushPayload` le ramène à un chemin du site.
  const url = message.match(/https?:\/\/\S+/)?.[0] ?? "/tournois";
  return {
    title: "Arbitrage requis",
    body: stripMarkdown(message),
    url,
    // Une étiquette **par alerte** (nature et manche) : deux conflits d'un même
    // tournoi ne se remplacent pas, et une même alerte renvoyée après un échec
    // du bot remplace la précédente sans resonner.
    tag: `referee-${key}`,
  };
}

/** Nouveau signalement, ou contestation, reçu par la modération. */
export function staffReportPush(input: { reportId: number; contest: boolean }): PushContent {
  return {
    title: input.contest ? "Contestation reçue" : "Nouveau signalement",
    body: input.contest
      ? "Une décision de modération est contestée."
      : "Un signalement attend la modération.",
    url: `/admin/signalements`,
    tag: `staff-report-${input.reportId}`,
  };
}

/** Retire gras, italique, liens nus et chevrons de mention d'un texte Discord. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_`~>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
