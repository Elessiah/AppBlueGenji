/**
 * Journal d'activité du site, poussé au canal de logs Discord du bot.
 *
 * Même sens que partout ailleurs : **le site rédige, le bot distribue**
 * (`/internal/log`, qui préfixe chaque ligne de `[AppBlueGenji]`). Le canal
 * sert à *suivre* une soirée de tournoi depuis Discord — qui s'inscrit, qui
 * abandonne, quelle manche vient de tomber et sur quel score — pas à rejouer la
 * base : ce qui se relit déjà sur la page du tournoi n'a pas à y défiler.
 *
 * D'où deux règles de rédaction, tenues ici parce qu'elles ne valent que si
 * elles sont tenues au même endroit pour tout le monde :
 *
 * 1. **Une ligne par évènement**, jamais un bloc. Le canal est une bande
 *    déroulante, pas un rapport ; dix évènements doivent tenir à l'écran.
 * 2. **Un évènement = un fait accompli.** On journalise la *fin* d'un match, pas
 *    les deux reports de score qui y mènent ; l'inscription, pas la visite de la
 *    page. Le nombre de lignes d'un tournoi reste ainsi de l'ordre de son nombre
 *    de matchs, quel que soit le trafic.
 *
 * **Tous les évènements ne finissent pas ici.** Ceux qui appellent une
 * intervention humaine partent sur le canal arbitre, plus court et adressé au
 * rôle configuré côté Discord — le tri, unique et pur, vit dans
 * `lib/shared/referee-alerts.ts`, qui rédige aussi ces alertes.
 *
 * **Troisième règle, de confidentialité** : le canal est un salon Discord — un
 * tiers, hébergé hors de l'Union européenne, purgé par le bot au bout d'un an
 * seulement (`BOT_STAFF_LOG_RETENTION_DAYS`). Il ne
 * reçoit donc **aucun pseudo de joueur** : les noms d'équipe y figurent, un
 * joueur s'y écrit « un joueur ». Un engagé n'arrive jamais ici par son nom brut
 * mais par un `LogEntrant` (`lib/shared/log-privacy.ts`), qui sait s'il
 * désigne une équipe ou une personne. Le **staff** n'y est pas nommé non plus
 * (« le staff ») : son identité part dans les journaux du serveur (pm2), qui
 * servent à la modération — `staffAuditLine`.
 *
 * Module pur (`lib/shared`) : aucune base, aucun réseau. Le déclenchement et la
 * résolution des noms vivent dans `lib/server/tournaments/bot-logs.ts`.
 */
import { matchRoundLabel, formatMatchStart } from "./discord-notifications";
import { OAUTH_PROVIDER_LABELS, type OAuthProvider } from "./oauth-providers";
import { participantWording, type ParticipantType } from "./participants";
import { ANONYMOUS_STAFF_LABEL, entrantLabel, type LogEntrant } from "./log-privacy";
import { formatLabel, gameLabel } from "./tournament-labels";
import type { TournamentFormat, TournamentGame } from "./types";
import { discordInline } from "./discord-text";

/** Tournoi désigné dans une ligne de journal. */
export interface BotLogTournament {
  id: number;
  name: string;
}

/**
 * Vocabulaire des évènements que le moteur peut annoncer.
 *
 * Déclaré ici, où vit le journal, mais lu ailleurs : `lib/shared/referee-alerts.ts`
 * en fait un `Record` exhaustif pour décider du canal de chaque évènement, et
 * `lib/server/tournaments/bot-logs.ts` contraint sur lui les entrées de sa file.
 * Un évènement ajouté à cette union sans être classé ne compile pas — c'est ce
 * qui garantit que le tri n'a jamais à être répété chez un appelant.
 */
export type BotEventKind =
  | "tournament_created"
  | "registration"
  | "forfeit"
  | "match_finished"
  | "score_conflict"
  | "score_report_stalled"
  | "match_no_referee"
  | "tournament_started"
  | "tournament_finished"
  | "tournament_underfilled"
  | "endurance_penalty"
  | "endurance_penalty_lifted";

/**
 * Titre d'un tournoi tel qu'il apparaît dans le journal.
 *
 * L'identifiant suit toujours le nom : deux éditions d'un même tournoi portent
 * volontiers le même nom, et une ligne de journal doit pouvoir être rapprochée
 * d'une page (`/tournois/<id>`) sans deviner de laquelle il s'agit.
 */
function tournamentLabel(tournament: BotLogTournament): string {
  return `« ${discordInline(tournament.name)} » (#${tournament.id})`;
}

/**
 * Entame commune à toutes les lignes : `<emoji> <Nature> — « Nom » (#id)`.
 *
 * Le canal se lit en diagonale, souvent sur un téléphone posé à côté du clavier :
 * une entame identique fait tomber la nature de l'évènement toujours au même
 * endroit, et le regard n'a plus qu'à balayer la colonne de gauche. C'est aussi
 * ce qui garantit qu'aucune ligne n'oublie de dire de quel tournoi elle parle —
 * la fonction ne sait pas en écrire une sans.
 *
 * @param emoji Pictogramme de tête, distinct par nature d'évènement.
 * @param kind Nature de l'évènement, en toutes lettres.
 * @param tournament Tournoi concerné.
 */
function lead(emoji: string, kind: string, tournament: BotLogTournament): string {
  return leadOn(emoji, kind, tournamentLabel(tournament));
}

