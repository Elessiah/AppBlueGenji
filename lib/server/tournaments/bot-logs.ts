/**
 * Déclenchement du journal Discord : quoi journaliser, et quand l'envoyer.
 *
 * La rédaction vit dans le module pur `lib/shared/bot-logs.ts`. Ici, deux
 * problèmes bien concrets, que chaque appelant résoudrait sinon à sa façon :
 *
 * **1. Ne rien annoncer qui n'ait été écrit.** Les évènements naissent au cœur
 * d'une transaction (l'inscription s'insère, le match se clôt, le tournoi passe
 * « en cours »), et une transaction peut encore échouer après coup. On y
 * *réserve* donc une ligne — {@link queueBotLog} — que seul un commit convertit
 * en message ({@link flushBotLogs}), un échec la jetant avec le reste
 * ({@link discardBotLogs}). Un tournoi n'est jamais annoncé lancé par une
 * transaction qui a fini par rendre la main sur une erreur.
 *
 * **2. Ne pas faire porter la rédaction au moteur.** Une entrée en attente n'est
 * qu'un *renvoi* — « le match 42 s'est terminé » —, jamais un texte : les noms,
 * l'effectif et la championne sont relus **après** le commit, sur le pool. Le
 * moteur n'a donc aucun `JOIN` d'affichage à traîner sur ses chemins chauds, et
 * la ligne parle de l'état réellement enregistré (le classement final n'est
 * écrit qu'après la clôture, par exemple).
 *
 * **3. Choisir le canal une seule fois.** Tous les évènements ne vont pas au
 * même endroit : ceux qui appellent une intervention humaine partent au canal
 * arbitre (`POST /internal/notify/referees` : messages privés au rôle configuré
 * par `/set-referee-role`, plus une trace que le bot pose lui-même dans le canal
 * de logs), les autres au journal (`POST /internal/log`). Le tri est une règle
 * pure et unique — `lib/shared/referee-alerts.ts` — appliquée ici, à l'envoi :
 * aucun appelant ne le connaît, et un évènement ajouté demain est classé sans
 * qu'on touche au moteur. Chaque entrée part par **exactement un** transport,
 * ce qui interdit le doublon : le point d'entrée arbitre écrivant déjà dans le
 * canal de logs, l'y envoyer aussi par `sendBotLog` afficherait la ligne deux
 * fois dans le même salon.
 *
 * L'envoi lui-même reste au meilleur effort, comme tout ce qui passe par le
 * canal interne : ni la lecture ni l'écriture ne doivent échouer parce que le
 * bot dort. Un rôle arbitre non configuré n'y change rien — le bot répond 200
 * et se contente du log.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { isBotCircuitOpen, pushRefereeAlert, sendBotLog } from "@/lib/server/bot-integration";
import { getDatabase } from "@/lib/server/database";
import { isTransactionAborted } from "@/lib/server/mysql-errors";
import {
  formatForfeitLog,
  formatMatchResultLog,
  formatRegistrationLog,
  formatTournamentCreatedLog,
  formatTournamentFinishedLog,
  formatTournamentStartedLog,
  formatUnderfilledTournamentLog,
  type BotEventKind,
} from "@/lib/shared/bot-logs";
import { SCORE_REPORT_TIMEOUT_MINUTES } from "@/lib/shared/constants";
import { toParticipantType } from "@/lib/shared/participants";
import {
  botEventChannel,
  formatScoreConflictAlert,
  formatStalledScoreReportAlert,
  type BotEventChannel,
  type RefereeAlertContext,
} from "@/lib/shared/referee-alerts";
import { tournamentPageUrl } from "./app-url";

/**
 * Évènement réservé pendant une transaction.
 *
 * Rien qu'un renvoi vers une ligne de la base : la résolution des noms est
 * faite après le commit (voir l'en-tête du module).
 */
export type PendingBotLog =
  | { kind: "tournament_created"; tournamentId: number }
  | { kind: "registration"; tournamentId: number; teamId: number; byStaff: boolean }
  | { kind: "forfeit"; tournamentId: number; teamId: number }
  | { kind: "match_finished"; matchId: number }
  | { kind: "score_conflict"; matchId: number; claimId?: number }
  | { kind: "score_report_stalled"; matchId: number; claimId?: number }
  | { kind: "tournament_started"; tournamentId: number }
  | { kind: "tournament_finished"; tournamentId: number }
  | { kind: "tournament_underfilled"; tournamentId: number };

/**
 * Garde de compilation : les natures d'entrée sont **exactement** celles que le
 * tri connaît (`BotEventKind`). Une entrée inventée ici sans être classée dans
 * `lib/shared/referee-alerts.ts` — ou l'inverse — ne compile pas, et le canal
 * d'un nouvel évènement ne peut donc pas rester indécis.
 */
