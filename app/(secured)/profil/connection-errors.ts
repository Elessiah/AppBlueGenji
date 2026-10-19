/**
 * Les refus du rattachement et du retrait d'un moyen de connexion, dits dans
 * la langue de la page.
 *
 * Même forme que `discord-errors.ts` et `app/connexion/_lib/login-errors.ts` —
 * registre pur, testable, repli qui ne laisse jamais sortir un jeton en
 * capitales. Distinct des deux autres parce que les consignes diffèrent : ici le
 * joueur est **déjà connecté**, il n'y a donc jamais lieu de lui proposer une
 * autre porte d'entrée, seulement de lui dire quel geste lève le refus.
 *
 * `LAST_CONNECTION` a le sien dans le module pur
 * (`connectionUnlinkRefusalMessage`, et sa sœur `connectionRefusalText`), qui
 * sait de quel fournisseur on parle : l'écran s'en sert pour griser le bouton
 * **avant** le clic. La ligne de la table ne couvre que le cas où le serveur
 * refuse un geste que l'écran croyait permis — deux onglets ouverts, par
 * exemple.
 *
 * Phrases dans l'espace `profile` (`connections.*`, lot 9-2) ; texte de la
 * langue en dernier argument, français par défaut.
 */
import { OAUTH_PROVIDER_LABELS, type OAuthProvider } from "@/lib/shared/oauth-providers";
import { FR_PROFILE, lookupCode, type ProfileText } from "./_lib/profile-text";

export function connectionErrorMessage(code: string | null | undefined, text: ProfileText = FR_PROFILE): string {
  return lookupCode(text, "connections.errors", code) ?? text.t("connections.fallback");
}

/**
 * La phrase du retour réussi d'un aller-retour de rattachement.
 *
 * Deux cas, parce que le même retour couvre deux gestes : **ajouter** une
 * application, et **reconfirmer** celle qui l'était déjà — c'est le chemin par
 * lequel un compte relié à Discord fait nommer son pseudo, qu'il certifie
 * ensuite d'un clic. Annoncer « rattaché » à qui l'était déjà décrirait un
 * changement qui n'a pas eu lieu.
 */
export function connectionSuccessMessage(
  provider: OAuthProvider | null,
  refreshed: boolean,
  text: ProfileText = FR_PROFILE,
): string {
  const { t } = text;
  if (!provider) return refreshed ? t("connections.success.refreshedAny") : t("connections.success.linkedAny");
  const label = OAUTH_PROVIDER_LABELS[provider];
  // Rattacher Discord ne certifie pas le tag : sans « Certifier mon tag »,
  // aucun message privé de match (portée `certified`) — le toast le rappelle.
  if (!refreshed) {
    const linked = t("connections.success.linked", { label });
    return provider === "DISCORD" ? `${linked} ${t("botHandle.certifyForDms")}` : linked;
  }
  return provider === "DISCORD" ? t("connections.success.refreshedDiscord") : t("connections.success.refreshed", { label });
}

/**
 * Ce que dit la ligne « Sessions ouvertes » : combien d'autres navigateurs ou
 * appareils ouvrent encore le compte. `null` = pas encore lu (ou illisible), et
 * la phrase ne l'invente pas.
 */
export function otherSessionsSummary(count: number | null, text: ProfileText = FR_PROFILE): string {
  if (count === null) return text.t("connections.sessions.unknown");
  if (count === 0) return text.t("connections.sessions.none");
  return text.t("connections.sessions.open", { count });
}

/** Le compte rendu de « Déconnecter mes autres sessions ». */
export function sessionsRevokedMessage(count: number, text: ProfileText = FR_PROFILE): string {
  if (count === 0) return text.t("connections.sessions.revokedNone");
  return text.t("connections.sessions.revoked", { count });
}

/**
 * Le compte rendu d'un retrait réussi.
 *
 * Le retrait ferme les autres sessions du compte (réflexe de qui croit la
 * porte compromise) : la phrase le dit, et **ne tait pas un échec** —
 * `revoked` à `null` renvoie au bouton qui refait le geste, puisque le
 * retrait lui-même est acquis.
 */
export function unlinkSuccessMessage(provider: OAuthProvider, revoked: number | null, text: ProfileText = FR_PROFILE): string {
  const unlinked = text.t("connections.unlinked", { label: OAUTH_PROVIDER_LABELS[provider] });
  // Détacher Discord retire la certification, donc les messages privés de match.
  const removed = provider === "DISCORD" ? `${unlinked} ${text.t("botHandle.matchDms")}` : unlinked;
  if (revoked === null) return text.t("connections.unlinkedSessionsFailed", { removed });
  if (revoked === 0) return removed;
  return `${removed} ${sessionsRevokedMessage(revoked, text)}`;
}