/**
 * La même entame, sur un sujet qui n'est pas un tournoi.
 *
 * Presque tout ce que le site journalise parle d'un tournoi, et {@link lead} est
 * écrit pour qu'aucune de ces lignes-là ne puisse oublier de le nommer. Une
 * inscription de joueur, elle, n'en a aucun : elle a lieu sur `/connexion`, avant
 * que le compte n'existe. C'est la seule raison de cette seconde porte — et elle
 * passe par la même chaîne de caractères, pour que la nature de l'évènement
 * tombe au même endroit sur les deux familles de lignes.
 */
function leadOn(emoji: string, kind: string, subject: string): string {
  return `${emoji} ${kind} — ${subject}`;
}

/**
 * Voie par laquelle un compte vient de naître.
 *
 * Toutes celles que `/connexion` propose, et il n'y en a pas d'autre : le compte
 * se crée à la première connexion, jamais par un formulaire d'inscription. La
 * voie figure sur la ligne parce qu'elle décide de ce qu'on peut faire du
 * compte ensuite — un compte né par Discord porte un identifiant Discord (les
 * rappels de match en message privé demandent en plus un tag certifié) ; un
 * compte né par Google n'en a aucun tant que le joueur ne l'a pas rattaché
 * depuis `/profil`.
 *
 * C'est **la liste des fournisseurs OAuth, sans copie** : une seconde énumération
 * ici aurait oublié Blizzard le jour de son ajout, et la ligne du journal aurait
 * nommé une voie au hasard sans qu'aucun test ne s'en aperçoive — le type
 * l'aurait pourtant refusée à la compilation, ce qui est exactement ce qu'on
 * obtient en partageant le type.
 */
export type PlayerSignupProvider = OAuthProvider;

const SIGNUP_PROVIDER_LABELS: Record<PlayerSignupProvider, string> = OAUTH_PROVIDER_LABELS;

/**
 * Inscription d'un joueur : un compte vient d'être créé sur le site.
 *
 * Seule ligne du journal qui ne parle d'aucun tournoi, et la seule qu'un
 * visiteur sans compte puisse provoquer. Elle y a sa place pour la même raison
 * que les autres : c'est un **fait accompli** qui ne se relit nulle part
 * ailleurs — l'annuaire montre les comptes, pas le moment où ils sont nés — et
 * c'est ce qu'un community manager cherche le lendemain d'une annonce.
 *
 * Elle reste **une par compte**, pas une par connexion : la rédaction est
 * appelée depuis l'insertion elle-même (`lib/server/users/sign-in.ts`), donc un
 * habitué qui se reconnecte chaque soir n'écrit rien, et un joueur qui rattache
 * un second fournisseur depuis `/profil` non plus — ce n'est pas un joueur de
 * plus.
 *
 * Le joueur n'y est **pas nommé**, ni par son pseudo ni par son identifiant —
 * `#id` mène à `/joueurs/<id>`, donc au pseudo : la ligne compte une arrivée,
 * elle ne dit pas qui.
 */
export function formatPlayerSignupLog(context: { provider: PlayerSignupProvider }): string {
  const provider = SIGNUP_PROVIDER_LABELS[context.provider];
  const detail = `compte créé via ${provider}`;
  return `${leadOn("👋", "Nouveau joueur", detail)}.`;
}

/** Création d'un tournoi par le staff. */
export function formatTournamentCreatedLog(context: {
  tournament: BotLogTournament;
  format: TournamentFormat | string; // NOSONAR typescript:S6571 — l'union documente les valeurs attendues ; `string` admet une valeur brute venue de la base
  game: TournamentGame | string; // NOSONAR typescript:S6571 — l'union documente les valeurs attendues ; `string` admet une valeur brute venue de la base
  maxTeams: number;
  participantType: ParticipantType;
  startAt: string | Date | null;
}): string {
  // L'organisateur n'est pas nommé : c'est un membre du staff, et son identité
  // part dans les journaux du serveur (`staffAuditLine`), pas sur Discord.
  const parts = [
    `${formatLabel(context.format)} · ${gameLabel(context.game)}`,
    `${context.maxTeams} ${participantWording(context.participantType).many} max`,
  ];
  if (context.startAt !== null) {
    parts.push(`début le ${formatMatchStart(context.startAt)}`);
  }
  return `${lead("📅", "Nouveau tournoi", context.tournament)} : ${parts.join(", ")}.`;
}

/**
 * Inscription d'un engagé.
 *
 * `byStaff` distingue l'ajout d'une équipe fantôme (ou d'un joueur invité) de
 * l'inscription d'un joueur : sur le canal, les deux se ressemblent à s'y
 * méprendre, et c'est justement la différence qu'un arbitre cherche quand il
 * relit un plateau de remplissage.
 */
export function formatRegistrationLog(context: {
  tournament: BotLogTournament;
  entrant: LogEntrant;
  registeredTeams: number;
  maxTeams: number;
  byStaff: boolean;
}): string {
  const field = `${context.registeredTeams}/${context.maxTeams} ${participantWording(context.entrant.participantType).many}`;
  const author = context.byStaff ? " (ajout du staff)" : "";
  return `${lead("✅", "Inscription", context.tournament)} : ${entrantLabel(context.entrant)}${author}. ${field}.`;
}

/**
 * Abandon d'un engagé en cours de tournoi.
 *
 * C'est la seule sortie possible **une fois le tournoi lancé** : le staff peut
 * retirer une inscription tant que le coup d'envoi n'a pas eu lieu
 * ({@link formatEntrantRemovedLog}), mais pas une seconde après — c'est sur
 * cette borne que s'appuie `finalizeUnderfilledTournament`, qui compte
 * l'effectif au départ et n'a pas à le recompter ensuite.
 */
export function formatForfeitLog(context: {
  tournament: BotLogTournament;
  entrant: LogEntrant;
}): string {
  return `${lead("🚪", "Abandon", context.tournament)} : ${entrantLabel(context.entrant)} quitte la compétition.`;
}

