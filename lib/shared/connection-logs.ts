/**
 * Journal des données de connexion — obligation légale de l'hébergeur.
 *
 * L'association héberge les contenus que ses membres publient (logos, avatars,
 * noms d'équipe) : à ce titre, elle conserve un an les données techniques de
 * connexion de leurs auteurs (LCEN, art. 6 ; décret n° 2021-1362), pour les
 * communiquer à une autorité judiciaire qui les requiert. C'est la seule
 * finalité de ce journal : **aucune route ne le lit**, il ne sert ni aux
 * statistiques, ni à la modération, ni au plafonnement des essais.
 *
 * Trois propriétés, tenues ailleurs mais décidées ici :
 * - une ligne par **ouverture de session** (`createSession`, point de passage
 *   unique des quatre portes d'entrée) — les contenus publiés n'ont pas de
 *   point de passage unique, ils ne sont donc pas journalisés à part : la
 *   connexion qui les précède identifie leur auteur ;
 * - la ligne **survit à la suppression du compte** jusqu'à son échéance (RGPD,
 *   art. 17.3.b) : `user_id` n'a volontairement aucune clé étrangère ;
 * - elle part au bout de {@link CONNECTION_LOG_RETENTION_DAYS} jours, par une
 *   purge entraînée par les connexions elles-mêmes.
 *
 * Module **pur** : la durée (citée par le registre), les évènements et la mise
 * en forme de l'adresse se testent sans base.
 */

/** Durée légale de conservation, en jours (un an). Citée par le registre. */
export const CONNECTION_LOG_RETENTION_DAYS = 365;

/**
 * Évènements journalisés : une ouverture de session, nommée par sa porte —
 * la seule chose qu'une réquisition demande en plus de l'adresse et de l'heure
 * est le moyen par lequel le compte a été atteint.
 */
export const CONNECTION_LOG_EVENTS = [
  "LOGIN_GOOGLE",
  "LOGIN_DISCORD",
  "LOGIN_BLIZZARD",
  "LOGIN_DISCORD_CODE",
] as const;

export type ConnectionLogEvent = (typeof CONNECTION_LOG_EVENTS)[number];

/** Longueur maximale d'une adresse IP écrite (IPv6 avec IPv4 embarquée). */
export const CONNECTION_LOG_IP_MAX_LENGTH = 45;

/**
 * Adresse à écrire au journal, ou `null` si elle n'est pas lisible comme une
 * adresse IP. La valeur vient de la chaîne des proxys de confiance
 * (`requestClientIp`), jamais d'un en-tête pris tel quel ; ce filtre n'en
 * garde pas moins que ce qui a la **forme** d'une adresse — un `X-Forwarded-For`
 * forgé plus long que prévu ne doit pas écrire un texte arbitraire en base.
 */
export function connectionLogIp(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value.length === 0 || value.length > CONNECTION_LOG_IP_MAX_LENGTH) return null;
  // IPv4, IPv6 (hexadécimal, `:` et `.` pour une IPv4 embarquée).
  if (!/^[0-9a-fA-F:.]+$/.test(value)) return null;
  if (!value.includes(".") && !value.includes(":")) return null;
  return value;
}