type AssertSameKinds = [
  PendingBotLog["kind"] extends BotEventKind ? true : never,
  BotEventKind extends PendingBotLog["kind"] ? true : never,
];
const KINDS_MATCH: AssertSameKinds = [true, true];
void KINDS_MATCH;

/**
 * Une ligne prête à partir, le canal qui doit la porter, et l'entrée dont elle
 * vient.
 *
 * L'entrée voyage jusqu'au transport parce qu'un envoi qui échoue peut avoir à
 * **défaire** ce que sa mise en file avait réservé (voir `flushBotLogs`).
 */
export interface ResolvedBotLog {
  entry: PendingBotLog;
  channel: BotEventChannel;
  message: string;
}

/**
 * Clés de réservation des alertes arbitre, par nature d'évènement.
 *
 * Déclarées ici, où vit `claimRefereeAlert`, parce que trois endroits doivent
 * les connaître : le moteur, qui réserve avant de mettre en file ;
 * `flushBotLogs`, qui rend la réservation si l'alerte n'est pas partie ; et
 * `finalizeMatch`, qui les efface toutes quand la manche est enfin tranchée.
 *
 * **Les deux alertes arbitre sont réservées**, pas seulement l'escalade. Le
 * conflit de score naît d'une écriture, mais rien n'interdit de la refaire :
 * tant que la manche n'est pas tranchée, les deux engagées peuvent resaisir
 * leur score autant de fois qu'elles veulent, et chaque désaccord ferait sonner
 * le téléphone de tous les arbitres. Une ligne de journal supportait cette
 * répétition ; un message privé, non.
 */
export const CONFLICT_ALERT_KEY = "SCORE_CONFLICT";

/** Clé de réservation de l'escalade « délai dépassé, toujours pas tranché ». */
export const STALLED_ALERT_KEY = "SCORE_REPORT_STALLED";

/**
 * Les entrées qui réservent une alerte arbitre.
 *
 * `queueRefereeAlert` ne prend qu'elles : une entrée de journal n'a pas de
 * réservation à porter, et le type l'empêche d'y entrer par distraction.
 */
export type RefereeAlertEntry = Extract<
  PendingBotLog,
  { kind: "score_conflict" | "score_report_stalled" }
>;

/**
 * Clé de réservation d'un évènement, ou `null` s'il n'en réserve aucune.
 *
 * Une seule fonction pour tout le module : c'est elle qui garantit que ce que
 * le moteur réserve est exactement ce que le flush sait rendre.
 */
export function refereeAlertKey(entry: PendingBotLog): string | null {
  switch (entry.kind) {
    case "score_conflict":
      return CONFLICT_ALERT_KEY;
    case "score_report_stalled":
      return STALLED_ALERT_KEY;
    default:
      return null;
  }
}

/**
 * Une réservation se retire par **son identifiant de ligne**, jamais par sa
 * paire `(match_id, alert_key)`.
 *
 * La libération peut arriver trente secondes après la réservation — c'est la
 * fenêtre que s'accorde le bot pour lire les membres du rôle —, et un autre
 * balayage a pu, entre-temps, reposer la même paire de clés puis remettre son
 * alerte. Effacer « la réservation de cette manche » emporterait alors celle
 * d'un autre, qui, lui, avait bel et bien alerté.
 */
const RELEASE_ALERT_SQL = `DELETE FROM bg_referee_alerts WHERE id = ?`;

/**
 * Plafond d'entrées retenues par transaction.
 *
 * Une transaction ordinaire en produit une ou deux ; les rares qui en produisent
 * plus (le dernier match d'un tournoi : fin de match **et** clôture) restent loin
 * du compte. Le plafond vise l'autre cas : le `seed`, qui rejoue des milliers de
 * matchs sur une même connexion sans jamais vider la file. Il borne l'empreinte
 * mémoire sans rien changer au fonctionnement nominal.
 */
export const MAX_PENDING_PER_TRANSACTION = 32;

/**
 * Files en attente, indexées par connexion.
 *
 * Une `WeakMap` : la file suit la transaction sans que le module ait à connaître
 * son cycle de vie, et une connexion oubliée n'empêche pas sa file d'être
 * collectée.
 */
const pending = new WeakMap<PoolConnection, PendingBotLog[]>();

/**
 * Manches tranchées par la transaction en cours, dont les réservations d'alerte
 * seront à effacer après le commit.
 *
 * Un **ensemble à part**, et non la trace `match_finished` de la file : celle-ci
 * est plafonnée, et un balayage chargé l'abandonne (`queueBotLog` rend alors
 * `false`). Perdre une ligne de journal ne coûte qu'une ligne d'historique ;
 * perdre le nettoyage laisserait la clé `SCORE_CONFLICT` posée pour la vie du
 * plateau, et plus aucun désaccord né après cet arbitrage n'alerterait
 * quiconque. Le ménage n'a pas à dépendre du sort d'une ligne d'affichage.
 */
