/**
 * Affectations SQL qui enregistrent un pseudo **nommé par Discord** — à la
 * connexion (`createOrGetDiscordUser`) ou au rattachement
 * (`linkOAuthIdentity`) —, **sans le certifier**.
 *
 * Se connecter est un acte d'authentification, pas un consentement à
 * l'exposition que porte la certification (`lib/shared/discord-identity.ts`) :
 * la connexion enregistre donc le dernier pseudo que Discord a donné et marque
 * son origine (`discord_pseudo_from_discord = 1`), ce qui permet ensuite de le
 * certifier d'un clic depuis `/profil` (`certifyLinkedDiscordTag`).
 *
 * Une certification déjà donnée **survit** tant que le pseudo ne change pas —
 * elle porte sur ce tag-là — et **tombe** s'il change, comme toute modification
 * du tag (`updateOwnProfile`) : le joueur a consenti à exposer un pseudo précis,
 * pas celui qu'il prendra demain. Le `CASE` précède l'affectation du pseudo,
 * MySQL évaluant de gauche à droite ; `<=>` parce que l'ancien peut être `NULL`.
 *
 * Module à part, et non une constante de `users-service` : les deux écrivains
 * vivent dans deux modules, et les tests qui simulent l'un ne doivent pas
 * rendre l'autre silencieusement faux (une constante absente d'un bouchon
 * s'interpole en `undefined` dans la requête).
 *
 * Deux paramètres, tous deux le pseudo normalisé.
 */
export const DISCORD_NAMED_PSEUDO_SQL = `discord_verified_at = CASE
             WHEN discord_pseudo <=> ? THEN discord_verified_at ELSE NULL END,
           discord_pseudo = ?,
           discord_pseudo_from_discord = 1`;