/**
 * Abandon annulé par un administrateur : l'engagé revient en lice
 * (`docs/features/FORFEIT_CANCELLATION.md`).
 *
 * Le canal a annoncé l'abandon ({@link formatForfeitLog}) : il doit annoncer
 * aussi son annulation, sans quoi la dernière ligne lue y décrirait une équipe
 * sortie qui joue pourtant la manche suivante. L'auteur y est « le staff »,
 * nommé dans pm2 (`publishStaffAction`).
 */
export function formatForfeitCancelledLog(context: {
  tournament: BotLogTournament;
  entrant: LogEntrant;
}): string {
  return `${lead("🔙", "Abandon annulé", context.tournament)} : ${entrantLabel(context.entrant)} revient en lice, par ${ANONYMOUS_STAFF_LABEL}.`;
}

/** « A vs B » d'une ligne d'horaire, une place encore vide se lisant « TBD ». */
function scheduledPairLabel(team1: LogEntrant | null, team2: LogEntrant | null): string {
  return `${team1 ? entrantLabel(team1) : "TBD"} vs ${team2 ? entrantLabel(team2) : "TBD"}`;
}

/**
 * Match programmé ou reprogrammé par l'arbitrage
 * (`lib/server/tournaments/match-schedule.ts`).
 *
 * Les engagées passent par `entrantLabel` (« un joueur » en tournoi
 * individuel), une place encore vide se lit « TBD ». L'auteur y est « le
 * staff », nommé dans pm2 (`publishStaffAction`). Une reprogrammation rappelle
 * l'ancien horaire : l'arbitre qui lit le canal sait ce qui a bougé.
 */
export function formatMatchScheduledLog(context: {
  tournament: BotLogTournament;
  matchId: number;
  bracket: string;
  roundNumber: number;
  /** Ronde suisse : « Ronde N » (`matchRoundLabel`). */
  swiss?: boolean;
  team1: LogEntrant | null;
  team2: LogEntrant | null;
  startAt: string | Date;
  previousStartAt: string | Date | null;
  /** Date effacée puis reposée : « reprogrammé » sans ancienne date à citer. */
  rescheduled?: boolean;
}): string {
  const pair = scheduledPairLabel(context.team1, context.team2);
  const rescheduled = context.rescheduled ?? context.previousStartAt !== null;
  const kind = rescheduled ? "Match reprogrammé" : "Match programmé";
  const previous =
    context.previousStartAt === null ? "" : `, au lieu du ${formatMatchStart(context.previousStartAt)}`;
  return (
    `${lead("🗓️", kind, context.tournament)} : ${matchRoundLabel(context.bracket, context.roundNumber, context.swiss)} — ` +
    `${pair} (#${context.matchId}), coup d'envoi ${formatMatchStart(context.startAt)} ` +
    `(heure de Paris)${previous}, par ${ANONYMOUS_STAFF_LABEL}.`
  );
}

/**
 * Horaire d'un match retiré par l'arbitrage (`setMatchStartAt` avec une date
 * vide). Mêmes règles que {@link formatMatchScheduledLog} : engagées par
 * `entrantLabel`, « TBD » pour une place vide, auteur « le staff ».
 */
export function formatMatchScheduleClearedLog(context: {
  tournament: BotLogTournament;
  matchId: number;
  bracket: string;
  roundNumber: number;
  /** Ronde suisse : « Ronde N » (`matchRoundLabel`). */
  swiss?: boolean;
  team1: LogEntrant | null;
  team2: LogEntrant | null;
  previousStartAt: string | Date;
}): string {
  return (
    `${lead("🗓️", "Horaire retiré", context.tournament)} : ${matchRoundLabel(context.bracket, context.roundNumber, context.swiss)} — ` +
    `${scheduledPairLabel(context.team1, context.team2)} (#${context.matchId}), l'horaire du ` +
    `${formatMatchStart(context.previousStartAt)} (heure de Paris) est retiré, par ${ANONYMOUS_STAFF_LABEL}.`
  );
}

/** Une manche du programme d'arbitrage, telle que le journal la cite. */
export type RefereeDigestLogMatch = {
  matchId: number;
  tournament: BotLogTournament;
  team1: LogEntrant;
  team2: LogEntrant;
  startAt: string | Date;
  bracket: string;
  roundNumber: number;
  /** Ronde suisse : « Ronde N » (`matchRoundLabel`). */
  swiss?: boolean;
};

/** Manches citées au plus par la ligne du programme. */
export const REFEREE_DIGEST_LOG_ENTRIES = 12;

/**
 * Longueur que la ligne du programme ne dépasse jamais. Discord refuse un
 * message de plus de 2 000 caractères — et le bot l'envoie tel quel, préfixé
 * (`[AppBlueGenji] `) : refusé, le programme serait perdu, ses marques déjà
 * posées. La marge couvre le préfixe.
 */
export const REFEREE_DIGEST_LOG_MAX_LENGTH = 1900;

let digestTimeFormat: Intl.DateTimeFormat | null = null;

/** « mer. 20:00 », heure de Paris : le programme tient sur une demi-journée. */
function digestTime(startAt: string | Date): string {
  digestTimeFormat ??= new Intl.DateTimeFormat("fr-FR", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Europe/Paris",
  });
  return digestTimeFormat.format(startAt instanceof Date ? startAt : new Date(startAt));
}