const resolvedMatches = new WeakMap<PoolConnection, Set<number>>();

/** Deux entrées identiques dans une même transaction ne font qu'une ligne. */
function entryKey(entry: PendingBotLog): string {
  return JSON.stringify(entry);
}

/**
 * Réserve une ligne de journal, à envoyer si — et seulement si — la transaction
 * en cours aboutit.
 *
 * @returns `true` si l'évènement est retenu (une entrée identique déjà en file
 *          compte comme retenue : elle produira la même ligne), `false` s'il est
 *          **abandonné** parce que la file a atteint son plafond. Un appelant
 *          qui a réservé quelque chose en base avant de mettre en file doit
 *          lire ce retour : sans quoi la réservation serait consommée sans
 *          qu'aucun message ne parte, et jamais rejouée.
 */
export function queueBotLog(connection: PoolConnection, entry: PendingBotLog): boolean {
  const queue = pending.get(connection);
  if (!queue) {
    pending.set(connection, [entry]);
    return true;
  }
  // Le dédoublonnage passe **avant** le plafond : une entrée déjà en file est
  // retenue, elle n'est pas perdue, et l'annoncer perdue ferait rendre une
  // réservation encore utile.
  if (queue.some((existing) => entryKey(existing) === entryKey(entry))) return true;
  if (queue.length >= MAX_PENDING_PER_TRANSACTION) return false;
  queue.push(entry);
  return true;
}

/**
 * Note que la transaction en cours vient de trancher une manche : ses
 * réservations d'alerte seront effacées après le commit.
 *
 * En mémoire et **synchrone** : rien à écrire ici, donc aucun verrou de plus sur
 * le chemin le plus chaud du moteur (`finalizeMatch`). L'effacement suit le
 * commit, sur le pool (`clearRefereeAlertsOnPool`).
 */
export function markMatchResolved(connection: PoolConnection, matchId: number): void {
  const marked = resolvedMatches.get(connection);
  if (marked) marked.add(matchId);
  else resolvedMatches.set(connection, new Set([matchId]));
}

/** Jette les lignes réservées : la transaction n'a pas abouti. */
export function discardBotLogs(connection: PoolConnection): void {
  pending.delete(connection);
  // Les manches notées tranchées ne l'ont pas été : leurs réservations gardent
  // tout leur objet, et le prochain entretien les retrouvera telles quelles.
  resolvedMatches.delete(connection);
}

/**
 * Envoie les lignes réservées par la transaction qui vient d'aboutir.
 *
 * **Sans attendre** : la résolution des noms et l'appel au bot se poursuivent en
 * arrière-plan, pour ne pas ajouter au temps de réponse d'un report de score le
 * délai d'un bot lent. Ne lève jamais.
 *
 * À appeler juste après le commit ; `discardBotLogs` couvre le chemin d'échec.
 */
