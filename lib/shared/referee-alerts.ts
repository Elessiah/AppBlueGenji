/**
 * Tri des évènements du site entre le **journal complet** et le **canal
 * arbitre**, et rédaction des alertes de ce second canal.
 *
 * Le journal (`lib/shared/bot-logs.ts`) reçoit une ligne par fait accompli :
 * son volume est de l'ordre du nombre de matchs d'un tournoi. C'est ce qu'on
 * attend d'un journal, et c'est bien trop pour un arbitre — qui suit dix
 * plateaux depuis son téléphone et n'a pas à faire défiler quarante fins de
 * manche pour trouver la seule qui l'attend.
 *
 * D'où un second canal, alimenté par le même moteur mais avec un **critère
 * unique** :
 *
 * > **Un arbitre doit-il faire quelque chose en lisant cette ligne ?**
 *
 * Si la réponse est non, la ligne reste au journal. Une inscription, un coup
 * d'envoi, une fin de manche ordinaire, une clôture : ce sont des faits à
 * suivre, pas des tâches. Un désaccord de score, en revanche, immobilise une
 * rencontre jusqu'à ce qu'un humain tranche — personne d'autre que l'arbitre ne
 * peut la débloquer, et rien ne se débloquera tout seul.
 *
 * ## Ce qui alerte l'arbitre
 *
 * | Évènement | Ce que l'arbitre a à faire |
 * | --- | --- |
 * | Conflit de score | Trancher : les deux engagées annoncent des scores contradictoires. |
 * | Report expiré non tranché | Trancher, en retard : le délai est passé et la rencontre est toujours bloquée. |
 * | Signalement d'un problème | Répondre à un engagé qui appelle à l'aide (`lib/server/tournaments/issue-reports.ts`). |
 *
 * ## Ce qui reste au journal, et pourquoi
 *
 * - **Création, inscription, coup d'envoi, clôture** — des faits d'organisation.
 *   Rien à arbitrer ; les lire est utile, les recevoir en message privé ne
 *   l'est pas.
 * - **Fin de match ordinaire** — c'est justement le cas où *personne* n'a eu à
 *   intervenir : les deux engagées se sont accordées, ou le délai a tranché.
 *   C'est aussi l'évènement le plus nombreux : l'y router ferait du canal
 *   arbitre une copie du journal, et le bot démarcherait tous les membres du
 *   rôle à chaque manche.
 * - **Abandon** — le moteur le traite seul (rejeu du classement, réappariement).
 * - **Clôture faute d'adversaires** — un incident d'organisation, constaté après
 *   coup : rien à faire le soir même, et la ligne du journal suffit à en parler.
 * - **Suppression d'un tournoi** — un geste d'administrateur déjà accompli.
 *
 * ## Une seule règle, un seul transport
 *
 * `BOT_EVENT_CHANNELS` est un `Record` **exhaustif** : ajouter un évènement au
 * journal sans le classer ne compile pas. Le tri ne se répète donc nulle part
 * chez les appelants — le moteur réserve un évènement, la file décide de son
 * canal au moment de l'envoi.
 *
 * Et chaque évènement part par **exactement un** transport. C'est ce qui
 * interdit le doublon : le point d'entrée arbitre du bot
 * (`POST /internal/notify/referees`) écrit **déjà** dans le canal de logs en
 * plus des messages privés — router un conflit par les deux chemins le ferait
 * apparaître deux fois dans le même salon.
 *
 * ## Pourquoi ces messages sont courts
 *
 * Une alerte se lit sur un écran de téléphone, en pleine soirée. Elle tient
 * donc sur **une ligne** — comme les lignes du journal — et se limite à ce qui
 * permet d'agir : la nature de l'intervention en tête, le tournoi, la manche,
 * les deux engagées, l'identifiant du match, le lien vers la page. Pas de
 * score, pas d'effectif, pas d'historique : tout cela se lit sur la page, et
 * l'arbitre va devoir l'ouvrir de toute façon.
 *
 * Le rôle arbitre est **nommé** (« Arbitrage requis »), pas mentionné au sens
 * Discord (`<@&id>`) : le site ne connaît pas l'identifiant du rôle, qui se
 * configure serveur par serveur côté bot (`/set-referee-role`) et peut différer
 * de l'un à l'autre. C'est le bot qui résout le rôle et écrit à ses membres.
 *
 * Module pur (`lib/shared`) : aucune base, aucun réseau. Le déclenchement et la
 * résolution des noms vivent dans `lib/server/tournaments/bot-logs.ts`.
 */
import type { BotEventKind, BotLogTournament } from "./bot-logs";
import { matchRoundLabel } from "./discord-notifications";