/**
 * Programme d'arbitrage (`lib/server/tournaments/referee-digest.ts`) : les
 * matchs à venir (10 prochaines heures et marge de regroupement), sous forme
 * de liste à puces, dans l'ordre du
 * coup d'envoi, bornée à {@link REFEREE_DIGEST_LOG_ENTRIES} manches et à
 * {@link REFEREE_DIGEST_LOG_MAX_LENGTH} caractères (« … et N autres »).
 * Engagées par `entrantLabel` (« un joueur » en tournoi individuel), tournoi
 * par son nom et son identifiant. Aucun auteur : c'est le site qui l'envoie,
 * pas un geste du staff.
 */
export function formatRefereeDigestLog(matches: readonly RefereeDigestLogMatch[]): string {
  const subject = `${matches.length} match${matches.length > 1 ? "s" : ""} à venir`;
  const head = `${leadOn("📋", "Programme d'arbitrage", subject)} (heure de Paris) :`;
  const line = (shown: readonly string[], cited: number): string => {
    const hidden = matches.length - cited;
    const rest = hidden > 0 ? [`… et ${hidden} autre${hidden > 1 ? "s" : ""}`] : [];
    return head + "\n" + [...shown, ...rest].map((entry) => "- " + entry).join("\n") + ".";
  };
  // Autant de manches que la borne et la longueur le permettent, mention du
  // reste comprise ; la première toujours, coupée s'il le faut.
  // Une entrée par match ; en solo (aucun nom à citer), une par créneau,
  // tournoi et manche quand ils se suivent : « 8 matchs », pas huit entrées
  // « un joueur vs un joueur » qui pousseraient les autres hors du message.
  const groups: { first: RefereeDigestLogMatch; time: string; round: string; count: number }[] = [];
  for (const match of matches) {
    const time = digestTime(match.startAt);
    const round = matchRoundLabel(match.bracket, match.roundNumber, match.swiss);
    const last = groups.at(-1);
    const solo = match.team1.participantType === "SOLO";
    if (
      solo &&
      last?.first.team1.participantType === "SOLO" &&
      last.time === time &&
      last.round === round &&
      last.first.tournament.id === match.tournament.id
    ) {
      last.count += 1;
      continue;
    }
    groups.push({ first: match, time, round, count: 1 });
  }
  const entryOf = ({ first, time, round, count }: (typeof groups)[number]): string =>
    count > 1
      ? `${time} ${count} matchs (${tournamentLabel(first.tournament)}, ${round})`
      : `${time} ${entrantLabel(first.team1)} vs ${entrantLabel(first.team2)} ` +
        `(${tournamentLabel(first.tournament)}, ${round}, match #${first.matchId})`;
  const shown: string[] = [];
  let cited = 0;
  for (const group of groups.slice(0, REFEREE_DIGEST_LOG_ENTRIES)) {
    const entry = entryOf(group);
    if (shown.length > 0 && line([...shown, entry], cited + group.count).length > REFEREE_DIGEST_LOG_MAX_LENGTH) break;
    shown.push(entry);
    cited += group.count;
  }
  const result = line(shown, cited);
  if (result.length <= REFEREE_DIGEST_LOG_MAX_LENGTH) return result;
  // Coupe sans séparer une paire de substitution (émoji d'un nom).
  return `${result.slice(0, REFEREE_DIGEST_LOG_MAX_LENGTH - 1).replace(/[\uD800-\uDBFF]$/, "")}…`;
}

/**
 * Retrait d'une inscription par le staff, avant le coup d'envoi
 * (`lib/shared/entrant-removal.ts`).
 *
 * Ligne distincte de l'abandon, et ce n'est pas une nuance de vocabulaire : un
 * abandon laisse un engagé au classement avec un forfait à son nom, un retrait
 * l'efface — après coup, rien sur la page ne dira qu'il a été inscrit. Le canal
 * est alors le **seul** endroit où la trace subsiste. L'auteur y est « le
 * staff » : son nom part dans les journaux du serveur (`staffAuditLine`), comme
 * pour la suppression d'un tournoi et le retour en arrière.
 *
 * L'effectif restant suit : c'est ce qu'un arbitre vérifie en retirant une
 * équipe la veille d'un tournoi, et il tombe déjà à cet endroit de la ligne sur
 * l'inscription.
 */
export function formatEntrantRemovedLog(context: {
  tournament: BotLogTournament;
  entrant: LogEntrant;
  registeredTeams: number;
  maxTeams: number;
}): string {
  const field = `${context.registeredTeams}/${context.maxTeams} ${participantWording(context.entrant.participantType).many}`;
  return `${lead("➖", "Inscription retirée", context.tournament)} : ${entrantLabel(context.entrant)}, par ${ANONYMOUS_STAFF_LABEL}. ${field}.`;
}

/**
 * Fin d'un match, avec son score.
 *
 * Écrite au moment où le match est **tranché** — les deux engagés d'accord, un
 * délai de report expiré, ou un arbitrage — et non à chaque saisie : un match ne
 * produit donc qu'une ligne, deux s'il est corrigé plus tard.
 */
export function formatMatchResultLog(context: {
  tournament: BotLogTournament;
  bracket: string;
  roundNumber: number;
  /** Ronde suisse : « Ronde N » (`matchRoundLabel`). */
  swiss?: boolean;
  team1: LogEntrant;
  team2: LogEntrant;
  /** `null` sur un forfait arbitré : le moteur n'y écrit aucun score. */
  team1Score: number | null;
  team2Score: number | null;
  /** Forfait déclaré sur ce match : le score seul ne le dirait pas. */
  forfeit?: boolean;
  /**
   * Les deux engagées ont déclaré forfait : ni score ni vainqueur, et la ligne
   * doit le dire — « A vs B » seul se lirait comme un résultat manquant.
   */
  doubleForfeit?: boolean;
}): string {
  const round = matchRoundLabel(context.bracket, context.roundNumber, context.swiss);
  // Un forfait prononcé par un arbitre laisse les deux scores à `null` : la
  // rencontre n'a pas été jouée. Écrire « 0–0 » raconterait un match nul.
  const team1 = entrantLabel(context.team1);
  const team2 = entrantLabel(context.team2);
  const score =
    context.team1Score === null || context.team2Score === null
      ? `${team1} vs ${team2}`
      : `${team1} ${context.team1Score}–${context.team2Score} ${team2}`;
  return `${lead("🏁", "Match terminé", context.tournament)} · ${round} : ${score}${forfeitNote(context)}.`;
}

