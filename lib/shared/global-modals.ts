/**
 * Arbitrage des modales globales, rendues par la mise en page racine sur toutes
 * les pages : confidentialité, conditions d'utilisation, mise en avant du
 * recrutement.
 *
 * Règle : **deux modales ne se superposent pas.** Chacune a son `z-index`, et
 * celle du dessus masque celle du dessous sans la fermer — le visiteur répond à
 * l'une, découvre l'autre, et lit la seconde comme une réponse à la première.
 * L'ordre de priorité est celui du geste attendu : un choix de confidentialité,
 * puis l'acceptation des conditions, puis une annonce qu'on écarte.
 *
 * Module pur : la mise en page le rejoue côté serveur, la modale des conditions
 * côté client (elle suit la navigation, la mise en page n'étant pas re-rendue
 * d'un lien à l'autre).
 */
import { TERMS_PATH } from "@/lib/shared/terms-of-use";

/** Page de connexion : sa propre modale (consentement « Avant de continuer ») y passe d'abord. */
export const LOGIN_PATH = "/connexion";

/**
 * Ancien cookie de report « Plus tard » de la modale des conditions (douze
 * heures). Depuis la version 6 (2026-10-19), la modale est **bloquante** pour
 * tout compte connecté : plus aucun report n'est posé ni lu. Le nom reste
 * pour que connexion et déconnexion effacent un cookie déjà posé par un
 * navigateur (`lib/server/auth.ts`).
 */
export const TERMS_POSTPONED_COOKIE = "bg_terms_later";

/**
 * Pages où la fenêtre bloquante des conditions laisse passer, depuis la
 * version 6 (2026-10-19) : qui refuse les conditions doit encore pouvoir lire
 * la politique de confidentialité et les pages légales (celles du bot
 * comprises), exporter ses
 * données ou supprimer son compte (« Mon profil »), sans accepter d'abord.
 */
export const TERMS_FREE_PATHS: readonly string[] = [
  "/rgpd",
  "/mentions-legales",
  "/accessibilite",
  "/privacy-policy-bot",
  "/terms-of-service-bot",
  "/profil",
];

/**
 * Pages où la modale des conditions se tait : celle des conditions elle-même
 * (qu'elle invite à lire), la connexion, dont la modale de consentement doit
 * rester seule à l'écran, et les pages de {@link TERMS_FREE_PATHS} (et leurs
 * sous-pages, `/rgpd/registre` compris).
 */
export function termsModalSilencedOn(pathname: string | null | undefined): boolean {
  if (pathname === TERMS_PATH || pathname === LOGIN_PATH) return true;
  if (!pathname) return false;
  return TERMS_FREE_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * La modale des conditions s'ouvrira-t-elle d'elle-même au chargement de cette
 * page ? (Hors confidentialité : celle-ci la fait attendre sans l'annuler.)
 */
export function termsModalDueOnLoad(input: {
  termsRequired: boolean;
  pathname: string | null | undefined;
}): boolean {
  return input.termsRequired && !termsModalSilencedOn(input.pathname);
}

/**
 * La modale d'arrivée du recrutement doit-elle se taire ? Elle passe après
 * toute modale qui attend une réponse, et se tait sur la connexion (la modale
 * de consentement y est la seule à avoir sa place).
 */
export function recruitmentModalSilenced(input: {
  privacyPending: boolean;
  termsModalDue: boolean;
  pathname: string | null | undefined;
}): boolean {
  return input.privacyPending || input.termsModalDue || input.pathname === LOGIN_PATH;
}
