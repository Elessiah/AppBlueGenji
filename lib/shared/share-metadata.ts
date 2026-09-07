/**
 * Ce qu'un lien du site raconte quand on le colle ailleurs.
 *
 * Un lien partagé sur Discord n'affiche pas la page : il affiche ce que la page
 * a écrit dans son `<head>`. Le site n'y écrivait qu'un titre et une phrase
 * fixes — « BlueGenji Esport » —, si bien que coller trois tournois différents
 * dans un salon produisait trois fois le même encart. La fiche d'un tournoi
 * n'en écrivait même pas : elle héritait de la racine.
 *
 * Ce module rédige. Il ne connaît ni Next.js ni Open Graph : il rend des
 * chaînes, et l'appelant décide s'il en fait un `<meta>`, une image d'aperçu ou
 * un message. C'est ce qui permet de tester la rédaction — la partie qui se
 * trompe — sans monter un serveur.
 *
 * **Le fuseau est écrit en dur, et c'est voulu.** Ailleurs (`_lib/header-meta.ts`)
 * les dates voyagent en ISO jusqu'au navigateur, parce que la mise en forme
 * dépend du fuseau du lecteur. Un encart de partage n'a pas de lecteur : il est
 * rédigé une fois, côté serveur, et le même texte est servi à tout le monde.
 * Faute de fuseau du lecteur, on prend celui du public visé — la France.
 */
import { FORMAT_LABELS, GAME_LABELS } from "./tournament-labels";
import { participantWording } from "./participants";
import type { TournamentCard, TournamentState } from "./types";

/** Nom du site, tel qu'il doit apparaître dans un encart de partage. */
export const SITE_NAME = "BlueGenji Esport";

/**
 * Phrase d'accroche du site.
 *
 * L'ordre des deux jeux n'est pas cosmétique : BlueGenji est d'abord une
 * structure Overwatch, Marvel Rivals est venu ensuite. La racine annonçait
 * « l'esport amateur Marvel Rivals » tout court, ce qui décrivait mal
 * l'association et son historique.
 */
export const SITE_DESCRIPTION =
  "Tournois amateurs Overwatch et Marvel Rivals, brackets en direct, classement des équipes et bot Discord : la plateforme de l'association BlueGenji.";

/**
 * Ce qu'affiche la carte d'aperçu du site — celle que reçoit toute page sans
 * carte à elle, et celle sur laquelle retombe un tournoi illisible.
 *
 * Elle est bâtie comme celle d'un tournoi : le contexte en surtitre, le nom en
 * grand, la phrase dessous. Sans ces trois rôles distincts, la carte répétait
 * « BlueGenji Esport » en surtitre, en titre **et** en pied.
 */
export const SITE_SHARE_CARD = {
  eyebrow: "Overwatch · Marvel Rivals",
  title: SITE_NAME,
  subtitle:
    "Tournois amateurs francophones, brackets en direct, classement des équipes et bot Discord.",
} as const;

/** Fuseau de rédaction des dates partagées (voir l'en-tête du module). */
const SHARE_TIME_ZONE = "Europe/Paris";

/**
 * Longueur au-delà de laquelle Discord coupe lui-même la description d'un
 * encart. On coupe avant lui, sur un mot, plutôt que de lui laisser trancher au
 * milieu d'un nom d'équipe.
 */
const DESCRIPTION_MAX_LENGTH = 300;

/** Part de {@link DESCRIPTION_MAX_LENGTH} laissée au texte libre de l'auteur. */
const FREE_TEXT_MAX_LENGTH = 160;

/** Ce que le sous-titre de l'image d'aperçu peut porter sans déborder. */
const SHARE_CARD_SUBTITLE_MAX_LENGTH = 130;

/**
 * Coupe un texte sans couper un mot, et signale la coupe par une ellipse.
 *
 * Un texte plus court que la limite ressort **inchangé** : pas d'ellipse, pas
 * d'espace ajouté. Les sauts de ligne du texte libre deviennent des espaces —
 * un encart est un paragraphe, et une description de tournoi mise en forme sur
 * dix lignes y ouvrirait un trou.
 */
export function truncateForShare(text: string, maxLength: number): string {
  const flattened = text.replace(/\s+/gu, " ").trim();
  if (flattened.length <= maxLength) return flattened;

  // −1 pour l'ellipse, qui compte dans la limite annoncée.
  const hardCut = flattened.slice(0, Math.max(0, maxLength - 1));
  const lastSpace = hardCut.lastIndexOf(" ");
  // Un mot unique plus long que la limite n'a pas d'espace où se couper : on
  // tranche dedans plutôt que de rendre une ellipse seule.
  const cut = lastSpace > maxLength / 2 ? hardCut.slice(0, lastSpace) : hardCut;
  return `${cut.replace(/[\s,;:.]+$/u, "")}…`;
}