/**
 * Canal de destination d'un évènement.
 *
 * - `JOURNAL` — le canal de logs, par `POST /internal/log`.
 * - `REFEREE` — le canal arbitre, par `POST /internal/notify/referees` : messages
 *   privés aux membres du rôle arbitre **et** trace dans le canal de logs, que
 *   le bot pose lui-même.
 */
export type BotEventChannel = "JOURNAL" | "REFEREE";

/**
 * Le tri, en une table.
 *
 * Exhaustive par construction (`Record<BotEventKind, …>`) : un évènement ajouté
 * demain au journal ne compile pas tant qu'on n'a pas répondu, pour lui, à la
 * question « un arbitre doit-il faire quelque chose en le lisant ? ».
 */
export const BOT_EVENT_CHANNELS: Record<BotEventKind, BotEventChannel> = {
  tournament_created: "JOURNAL",
  registration: "JOURNAL",
  forfeit: "JOURNAL",
  match_finished: "JOURNAL",
  tournament_started: "JOURNAL",
  tournament_finished: "JOURNAL",
  tournament_underfilled: "JOURNAL",
  score_conflict: "REFEREE",
  score_report_stalled: "REFEREE",
};

/**
 * Canal d'un évènement.
 *
 * @param kind Nature de l'évènement.
 * @returns `JOURNAL` ou `REFEREE`.
 */
export function botEventChannel(kind: BotEventKind): BotEventChannel {
  return BOT_EVENT_CHANNELS[kind];
}

/** `true` si l'évènement appelle une intervention humaine. */
export function isRefereeAlert(kind: BotEventKind): boolean {
  return botEventChannel(kind) === "REFEREE";
}

/** Ce qu'une alerte doit dire de la rencontre bloquée. */
export interface RefereeAlertContext {
  tournament: BotLogTournament;
  /** Page publique du tournoi, `null` si `APP_URL` n'est pas réglée. */
  tournamentUrl: string | null;
  matchId: number;
  bracket: string;
  roundNumber: number;
  team1Name: string;
  team2Name: string;
}

/**
 * Corps commun des alertes : nature, tournoi, manche, affiche, lien.
 *
 * Une seule fonction pour les deux alertes, et pas deux rédactions parallèles :
 * elles désignent la même rencontre au même arbitre, et deux formulations
 * rendraient l'escalade plus difficile à rapprocher du conflit qui l'a
 * précédée.
 *
 * @param emoji Pictogramme de tête, distinct par nature d'alerte.
 * @param reason Ce qui bloque, en quelques mots.
 * @param context La rencontre concernée.
 */
function alertLine(emoji: string, reason: string, context: RefereeAlertContext): string {
  const round = matchRoundLabel(context.bracket, context.roundNumber);
  const line =
    `${emoji} Arbitrage requis — « ${context.tournament.name} » (#${context.tournament.id})` +
    ` · ${round} : ${context.team1Name} vs ${context.team2Name} (match #${context.matchId})` +
    ` — ${reason}.`;
  return context.tournamentUrl ? `${line} ${context.tournamentUrl}` : line;
}

/**
 * Alerte : les deux engagées annoncent des scores contradictoires.
 *
 * La rencontre est immobilisée dès cet instant — le moteur ne peut pas départager
 * deux reports qui se contredisent, et le délai de report ne la débloquera pas
 * non plus (il ne tranche que les matchs à un seul report).
 */
export function formatScoreConflictAlert(context: RefereeAlertContext): string {
  return alertLine("⚠️", "reports de score contradictoires", context);
}

/**
 * Alerte : le désaccord dure, et personne ne l'a tranché.
 *
 * Escalade du conflit, pas un doublon : le premier message part au moment du
 * désaccord, celui-ci constate que le délai s'est écoulé depuis sans qu'un
 * arbitre s'en saisisse. Un canal chargé un soir de tournoi avale la première
 * alerte ; la seconde arrive quand le match est vraiment en souffrance.
 *
 * Le compte part de l'**expiration du délai de report**, jalon que le moteur ne
 * réécrit jamais tant que la manche n'est pas tranchée — les horodatages de
 * report, eux, se repoussent à chaque saisie, et une engagée qui resaisirait son
 * score en boucle repousserait indéfiniment sa propre escalade. D'où « plus de
 * N minutes », une borne basse : la seule chose que le message puisse promettre
 * sans mentir.
 *
 * @param context La rencontre concernée.
 * @param minutesElapsed Délai écoulé depuis l'expiration, au minimum, en minutes.
 */
export function formatStalledScoreReportAlert(
  context: RefereeAlertContext,
  minutesElapsed: number,
): string {
  return alertLine(
    "⏱️",
    `délai de report dépassé depuis plus de ${minutesElapsed} minutes, toujours pas tranché`,
    context,
  );
}