/** Mention de forfait accolée au score d'une fin de match, vide sans forfait. */
function forfeitNote(context: { forfeit?: boolean; doubleForfeit?: boolean }): string {
  if (context.doubleForfeit) return " (double forfait, aucune qualifiée)";
  return context.forfeit ? " (forfait)" : "";
}

/** Coup d'envoi : le tournoi passe « en cours ». */
export function formatTournamentStartedLog(context: {
  tournament: BotLogTournament;
  format: TournamentFormat | string; // NOSONAR typescript:S6571 — l'union documente les valeurs attendues ; `string` admet une valeur brute venue de la base
  registeredTeams: number;
  participantType: ParticipantType;
}): string {
  const field = `${context.registeredTeams} ${participantWording(context.participantType).many}`;
  return `${lead("🚀", "Coup d'envoi", context.tournament)} : ${field}, ${formatLabel(context.format)}.`;
}

/** Clôture d'un tournoi, avec sa championne quand le classement en désigne une. */
export function formatTournamentFinishedLog(context: {
  tournament: BotLogTournament;
  champion: LogEntrant | null;
}): string {
  const champion = context.champion ? ` : ${entrantLabel(context.champion)} l'emporte.` : ".";
  return `${lead("🏆", "Tournoi terminé", context.tournament)}${champion}`;
}

/**
 * Tournoi clos à son coup d'envoi faute d'adversaires (0 ou 1 engagé).
 *
 * Ligne distincte de la clôture ordinaire : un tournoi qui se termine sans avoir
 * joué est un incident d'organisation, pas un palmarès — et c'est précisément le
 * genre de chose qu'on veut voir passer sur Discord le soir même.
 */
export function formatUnderfilledTournamentLog(context: {
  tournament: BotLogTournament;
  registeredTeams: number;
  participantType: ParticipantType;
}): string {
  const wording = participantWording(context.participantType);
  const loneEntrant = wording.one === "équipe" ? "1 seule équipe engagée" : "1 seul joueur engagé";
  const field = context.registeredTeams === 0 ? "aucun engagement" : loneEntrant;
  return `${lead("🚫", "Tournoi clos faute d'adversaires", context.tournament)} : ${field}.`;
}

/**
 * Pénalité de points d'endurance infligée par l'arbitrage (mode « BlueGenji
 * Survie », `lib/shared/endurance-penalty.ts`).
 *
 * Au journal et non au canal arbitre : c'est *l'arbitre* qui vient de la
 * prononcer, il n'a rien à faire de plus en lisant la ligne. Elle y figure
 * quand même parce qu'elle déplace un classement sans qu'aucun match ne
 * l'explique — la seule façon, depuis Discord, de comprendre pourquoi une
 * équipe a perdu trois points sans jouer.
 *
 * Le motif est repris tel quel : une sanction sans son motif n'est pas
 * contestable, et c'est justement ce qu'un capitaine cherchera dans le canal.
 */
export function formatEndurancePenaltyLog(context: {
  tournament: BotLogTournament;
  entrant: LogEntrant;
  points: number;
  reason: string;
}): string {
  const points = `${context.points} point${context.points > 1 ? "s" : ""} d'endurance`;
  return `${lead("⛔", "Pénalité", context.tournament)} : ${entrantLabel(context.entrant)} perd ${points} — ${discordInline(context.reason)}.`;
}

/**
 * Pénalité retirée : le rejeu a rendu les points et défait ce qu'elle avait
 * entraîné.
 *
 * Ligne distincte, et non un silence : sans elle, le canal garderait la trace
 * d'une sanction qui n'existe plus, et le classement affiché sur la page ne
 * s'accorderait plus avec ce qu'on y a lu.
 */
export function formatEndurancePenaltyLiftedLog(context: {
  tournament: BotLogTournament;
  entrant: LogEntrant;
  points: number;
}): string {
  const points = `${context.points} point${context.points > 1 ? "s" : ""} d'endurance`;
  return `${lead("↩️", "Pénalité annulée", context.tournament)} : ${entrantLabel(context.entrant)} récupère ${points}.`;
}

/** Suppression définitive d'un tournoi (administrateur, nommé dans l'audit pm2). */
export function formatTournamentDeletedLog(context: { tournament: BotLogTournament }): string {
  return `${lead("🗑️", "Tournoi supprimé définitivement", context.tournament)}, par ${ANONYMOUS_STAFF_LABEL}.`;
}

/**
 * Retour en arrière : la manche courante d'un tournoi vient d'être effacée.
 *
 * Ligne de journal et non alerte arbitre : c'est le staff qui vient de faire le
 * geste, il n'y a rien à lui demander. Mais elle *doit* figurer au canal — c'est
 * la seule action du site qui efface des résultats déjà annoncés, et une équipe
 * qui retrouve sa manche vierge doit pouvoir lire pourquoi. Le « qui » reste
 * dans les journaux du serveur (`staffAuditLine`).
 *
 * `roundLabel` est rédigé par `lib/shared/tournament-rollback.ts`, qui seul sait
 * qu'un tour d'arbre de BlueGenji Survie ne s'annonce pas « manche 1002 » — et
 * qui porte l'article, une manche étant féminine et un tour masculin. Rien n'est
 * accordé avec lui ici : le compte des rencontres suit, séparé par un tiret.
 */
