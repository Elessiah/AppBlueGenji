# Langue des messages privés Discord (BOT-NOTIF-LANG)

Règle de l'association : un message privé Discord adressé à **une personne** part
dans la langue de son compte du site (`bg_users.locale`) quand elle est connue,
sinon en **un seul** message bilingue — le français, puis le séparateur
`**— English —**`, puis l'anglais. Les messages de **salon** (#live, canal de
logs, salons du staff) restent en français (D6, `I18N.md`). Les règles de vie
privée ne changent pas (`RGPD_LOGS_AND_VISITS.md`) : aucun pseudo ni `#id` de
joueur, texte utilisateur par `discordInline` / `discordQuote`, dans les deux
langues.

## Qui rédige quoi

| Message privé | Rédigé par | Langue |
| --- | --- | --- |
| Rappels de match, annonce / retrait d'horaire, « Match retiré » (`discord-notifications.ts`) | site | compte |
| Suspension et levée (`account-suspension.ts`) | site | compte |
| Signalement qui vise le joueur ou son équipe (`formatTargetNotice`) | site | compte |
| Demande d'adhésion à une équipe (`team-join-request-notice.ts`) | site | compte |
| Logo / avatar masqué, supprimé, rétabli (`logo-quarantine.ts`) | site | compte |
| Changements de la politique de données (`buildPrivacyChangesMessage`) | site | compte |
| Code de connexion / certification du tag | **bot**, sur la `locale` transmise | compte, bilingue sans compte |
| Alertes aux arbitres et à la direction (`OWNER_ID`, `PRESIDENT`) | site (`staffAlertDm`) | bilingue |
| Messages propres au bot à un membre (papiers d'adhésion par défaut, adhésion validée / périmée par défaut, avis d'exclusion du relais) | bot | bilingue ; un texte saisi par le staff part tel quel |
| Retours du bot à l'auteur d'une commande (copie des papiers, avis de remise, rappels refusés) | bot | français — retour d'opérateur (décision requise pour les traduire) |
| Relais `contactAdminServer` (message d'un administrateur à un autre) | bot | tel qu'écrit par son auteur |
| Diagnostics au titulaire du bot (repli du canal de logs, sauvegardes, assistant d'installation, ménage des journaux) | bot | français — journaux d'exploitation, pas des messages à un joueur |

**Site.** Chaque message privé est une fonction de la langue (`LocalizedDm`,
`lib/shared/dm-language.ts`). `notifyUsers` lit `bg_users.locale` des
destinataires en **une** requête, les groupe par langue et fait **un appel**
`/internal/notify/dm` par groupe : le contrat du bot ne change pas. Les groupes
partent **l'un après l'autre** et un appel perdu arrête les suivants : un bot
tombé ne reçoit qu'un appel par notification, et le coupe-circuit (3 échecs)
ne s'ouvre pas sur un seul match. Lecture
impossible ou compte absent → groupe `null`, message bilingue (`renderDm`). Un
appel perdu nomme ses comptes et ceux des langues non tentées (`discordUnreachedUserIds`) :
l'annonce des changements de politique ne marque « annoncé » que les comptes
remis. Les liens du site passent par `localizedSiteUrl` (`/en/…` sur une page
traduite). Dates : fuseau de Paris, `fr-FR` / `en-US` en 24 h.

**Staff.** Le bot trouve lui-même les arbitres (rôle de chaque serveur) et la
direction : le site ne connaît pas leur compte. `pushRefereeAlert` /
`pushLeadershipAlert` envoient `message` (ligne française du canal de logs,
inchangée) et `dmMessage` : cette ligne, le séparateur, puis le push anglais du
même évènement (`push-messages.ts`, une rédaction par langue) et son lien. Le
texte libre d'un joueur (signalement) n'est que dans la partie française.

**Code de connexion.** `sendDiscordLoginCode(discordId, code, locale)` transmet
la langue : celle du compte rattaché à ce Discord pour la connexion
(`accountLocaleForDiscordId`), celle du compte qui demande pour la
certification ou le changement de tag (`accountLocaleOf`).

## Ce que vaut une `locale` absente

Côté bot (`src/notifications/dmLanguage.ts`, `parseDmLocale`) : seules `"fr"` et
`"en"` comptent ; absente, `null` ou autre valeur → message **bilingue**. Côté
site : `null` = compte inconnu (ou supprimé) ou lecture en échec → bilingue,
jamais d'envoi perdu pour autant.

## Compatibilité et déploiement

**Bot d'abord, puis site.** Ancien bot + nouveau site : `locale` et `dmMessage`
ignorés — code en français, messages privés du staff = la ligne française
(comportement d'avant). Nouveau bot + ancien site : pas de `locale` → code
bilingue ; pas de `dmMessage` → `message`, comme avant. Les messages rédigés par
le site arrivent dans la langue du compte dès le déploiement du site.

## Longueur

Le bot coupe au-delà de 1 800 caractères (`MAX_MESSAGE_LENGTH`). Un message
bilingue qui ne tiendrait pas part **en français seul**, entier
(`bilingualDm`, `DM_MAX_LENGTH`) plutôt qu'un anglais tronqué. L'annonce des
changements de politique choisit un lot qui tient **dans les deux langues**
(`privacyChangesForOneMessage(…, english)`).

## Tests

`tests/lib/shared/dm-language.test.ts` (chaque rédacteur en FR, EN ; bilingue,
plafond, liens), `tests/lib/server/notify.test.ts` (groupes par langue, repli
bilingue, appel perdu), `issue-reports`, `referee-alerts-routing`,
`content-reports` (`dmMessage` bilingue, canal français, aucun pseudo),
`bot-integration` (corps envoyés), routes de code de connexion. Côté bot :
`src/tests/notifications/dmLanguage.test.ts`, `routes.test.ts`,
`notifications.test.ts`, `deliver.test.ts`.