export function flushBotLogs(connection: PoolConnection): void {
  const queue = pending.get(connection) ?? [];
  pending.delete(connection);
  const settled = resolvedMatches.get(connection) ?? new Set<number>();
  resolvedMatches.delete(connection);
  if (queue.length === 0 && settled.size === 0) return;

  // Une manche dont le désaccord vient d'être annoncé n'a pas besoin de son
  // escalade dans la même seconde : le téléphone de l'arbitre sonne déjà, et
  // deux messages d'affilée ne diraient pas deux choses. La règle est posée
  // **ici**, sur la file entière, et non chez celui qui réserve : les deux
  // évènements peuvent arriver dans un ordre ou dans l'autre selon le passage
  // d'entretien qui les produit, et une garde posée à la réservation ne verrait
  // que l'un des deux ordres.
  //
  // L'escalade passe donc **en dernier**, et ne se tait que si le conflit de sa
  // manche a été *effectivement remis*. Se taire sur la seule présence du
  // conflit dans la file ne suffirait pas : si celui-ci n'était finalement pas
  // remis — bot qui bat de l'aile, manche réappariée entre-temps —, l'arbitre
  // n'aurait rien reçu du tout, et l'escalade aurait gardé une réservation qui
  // l'empêcherait de repartir un jour.
  const escalations = queue.filter((entry) => entry.kind === "score_report_stalled");
  const rest = queue.filter((entry) => entry.kind !== "score_report_stalled");

  void (async () => {
    // Ce qui a été **effectivement remis** aux arbitres, repéré par la clé de
    // l'entrée. Tout le reste — non remis, mais aussi non *résolu* : ligne
    // effacée entre-temps, engagé sans nom, erreur MySQL passagère — doit rendre
    // sa réservation, sans quoi elle serait consommée en silence et aucun
    // passage ultérieur ne réessaierait.
    const delivered = new Set<string>();
    /** Manches dont le désaccord vient d'être annoncé, et remis. */
    const announcedConflicts = new Set<number>();

    /** Envoie une ligne déjà rédigée, et dit si les arbitres l'ont reçue. */
    async function deliver({ entry, channel, message }: ResolvedBotLog): Promise<void> {
      if (channel !== "REFEREE") {
        await sendBotLog(message);
        return;
      }

      // Le coupe-circuit est respecté ici, contrairement au signalement d'un
      // problème : personne n'attend cette réponse, et un bot éteint ferait
      // sinon patienter chaque envoi de fond sur la fenêtre de 30 s que
      // demande la lecture des membres du rôle.
      //
      // « Remis » veut dire *le bot a accepté et posté*, pas *un arbitre a lu*.
      // Le point d'entrée écrit d'abord dans le canal de logs, puis démarche le
      // rôle : un bilan à `sent: 0` — rôle non configuré, messages privés
      // fermés — décrit une trace bel et bien posée, la seule qui soit durable.
      // Rejouer sur ce critère reposterait cette trace à chaque balayage, pour
      // toujours. Seul un `null` (bot injoignable, coupe-circuit ouvert) dit que
      // rien n'est parti.
      let sent = false;
      try {
        sent = (await pushRefereeAlert(message, "referee-alert", { honourCircuit: true })) !== null;
      } catch {
        sent = false;
      }
      if (!sent) return;
      delivered.add(entryKey(entry));
      if (entry.kind === "score_conflict") announcedConflicts.add(entry.matchId);
    }

    for (const resolved of await resolveBotLogs(rest)) await deliver(resolved);

    for (const resolved of await resolveBotLogs(escalations)) {
      // Le téléphone de l'arbitre vient de sonner pour cette manche : un second
      // message dans la même seconde ne dirait pas une seconde chose. La
      // réservation est **gardée** — la rendre ferait repartir l'escalade au
      // balayage suivant, soit le doublon qu'on vient d'éviter ; et si la manche
      // est tranchée, `finalizeMatch` l'effacera de toute façon.
      if (announcedConflicts.has(refereeAlertMatchId(resolved.entry))) {
        delivered.add(entryKey(resolved.entry));
        continue;
      }
      await deliver(resolved);
    }

    // Rendre la réservation choisit le risque du doublon plutôt que celui du
    // silence, et c'est le bon sens du risque pour une alerte qui ne se répète
    // pas d'elle-même : il n'y a pas de palier suivant pour la rattraper.
    for (const entry of queue) {
      if (delivered.has(entryKey(entry))) continue;
      const claimId = refereeAlertClaimId(entry);
      if (claimId === null) continue;
      await releaseRefereeAlertOnPool(claimId);
    }

    // La manche est tranchée : ses réservations n'ont plus d'objet, et un
    // désaccord qui renaîtrait après arbitrage doit pouvoir alerter de nouveau.
    // L'effacement se fait **après le commit**, sur le pool, et non dans la
    // transaction du moteur : `finalizeMatch` est le point de passage de tous
    // les matchs tranchés, et y poser un `DELETE` de plus ferait tenir un verrou
    // de plus sur son chemin le plus chaud — jusqu'à l'interblocage avec le
    // balayage qui, lui, réserve.
    //
    // La liste vient de `markMatchResolved`, jamais des entrées `match_finished`
    // de la file : celle-ci est plafonnée, et une manche tranchée par un
    // balayage chargé perdrait alors son ménage — donc sa clé `SCORE_CONFLICT`,
    // pour toujours. Elle n'est donc pas plafonnée non plus, d'où un effacement
    // **par lots** : un balayage qui tranche deux cents manches doit coûter
    // quelques requêtes, pas deux cents allers-retours au pool.
    await clearRefereeAlertsOnPool(settled);
  })().catch(() => undefined);
}

/**
 * Identifiant de la réservation portée par une entrée, `null` si elle n'en a
 * pas — évènement de journal, ou alerte mise en file sans passer par
 * `queueRefereeAlert`.
 */
function refereeAlertClaimId(entry: PendingBotLog): number | null {
  switch (entry.kind) {
    case "score_conflict":
    case "score_report_stalled":
      return entry.claimId ?? null;
    default:
      return null;
  }
}

/**
 * Manche d'une entrée qui réserve une alerte.
 *
 * Les deux natures concernées portent un `matchId` ; le `switch` est là pour
 * que TypeScript le sache, pas pour trancher quoi que ce soit.
 */
function refereeAlertMatchId(entry: PendingBotLog): number {
  switch (entry.kind) {
    case "score_conflict":
    case "score_report_stalled":
      return entry.matchId;
    default:
      throw new Error("NO_MATCH_ID");
  }
}