export function formatRoundRolledBackLog(context: {
  tournament: BotLogTournament;
  roundLabel: string;
  clearedMatches: number;
  /**
   * Le tournoi était **terminé** et vient d'être rouvert.
   *
   * Le fait mérite d'être dit, et pas seulement pour la forme : un palmarès
   * annoncé sur ce même canal quelques lignes plus haut ne vaut plus, et la
   * clôture qui suivra en annoncera un autre.
   */
  reopenedTournament?: boolean;
}): string {
  const plural = context.clearedMatches > 1 ? "s" : "";
  const matches = `${context.clearedMatches} rencontre${plural} effacée${plural}`;
  const reopened = context.reopenedTournament ? ", tournoi rouvert" : "";
  return `${lead("⏪", "Retour en arrière", context.tournament)} : ${context.roundLabel} — ${matches}${reopened}, par ${ANONYMOUS_STAFF_LABEL}.`;
}

/**
 * Ce qui vient d'arriver à l'inscription d'un caster sur un match
 * (`lib/server/tournaments/cast-notices.ts`) :
 *
 * - `CLAIMED` — un caster s'inscrit sur un match libre ;
 * - `REPLACED` — un caster prend la place d'un autre, qui ne remplissait plus
 *   les conditions du cast ;
 * - `RELEASED` — le caster retire lui-même son inscription ;
 * - `RELEASED_BY_STAFF` — le staff la retire ;
 * - `INELIGIBLE` / `JOINED_TEAM` — retirée d'office : le caster ne remplit plus
 *   les conditions du cast, ou il joue désormais le match.
 */
export type CastLogChange = "CLAIMED" | "REPLACED" | "RELEASED" | "RELEASED_BY_STAFF" | "INELIGIBLE" | "JOINED_TEAM";

const CAST_LOG_WORDING: Record<CastLogChange, { kind: string; detail: string }> = {
  CLAIMED: { kind: "Cast réservé", detail: "un caster s'inscrit sur le match" },
  REPLACED: {
    kind: "Cast repris",
    detail: "un caster prend la place du précédent, qui ne remplissait plus les conditions du cast",
  },
  RELEASED: { kind: "Cast libéré", detail: "le caster retire son inscription" },
  RELEASED_BY_STAFF: { kind: "Cast retiré", detail: `inscription du caster retirée par ${ANONYMOUS_STAFF_LABEL}` },
  INELIGIBLE: {
    kind: "Cast retiré d'office",
    detail: "le caster ne remplit plus les conditions du cast (permission de diffusion, tag Discord certifié, compte Battle.net)",
  },
  JOINED_TEAM: { kind: "Cast retiré d'office", detail: "le caster joue désormais ce match" },
};

/**
 * Ce qui vient d'arriver à l'arbitre désigné ou à l'organisation d'un match
 * (`lib/server/tournaments/referee-notices.ts`, `docs/features/MATCH_REFEREE.md`).
 * Personne n'est nommé : « un arbitre », « le staff ».
 */
export type RefereeLogChange =
  | "TAKEN"
  | "ASSIGNED"
  | "SWAPPED"
  | "RELEASED"
  | "RELEASED_BY_STAFF"
  | "INELIGIBLE"
  | "JOINED_TEAM"
  | "SELF_MANAGED_ON"
  | "SELF_MANAGED_OFF"
  | "FIRST_MAP_SET"
  | "FIRST_MAP_CLEARED"
  | "MAP_PICKED"
  | "MAP_PICKED_BY_TEAM"
  | "MAP_PICK_CLEARED";

const REFEREE_LOG_WORDING: Record<RefereeLogChange, { kind: string; detail: string }> = {
  TAKEN: { kind: "Arbitre désigné", detail: "un arbitre prend le match" },
  ASSIGNED: { kind: "Arbitre désigné", detail: `arbitre désigné par ${ANONYMOUS_STAFF_LABEL}` },
  SWAPPED: { kind: "Arbitre changé", detail: `arbitre remplacé par ${ANONYMOUS_STAFF_LABEL}` },
  RELEASED: { kind: "Arbitre retiré", detail: "l'arbitre se retire du match" },
  RELEASED_BY_STAFF: { kind: "Arbitre retiré", detail: `arbitre retiré par ${ANONYMOUS_STAFF_LABEL}` },
  INELIGIBLE: {
    kind: "Arbitre retiré d'office",
    detail: "l'arbitre ne remplit plus les conditions (rôle d'arbitre, tag Discord certifié, compte Battle.net)",
  },
  JOINED_TEAM: { kind: "Arbitre retiré d'office", detail: "l'arbitre joue désormais ce match" },
  SELF_MANAGED_ON: { kind: "Autogestion activée", detail: `par ${ANONYMOUS_STAFF_LABEL}` },
  SELF_MANAGED_OFF: { kind: "Autogestion désactivée", detail: `par ${ANONYMOUS_STAFF_LABEL}` },
  FIRST_MAP_SET: { kind: "Première carte réglée", detail: `par ${ANONYMOUS_STAFF_LABEL}` },
  FIRST_MAP_CLEARED: { kind: "Première carte retirée", detail: `par ${ANONYMOUS_STAFF_LABEL}` },
  MAP_PICKED: { kind: "Carte choisie dans le pool", detail: `par ${ANONYMOUS_STAFF_LABEL}` },
  MAP_PICKED_BY_TEAM: { kind: "Carte choisie dans le pool", detail: "par une équipe du match (autogestion)" },
  MAP_PICK_CLEARED: { kind: "Choix de carte retiré", detail: "le pool reste ouvert" },
};

