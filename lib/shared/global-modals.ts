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
 * Cookie posé par « Plus tard » sur la modale des conditions : sans lui, le
 * report ne vivait que dans l'état React et la modale revenait à chaque
 * chargement complet (F5, nouvel onglet, lien ouvert depuis Discord). Il ne
 * contient que `1`, aucun identifiant ; il dure au plus
 * {@link TERMS_POSTPONED_MAX_AGE_SECONDS}, tombe à chaque connexion et
 * déconnexion, et un geste de gestion refusé rouvre la modale malgré lui.
 */
export const TERMS_POSTPONED_COOKIE = "bg_terms_later";

/**
 * Durée du report : douze heures. Un cookie de session sans `max-age` ne
 * « disparaît à la fermeture du navigateur » que si la restauration de session
 * est coupée — activée, il revient au redémarrage et le report tiendrait tant
 * que dure la session du site (30 jours). La durée est donc posée, pas espérée.
 */
export const TERMS_POSTPONED_MAX_AGE_SECONDS = 12 * 60 * 60;

/** Valeur unique du cookie de report. */
export const TERMS_POSTPONED_VALUE = "1";

/** Le cookie de report est-il posé ? */
export function isTermsPostponed(cookieValue: string | undefined): boolean {
  return cookieValue === TERMS_POSTPONED_VALUE;
}

/**
 * Pages où la modale des conditions se tait : celle des conditions elle-même
 * (qu'elle invite à lire) et la connexion, dont la modale de consentement doit
 * rester seule à l'écran.
 */
export function termsModalSilencedOn(pathname: string | null | undefined): boolean {
  return pathname === TERMS_PATH || pathname === LOGIN_PATH;
}

/**
 * La modale des conditions s'ouvrira-t-elle d'elle-même au chargement de cette
 * page ? (Hors confidentialité : celle-ci la fait attendre sans l'annuler.)
 */
export function termsModalDueOnLoad(input: {
  termsRequired: boolean;
  postponed: boolean;
  pathname: string | null | undefined;
}): boolean {
  return input.termsRequired && !input.postponed && !termsModalSilencedOn(input.pathname);
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