/** Une date rédigée pour un encart : « 14 septembre 2026 à 20:00 ». */
export function formatShareDate(iso: string): string | null {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;

  const date = new Date(time);
  const day = new Intl.DateTimeFormat("fr-FR", {
    timeZone: SHARE_TIME_ZONE,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  const hour = new Intl.DateTimeFormat("fr-FR", {
    timeZone: SHARE_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);

  return `${day} à ${hour}`;
}

/** La même date, resserrée pour tenir dans une case : « 16 sept. 2026 · 13:35 ». */
export function formatShareDateShort(iso: string): string | null {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;

  const date = new Date(time);
  const day = new Intl.DateTimeFormat("fr-FR", {
    timeZone: SHARE_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
  const hour = new Intl.DateTimeFormat("fr-FR", {
    timeZone: SHARE_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);

  return `${day} · ${hour}`;
}

/**
 * L'échéance qui compte à cet instant, en deux morceaux : ce qu'elle est, et
 * quand.
 *
 * Un tournoi terminé n'a plus de « coup d'envoi », un tournoi dont les
 * inscriptions n'ont pas ouvert n'a pas encore de clôture à annoncer : chaque
 * état met en avant la seule date qui apprend quelque chose au lecteur.
 *
 * Les deux morceaux restent séparés parce que les deux rendus les assemblent
 * autrement : la description en fait une phrase, l'image d'aperçu en fait un
 * intitulé et sa valeur.
 */
function schedule(
  card: TournamentCard,
  now: number,
): { lead: string; iso: string } | null {
  if (card.state === "FINISHED") return { lead: "Joué le", iso: card.startAt };
  if (card.state === "RUNNING") return { lead: "En cours depuis le", iso: card.startAt };
  if (card.state === "REGISTRATION") {
    return { lead: "Inscriptions jusqu'au", iso: card.registrationCloseAt };
  }

  const opensAt = Date.parse(card.registrationOpenAt);
  if (Number.isFinite(opensAt) && now < opensAt) {
    return { lead: "Inscriptions dès le", iso: card.registrationOpenAt };
  }

  return { lead: "Coup d'envoi le", iso: card.startAt };
}

/** L'échéance rédigée en une phrase : « Coup d'envoi le 14 septembre 2026 à 20:00 ». */
function scheduleLine(card: TournamentCard, now: number): string | null {
  const next = schedule(card, now);
  if (!next) return null;
  const date = formatShareDate(next.iso);
  return date ? `${next.lead} ${date}` : null;
}

const STATE_SHARE_LABELS: Record<TournamentState, string> = {
  UPCOMING: "Prochainement",
  REGISTRATION: "Inscriptions ouvertes",
  RUNNING: "Tournoi en cours",
  FINISHED: "Tournoi terminé",
};

/** Libellé d'état tel qu'il apparaît dans un encart de partage. */
export function tournamentShareState(card: TournamentCard): string {
  return STATE_SHARE_LABELS[card.state] ?? card.state;
}

/**
 * Titre de l'encart : le nom du tournoi, puis son jeu.
 *
 * Le nom seul suffit rarement dans un salon Discord où l'on colle des liens de
 * deux jeux ; le jeu seul ne dit pas de quel tournoi il s'agit.
 */
export function tournamentShareTitle(card: TournamentCard): string {
  const game = GAME_LABELS[card.game] ?? card.game;
  return `${card.name} · ${game}`;
}

/**
 * Ce que l'image d'aperçu affiche, décidé ici plutôt que dans la route qui la
 * dessine : c'est de la rédaction, et la rédaction se teste.
 *
 * Le jeu remonte dans le surtitre, à côté de l'état — dans le titre il volait
 * la place au nom du tournoi, que l'image écrit en grand. La description de
 * l'organisateur prend alors le sous-titre : c'est elle qui remplit la carte,
 * et un tournoi qui n'en a pas n'affiche rien plutôt qu'une ligne bouche-trou.
 */
export function tournamentShareCard(
  card: TournamentCard,
  now: number = Date.now(),
): {
  eyebrow: string;
  title: string;
  subtitle?: string;
  facts: { label: string; value: string }[];
} {
  const wording = participantWording(card.participantType);
  const game = GAME_LABELS[card.game] ?? card.game;

  const facts = [
    { label: "Format", value: FORMAT_LABELS[card.format] ?? card.format },
    { label: wording.manyCapitalized, value: `${card.registeredTeams}/${card.maxTeams}` },
  ];

  // L'intitulé porte la nature de l'échéance (« Inscriptions jusqu'au »), la
  // valeur ne porte que la date : un « Calendrier » suivi de la phrase entière
  // répétait l'information et débordait de sa case.
  const next = schedule(card, now);
  const date = next ? formatShareDateShort(next.iso) : null;
  if (next && date) facts.push({ label: next.lead, value: date });

  const subtitle = card.description
    ? truncateForShare(card.description, SHARE_CARD_SUBTITLE_MAX_LENGTH)
    : "";

  return {
    eyebrow: `${game} · ${tournamentShareState(card)}`,
    title: card.name,
    subtitle: subtitle || undefined,
    facts,
  };
}

/**
 * Description de l'encart : le texte de l'organisateur, puis les faits.
 *
 * Le texte libre passe en premier — c'est la seule partie que quelqu'un a
 * écrite pour être lue — mais il est **borné** : une description de trois
 * paragraphes noierait la date et l'effectif, qui sont justement ce qu'on vient
 * chercher dans un encart. Un tournoi sans description n'affiche pas de ligne
 * vide : les faits se suffisent.
 */
export function tournamentShareDescription(
  card: TournamentCard,
  now: number = Date.now(),
): string {
  const wording = participantWording(card.participantType);

  const parts = [
    tournamentShareState(card),
    FORMAT_LABELS[card.format] ?? card.format,
    `${card.registeredTeams}/${card.maxTeams} ${wording.manyEngaged}`,
  ];

  const schedule = scheduleLine(card, now);
  if (schedule) parts.push(schedule);

  const facts = `${parts.join(" · ")}.`;
  const free = card.description ? truncateForShare(card.description, FREE_TEXT_MAX_LENGTH) : "";

  return truncateForShare(free ? `${free} — ${facts}` : facts, DESCRIPTION_MAX_LENGTH);
}