/**
 * Arbitre désigné, autogestion ou première carte d'un match changés. Ni
 * l'arbitre, ni le staff, ni, en tournoi individuel, les joueurs ne sont
 * nommés ; rien ne part dans pm2 (gestes de staff anonymes partout,
 * décision du 27 octobre 2026). Ni la carte : la page du match la dit.
 */
export function formatRefereeChangeLog(context: {
  tournament: BotLogTournament;
  matchId: number;
  bracket: string;
  roundNumber: number;
  swiss?: boolean;
  team1: LogEntrant | null;
  team2: LogEntrant | null;
  change: RefereeLogChange;
}): string {
  const wording = REFEREE_LOG_WORDING[context.change];
  return (
    `${lead("🧑‍⚖️", wording.kind, context.tournament)} : ${matchRoundLabel(context.bracket, context.roundNumber, context.swiss)} — ` +
    `${scheduledPairLabel(context.team1, context.team2)} (#${context.matchId}), ${wording.detail}.`
  );
}

/**
 * Autogestion activée ou désactivée sur toute une manche, d'un geste
 * (`count` : matchs changés). Le tournoi seul, sans équipe.
 */
export function formatRoundSelfManagementLog(context: {
  tournament: BotLogTournament;
  roundLabel: string;
  enabled: boolean;
  count: number;
}): string {
  const plural = context.count > 1 ? "s" : "";
  const kind = context.enabled ? "Autogestion activée" : "Autogestion désactivée";
  return `${lead("🧑‍⚖️", kind, context.tournament)} : ${context.roundLabel} — ${context.count} match${plural}, par ${ANONYMOUS_STAFF_LABEL}.`;
}

/**
 * Cartes d'une manche réglées ou retirées (`docs/features/ROUND_MAPS.md`) :
 * une ligne pour la manche, sans nommer le staff ni les cartes (la page du
 * match les dit).
 */
export function formatRoundMapsLog(context: {
  tournament: BotLogTournament;
  roundLabel: string;
  /** Créneaux retenus ; 0 = réglage retiré. */
  slots: number;
  /** Dont imposés (une seule carte). */
  imposed: number;
}): string {
  if (context.slots === 0) {
    return `${lead("🗺️", "Cartes de manche retirées", context.tournament)} : ${context.roundLabel}, par ${ANONYMOUS_STAFF_LABEL}.`;
  }
  const plural = context.slots > 1 ? "s" : "";
  const pools = context.slots - context.imposed;
  return (
    `${lead("🗺️", "Cartes de manche réglées", context.tournament)} : ${context.roundLabel} — ` +
    `${context.slots} carte${plural} (${context.imposed} imposée${context.imposed > 1 ? "s" : ""}, ` +
    `${pools} pool${pools > 1 ? "s" : ""}), par ${ANONYMOUS_STAFF_LABEL}.`
  );
}

/** Règles de ban et de choix des cartes d'un tournoi modifiées. */
export function formatMapRulesLog(context: { tournament: BotLogTournament }): string {
  return `${lead("🗺️", "Règles de ban modifiées", context.tournament)}, par ${ANONYMOUS_STAFF_LABEL}.`;
}

/**
 * Inscription d'un caster posée, reprise ou retirée. **Personne n'est nommé** :
 * ni le caster (« un caster », « le caster »), ni le staff (« le staff »), ni,
 * en tournoi individuel, les joueurs (`entrantLabel`) — et rien ne part dans
 * pm2 non plus (décision du 27 octobre 2026 : gestes de staff anonymes partout).
 */
export function formatCastChangeLog(context: {
  tournament: BotLogTournament;
  matchId: number;
  bracket: string;
  roundNumber: number;
  /** Ronde suisse : « Ronde N » (`matchRoundLabel`). */
  swiss?: boolean;
  team1: LogEntrant | null;
  team2: LogEntrant | null;
  change: CastLogChange;
}): string {
  const wording = CAST_LOG_WORDING[context.change];
  return (
    `${lead("🎙️", wording.kind, context.tournament)} : ${matchRoundLabel(context.bracket, context.roundNumber, context.swiss)} — ` +
    `${scheduledPairLabel(context.team1, context.team2)} (#${context.matchId}), ${wording.detail}.`
  );
}

/**
 * Gestes du staff sur un match qui ne laissaient aucune trace
 * (`docs/features/STAFF_ACTION_LOGS.md`) :
 *
 * - `RESULT_VALIDATED` — « Valider le résultat » (score, forfait ou double
 *   forfait tranché par l'arbitrage) ;
 * - `SCORES_SAVED` — « Enregistrer » : avancement noté sans trancher ;
 * - `FORCE_LAUNCHED` — lancement forcé du match ;
 * - `HOST_SET` / `HOST_CLEARED` — hôte du salon désigné ou retiré ;
 * - `LIVE_CONFIGURED` / `LIVE_REMOVED` — diffusion du match réglée
 *   (déclencheur, lien) ou retirée (le match n'est plus casté) ;
 * - `ON_AIR` / `OFF_AIR` — match mis à l'antenne ou retiré de l'antenne ;
 * - `REPLAY_SET` / `REPLAY_REMOVED` — lien de rediffusion posé ou retiré.
 */
export type StaffMatchAction =
  | "RESULT_VALIDATED"
  | "SCORES_SAVED"
  | "FORCE_LAUNCHED"
  | "HOST_SET"
  | "HOST_CLEARED"
  | "LIVE_CONFIGURED"
  | "LIVE_REMOVED"
  | "ON_AIR"
  | "OFF_AIR"
  | "REPLAY_SET"
  | "REPLAY_REMOVED";