/**
 * Une manche a-t-elle **déjà** une réservation sous cette clé ?
 *
 * Lecture cohérente, sans verrou — et c'est tout l'intérêt : le constat qui
 * produit l'escalade se refait à *chaque* entretien, donc à chaque
 * reconstruction d'instantané tant que la manche est bloquée. Réserver de
 * nouveau y serait sans effet (la clé unique le rejette), mais chaque
 * `INSERT IGNORE` prend une intention de verrou sur l'index et consomme un
 * `AUTO_INCREMENT`, dans la transaction du moteur. Un `SELECT` ne fait ni l'un
 * ni l'autre.
 *
 * Ce n'est **pas** la garantie d'unicité : deux transactions simultanées peuvent
 * toutes deux ne rien voir. C'est l'index unique qui tranche cette course, comme
 * avant — cette lecture n'écarte que le cas nominal, celui qui se répète.
 */
async function refereeAlertExists(
  connection: PoolConnection,
  matchId: number,
  alertKey: string,
): Promise<boolean> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT 1 FROM bg_referee_alerts WHERE match_id = ? AND alert_key = ? LIMIT 1`,
    [matchId, alertKey],
  );
  return rows.length > 0;
}

/**
 * Réserve une alerte arbitre pour une manche, **dans la transaction en cours**.
 *
 * Certaines alertes ne naissent pas d'une écriture mais d'un constat répété à
 * chaque passage d'entretien — « ce report a dépassé son délai et personne n'a
 * tranché ». Sans marque, l'arbitre recevrait le même message à chaque lecture
 * de la page. La ligne `bg_referee_alerts (match_id, alert_key)` porte donc une
 * clé unique, et seule l'insertion qui gagne réserve l'envoi.
 *
 * Elle est écrite sur la **connexion de la transaction**, et non sur le pool :
 * la réservation et l'évènement sont ainsi validés ou annulés ensemble — un
 * rollback ne consomme pas l'alerte, contrairement aux rappels de match, dont
 * la réservation précède un envoi hors transaction.
 *
 * La table suit la manche (`ON DELETE CASCADE`) : un plateau régénéré —
 * réappariement d'une ronde suisse, correction de score en survie — efface ses
 * matchs, donc ses réservations.
 *
 * @returns L'identifiant de la ligne réservée (c'est à nous d'alerter), ou
 *          `null` si un autre passage l'a prise. L'identifiant, et non un
 *          booléen : c'est **cette ligne-là** qu'il faudra rendre si l'alerte
 *          ne part pas, et pas celle qu'un autre balayage aura posée depuis.
 */
export async function claimRefereeAlert(
  connection: PoolConnection,
  matchId: number,
  alertKey: string,
): Promise<number | null> {
  const [result] = await connection.execute(
    `INSERT IGNORE INTO bg_referee_alerts (match_id, alert_key) VALUES (?, ?)`,
    [matchId, alertKey],
  );
  const written = result as { affectedRows?: number; insertId?: number };
  return written.affectedRows === 1 ? Number(written.insertId) : null;
}

/**
 * Rend une réservation d'alerte **dans la transaction en cours**.
 *
 * Le pendant de `claimRefereeAlert`, pour le cas où la mise en file échoue
 * après coup : la réservation et son abandon sont alors validés ou annulés
 * ensemble, et le prochain balayage retrouve la manche vierge.
 */
export async function releaseRefereeAlert(
  connection: PoolConnection,
  claimId: number,
): Promise<void> {
  await connection.execute(RELEASE_ALERT_SQL, [claimId]);
}

/**
 * Efface, **après le commit**, les réservations d'une manche tranchée.
 *
 * C'est ce qui rend la réservation du conflit temporaire plutôt que définitive :
 * un désaccord qui renaît après un arbitrage — correction de score sur une
 * archive — doit pouvoir alerter à nouveau. Sans cet effacement, « une alerte
 * par manche » vaudrait pour la vie du plateau.
 *
 * Sur le pool, jamais dans la transaction du moteur : `finalizeMatch` est le
 * point de passage de **tous** les matchs tranchés, et y poser un `DELETE` de
 * plus ferait tenir un verrou de plus jusqu'au commit, sur son chemin le plus
 * chaud — jusqu'à l'interblocage avec le balayage qui, lui, réserve. Meilleur
 * effort : au pire, la manche garde des réservations sans objet.
 *
 * Par **lots**, parce que rien ne borne le nombre de manches qu'une transaction
 * peut trancher : `syncVisibleTournaments` en ouvre une seule pour tous les
 * tournois non terminés, et une manche tranchée n'a le plus souvent aucune
 * réservation à effacer. Une requête par manche ferait payer au pool le prix
 * d'un ménage qui, en régime normal, ne trouve rien.
 */
const CLEAR_ALERTS_CHUNK = 200;

async function clearRefereeAlertsOnPool(matchIds: ReadonlySet<number>): Promise<void> {
  if (matchIds.size === 0) return;
  try {
    const db = await getDatabase();
    const ids = [...matchIds];
    for (let from = 0; from < ids.length; from += CLEAR_ALERTS_CHUNK) {
      const chunk = ids.slice(from, from + CLEAR_ALERTS_CHUNK);
      await db.execute(
        `DELETE FROM bg_referee_alerts WHERE match_id IN (${chunk.map(() => "?").join(", ")})`,
        chunk,
      );
    }
  } catch {
    // Meilleur effort.
  }
}

/**
 * Retire de la file les alertes d'une manche que la transaction vient de
 * trancher.
 *
 * Les deux évènements peuvent naître du même appel : `reportMatchScore` ouvre
 * par `syncTournamentState`, dont l'entretien peut réserver une escalade sur la
 * manche M, puis le report reçu clôt M s'il concorde avec celui de l'adversaire.
 * Sans ce retrait, le commit annoncerait aux arbitres qu'une rencontre
 * `COMPLETED` « n'est toujours pas tranchée ».
 *
 * En mémoire seulement, et **synchrone** : la file vit sur la connexion, c'est
 * elle qui décide de ce qui part, et la nettoyer ne doit rien coûter au moteur.
 * L'effacement en base suit le commit (`clearRefereeAlertsOnPool`).
 */
export function dropQueuedRefereeAlerts(connection: PoolConnection, matchId: number): void {
  const queue = pending.get(connection);
  if (!queue) return;
  const kept = queue.filter(
    (entry) =>
      !(
        (entry.kind === "score_conflict" || entry.kind === "score_report_stalled") &&
        entry.matchId === matchId
      ),
  );
  if (kept.length !== queue.length) pending.set(connection, kept);
}

/**
 * Réserve une alerte arbitre sans jamais faire échouer la transaction qui
 * l'appelle.
 *
 * Une notification est au meilleur effort de bout en bout, et le moteur ne doit
 * pas rendre un 500 sur un report de score parce qu'un `INSERT` d'alerte a
 * heurté un verrou — ou parce que la table manque, la migration de
 * `database.ts` avalant ses erreurs. En cas d'échec on renonce à alerter, ce
 * qui est exactement l'état d'avant cette fonctionnalité.
 *
 * @returns `true` si la réservation est acquise **et** l'entrée mise en file.
 */
export async function queueRefereeAlert(
  connection: PoolConnection,
  entry: RefereeAlertEntry,
): Promise<boolean> {
  const alertKey = refereeAlertKey(entry);
  // Le type d'entrée le garantit ; la lecture ne coûte rien et évite un `!`.
  if (alertKey === null) return queueBotLog(connection, entry);

  // Réserver ce qu'on sait ne pas pouvoir envoyer, puis rendre la réservation,
  // ferait tourner une pompe d'`INSERT`/`DELETE` pendant toute la panne — le
  // constat qui produit l'escalade se refait à chaque lecture de la page. Le
  // coupe-circuit se referme au bout de sa temporisation, et le balayage suivant
  // réservera pour de bon.
  if (isBotCircuitOpen()) return false;

  let claimId: number | null;
  try {
    // Le cas nominal d'une manche bloquée est celui du *retour* : la réservation
    // est déjà posée, et le sera jusqu'à l'arbitrage. On le règle par une
    // lecture, pas par une écriture rejetée.
    if (await refereeAlertExists(connection, entry.matchId, alertKey)) return false;
    claimId = await claimRefereeAlert(connection, entry.matchId, alertKey);
  } catch (error) {
    // Un interblocage n'est pas une écriture manquée : InnoDB vient d'annuler
    // la **transaction entière** de l'appelant. L'avaler laisserait le moteur
    // poursuivre — propager une qualifiée, commiter — sur une transaction
    // défaite, et rendre un 200 pour un report de score qui n'existe plus.
    if (isTransactionAborted(error)) throw error;

    // Tout le reste laisse la transaction debout : la réservation est seulement
    // inaccessible — table absente, verrou dépassé. Le conflit part quand même,
    // **sans marque** : c'est une alerte par report, donc une par action d'un
    // joueur, comme avant que ce canal n'existe. Une escalade, elle, se tait :
    // née d'un constat refait à chaque entretien, elle partirait en boucle.
    return entry.kind === "score_conflict" ? queueBotLog(connection, entry) : false;
  }
  if (claimId === null) return false;

  // La file est plafonnée : un balayage chargé peut abandonner l'entrée. La
  // réservation serait alors consommée sans qu'aucune alerte ne parte, et aucun
  // passage ultérieur ne réessaierait — on la rend.
  if (queueBotLog(connection, { ...entry, claimId })) return true;
  try {
    await releaseRefereeAlert(connection, claimId);
  } catch {
    // Meilleur effort : au pire, cette manche n'aura pas son alerte.
  }
  return false;
}

/**
 * Rend une réservation d'alerte **après le commit**, sur le pool.
 *
 * C'est le chemin de `flushBotLogs` : la transaction est close depuis longtemps
 * quand on apprend que le bot n'a rien reçu. Meilleur effort, comme tout ce
 * chemin — une réservation qu'on n'arrive pas à rendre laisse simplement la
 * manche sans escalade, ce qui est l'état d'avant.
 */
async function releaseRefereeAlertOnPool(claimId: number): Promise<void> {
  try {
    const db = await getDatabase();
    await db.execute(RELEASE_ALERT_SQL, [claimId]);
  } catch {
    // Meilleur effort.
  }
}

/**
 * Traduit des entrées en lignes de journal, en relisant la base.
 *
 * Exporté pour les tests : c'est là que vit tout ce qui peut se tromper de nom,
 * d'effectif ou de championne. Une entrée qui ne se résout pas (match effacé
 * entre-temps, bye, engagé sans nom) est **silencieusement ignorée** — un
 * journal manquant vaut mieux qu'un journal faux, et rien ici ne justifie de
 * remonter une erreur.
 */
export async function resolveBotLogs(
  entries: readonly PendingBotLog[],
): Promise<ResolvedBotLog[]> {
  const messages: ResolvedBotLog[] = [];

  for (const entry of entries) {
    try {
      const message = await resolveOne(entry);
      if (message) messages.push({ entry, channel: botEventChannel(entry.kind), message });
    } catch {
      // Meilleur effort : une ligne perdue n'emporte pas les suivantes.
    }
  }

  return messages;
}

type TournamentLogRow = RowDataPacket & {
  id: number;
  name: string;
  format: string;
  game: string;
  max_teams: number;
  participant_type: string | null;
  start_at: Date | string | null;
  organizer_pseudo: string | null;
  registered_teams: number;
  champion_name: string | null;
};

/**
 * Tout ce qu'une ligne de journal peut avoir à dire d'un tournoi, en une
 * lecture : son identité, son effectif, et sa championne s'il en a une.
 */
async function loadTournament(tournamentId: number): Promise<TournamentLogRow | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<TournamentLogRow[]>(
    `SELECT
        t.id,
        t.name,
        t.format,
        t.game,
        t.max_teams,
        t.participant_type,
        t.start_at,
        u.pseudo AS organizer_pseudo,
        (SELECT COUNT(*) FROM bg_tournament_registrations r WHERE r.tournament_id = t.id)
          AS registered_teams,
        (SELECT c.name
           FROM bg_tournament_registrations w
           JOIN bg_teams c ON c.id = w.team_id
          WHERE w.tournament_id = t.id AND w.final_rank = 1
          LIMIT 1) AS champion_name
       FROM bg_tournaments t
       LEFT JOIN bg_users u ON u.id = t.organizer_user_id
      WHERE t.id = ?
      LIMIT 1`,
    [tournamentId],
  );
  return rows[0] ?? null;
}

async function loadEntrantName(teamId: number): Promise<string | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { name: string })[]>(
    `SELECT name FROM bg_teams WHERE id = ? LIMIT 1`,
    [teamId],
  );
  return rows[0]?.name ?? null;
}

type MatchLogRow = RowDataPacket & {
  id: number;
  bracket: string;
  round_number: number;
  team1_score: number | null;
  team2_score: number | null;
  forfeit_team_id: number | null;
  is_bye: number | null;
  team1_name: string | null;
  team2_name: string | null;
  tournament_id: number;
  tournament_name: string;
};

async function loadMatch(matchId: number): Promise<MatchLogRow | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<MatchLogRow[]>(
    `SELECT
        m.id,
        m.bracket,
        m.round_number,
        m.team1_score,
        m.team2_score,
        m.forfeit_team_id,
        m.is_bye,
        t1.name AS team1_name,
        t2.name AS team2_name,
        tr.id AS tournament_id,
        tr.name AS tournament_name
       FROM bg_matches m
       JOIN bg_tournaments tr ON tr.id = m.tournament_id
       LEFT JOIN bg_teams t1 ON t1.id = m.team1_id
       LEFT JOIN bg_teams t2 ON t2.id = m.team2_id
      WHERE m.id = ?
      LIMIT 1`,
    [matchId],
  );
  return rows[0] ?? null;
}

/**
 * Ce qu'une alerte arbitre a besoin de savoir d'une rencontre bloquée.
 *
 * Une manche dont un adversaire manque n'a pas d'alerte à produire : il n'y a
 * rien à arbitrer entre une équipe et une case vide, et le message ne saurait
 * pas quoi nommer.
 */
async function loadRefereeAlertContext(matchId: number): Promise<RefereeAlertContext | null> {
  const match = await loadMatch(matchId);
  if (!match || !match.team1_name || !match.team2_name) return null;
  return {
    tournament: { id: Number(match.tournament_id), name: match.tournament_name },
    tournamentUrl: tournamentPageUrl(Number(match.tournament_id)),
    matchId: Number(match.id),
    bracket: String(match.bracket),
    roundNumber: Number(match.round_number),
    team1Name: match.team1_name,
    team2Name: match.team2_name,
  };
}

async function resolveOne(entry: PendingBotLog): Promise<string | null> {
  switch (entry.kind) {
    case "tournament_created": {
      const tournament = await loadTournament(entry.tournamentId);
      if (!tournament) return null;
      return formatTournamentCreatedLog({
        tournament: { id: Number(tournament.id), name: tournament.name },
        format: tournament.format,
        game: tournament.game,
        maxTeams: Number(tournament.max_teams),
        participantType: toParticipantType(tournament.participant_type),
        organizerPseudo: tournament.organizer_pseudo ?? "le staff",
        startAt: tournament.start_at,
      });
    }

    case "registration": {
      const [tournament, entrantName] = await Promise.all([
        loadTournament(entry.tournamentId),
        loadEntrantName(entry.teamId),
      ]);
      if (!tournament || !entrantName) return null;
      return formatRegistrationLog({
        tournament: { id: Number(tournament.id), name: tournament.name },
        entrantName,
        registeredTeams: Number(tournament.registered_teams),
        maxTeams: Number(tournament.max_teams),
        participantType: toParticipantType(tournament.participant_type),
        byStaff: entry.byStaff,
      });
    }

    case "forfeit": {
      const [tournament, entrantName] = await Promise.all([
        loadTournament(entry.tournamentId),
        loadEntrantName(entry.teamId),
      ]);
      if (!tournament || !entrantName) return null;
      return formatForfeitLog({
        tournament: { id: Number(tournament.id), name: tournament.name },
        entrantName,
      });
    }

    case "match_finished": {
      const match = await loadMatch(entry.matchId);
      // Un bye ou un match fantôme porte un score posé par le moteur, pas saisi
      // par une équipe : il n'a rien à raconter (et il y en a autant que
      // d'effectifs impairs).
      if (!match || Number(match.is_bye ?? 0) === 1) return null;
      if (!match.team1_name || !match.team2_name) return null;
      // Un forfait arbitré ne porte aucun score : c'est le seul cas où leur
      // absence décrit un match bel et bien tranché.
      const forfeit = match.forfeit_team_id !== null;
      if (!forfeit && (match.team1_score === null || match.team2_score === null)) return null;
      return formatMatchResultLog({
        tournament: { id: Number(match.tournament_id), name: match.tournament_name },
        bracket: String(match.bracket),
        roundNumber: Number(match.round_number),
        team1Name: match.team1_name,
        team2Name: match.team2_name,
        team1Score: match.team1_score === null ? null : Number(match.team1_score),
        team2Score: match.team2_score === null ? null : Number(match.team2_score),
        forfeit,
      });
    }

    case "score_conflict": {
      const context = await loadRefereeAlertContext(entry.matchId);
      return context === null ? null : formatScoreConflictAlert(context);
    }

    case "score_report_stalled": {
      const context = await loadRefereeAlertContext(entry.matchId);
      return context === null
        ? null
        : formatStalledScoreReportAlert(context, SCORE_REPORT_TIMEOUT_MINUTES);
    }

    case "tournament_started": {
      const tournament = await loadTournament(entry.tournamentId);
      if (!tournament) return null;
      return formatTournamentStartedLog({
        tournament: { id: Number(tournament.id), name: tournament.name },
        format: tournament.format,
        registeredTeams: Number(tournament.registered_teams),
        participantType: toParticipantType(tournament.participant_type),
      });
    }

    case "tournament_finished": {
      const tournament = await loadTournament(entry.tournamentId);
      if (!tournament) return null;
      return formatTournamentFinishedLog({
        tournament: { id: Number(tournament.id), name: tournament.name },
        championName: tournament.champion_name,
      });
    }

    case "tournament_underfilled": {
      const tournament = await loadTournament(entry.tournamentId);
      if (!tournament) return null;
      return formatUnderfilledTournamentLog({
        tournament: { id: Number(tournament.id), name: tournament.name },
        registeredTeams: Number(tournament.registered_teams),
        participantType: toParticipantType(tournament.participant_type),
      });
    }
  }
}