const STAFF_MATCH_ACTION_WORDING: Record<StaffMatchAction, string> = {
  RESULT_VALIDATED: "Résultat validé",
  SCORES_SAVED: "Score enregistré",
  FORCE_LAUNCHED: "Lancement forcé",
  HOST_SET: "Hôte désigné",
  HOST_CLEARED: "Hôte retiré",
  LIVE_CONFIGURED: "Diffusion réglée",
  LIVE_REMOVED: "Diffusion retirée",
  ON_AIR: "Mis à l'antenne",
  OFF_AIR: "Retiré de l'antenne",
  REPLAY_SET: "Rediffusion ajoutée",
  REPLAY_REMOVED: "Rediffusion retirée",
};

/**
 * Auteur d'un geste, jamais nommé : `STAFF` (« le staff ») ou `CASTER` (« un
 * caster ») — la diffusion et la rediffusion d'un match s'ouvrent aussi à qui
 * ne détient que la permission `live`, et la ligne ne doit pas prêter son geste
 * aux arbitres.
 */
export type StaffActionAuthor = "STAFF" | "CASTER";

const STAFF_ACTION_AUTHOR_LABEL: Record<StaffActionAuthor, string> = {
  STAFF: ANONYMOUS_STAFF_LABEL,
  CASTER: "un caster",
};

/**
 * Geste du staff sur un match. **Personne n'est nommé** : l'auteur est « le
 * staff » ou « un caster » (`author`), les joueurs d'un tournoi individuel « un joueur » (`entrantLabel`),
 * et rien ne part dans pm2 (décision du 27 octobre 2026). Ni score, ni lien, ni
 * équipe hôte : la ligne dit qu'un geste a eu lieu, la page du match dit lequel.
 */
export function formatStaffMatchActionLog(context: {
  tournament: BotLogTournament;
  matchId: number;
  bracket: string;
  roundNumber: number;
  /** Ronde suisse : « Ronde N » (`matchRoundLabel`). */
  swiss?: boolean;
  team1: LogEntrant | null;
  team2: LogEntrant | null;
  action: StaffMatchAction;
  /** Par défaut `STAFF`. */
  author?: StaffActionAuthor;
  /**
   * Le tournoi seul, sans manche ni équipes ni numéro de match : un score qui
   * suspend la validation automatique, dont l'alerte ⚠️ « arbitre qui joue »
   * ne nomme que le tournoi — la ligne 🛠️ ne doit pas désigner le match à côté.
   */
  withoutMatch?: boolean;
}): string {
  const author = STAFF_ACTION_AUTHOR_LABEL[context.author ?? "STAFF"];
  if (context.withoutMatch) {
    return `${lead("🛠️", STAFF_MATCH_ACTION_WORDING[context.action], context.tournament)}, par ${author}.`;
  }
  return (
    `${lead("🛠️", STAFF_MATCH_ACTION_WORDING[context.action], context.tournament)} : ` +
    `${matchRoundLabel(context.bracket, context.roundNumber, context.swiss)} — ` +
    `${scheduledPairLabel(context.team1, context.team2)} (#${context.matchId}), par ${author}.`
  );
}

/**
 * Gestes du staff sur un tournoi qui ne laissaient aucune trace :
 *
 * - `EDITED` — paramètres du tournoi modifiés ;
 * - `SEEDING_REORDERED` — ordre des têtes de série changé ;
 * - `ADVANCED` — étape suivante avancée (ouverture des inscriptions, début) ;
 * - `GHOST_TEAMS_REGISTERED` — équipes fantômes inscrites (`count`) ;
 * - `IMAGE_SET` / `IMAGE_UPDATED` / `IMAGE_REMOVED` — image du tournoi ;
 * - `LIVE_URL_SET` / `LIVE_URL_REMOVED` — lien de diffusion du tournoi.
 */
export type StaffTournamentAction =
  | "EDITED"
  | "SEEDING_REORDERED"
  | "ADVANCED"
  | "GHOST_TEAMS_REGISTERED"
  | "IMAGE_SET"
  | "IMAGE_UPDATED"
  | "IMAGE_REMOVED"
  | "LIVE_URL_SET"
  | "LIVE_URL_REMOVED";

const STAFF_TOURNAMENT_ACTION_WORDING: Record<StaffTournamentAction, string> = {
  EDITED: "Tournoi modifié",
  SEEDING_REORDERED: "Têtes de série réordonnées",
  ADVANCED: "Étape suivante avancée",
  GHOST_TEAMS_REGISTERED: "Équipes fantômes inscrites",
  IMAGE_SET: "Image du tournoi ajoutée",
  IMAGE_UPDATED: "Cadrage de l'image modifié",
  IMAGE_REMOVED: "Image du tournoi retirée",
  LIVE_URL_SET: "Lien de diffusion du tournoi posé",
  LIVE_URL_REMOVED: "Lien de diffusion du tournoi retiré",
};

/**
 * Geste du staff sur un tournoi, auteur anonyme (« le staff ») et rien dans
 * pm2, comme {@link formatStaffMatchActionLog}. `count` (équipes fantômes) suit
 * le geste : c'est ce que l'arbitre vérifie, et il ne nomme personne.
 */
export function formatStaffTournamentActionLog(context: {
  tournament: BotLogTournament;
  action: StaffTournamentAction;
  count?: number;
}): string {
  const count = context.count === undefined ? "" : ` (${context.count})`;
  return `${lead("🛠️", STAFF_TOURNAMENT_ACTION_WORDING[context.action], context.tournament)}${count}, par ${ANONYMOUS_STAFF_LABEL}.`;
}
