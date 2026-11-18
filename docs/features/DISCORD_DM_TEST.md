# « Tester mes MP » — message privé de test depuis « Mon profil »

> `lib/shared/discord-dm-test.ts` (pur) · `lib/server/discord-dm-test.ts` ·
> `POST /api/profile/discord/dm-test` ·
> `app/(secured)/profil/_components/DiscordDmTestButton.tsx`

## Le besoin

Un joueur ne sait pas, avant son premier match, si le bot peut lui écrire : messages
privés fermés aux membres du serveur, serveur BlueGenji quitté, bot bloqué. Il
l'apprend en manquant un rappel ou un check-in.

## Le geste

Sous le champ « Pseudo Discord » (section « Identités de jeu et comptes liés »), **dans
la même rangée** que les gestes Discord du champ (« Retirer mon tag » ou « Certifier »),
le bouton **« Tester mes MP »** (EN « Test my DMs », `BusyButton` + `useBusyGuard`,
libellé accessible « Tester mes MP (messages privés Discord) »). Le composant rend un
fragment : la page pose la rangée. Pendant l'envoi le libellé devient « Envoi… » (largeur
réservée `.dmTestButton`, le « i » voisin ne bouge pas) et une région `role="status"`
`sr-only` l'annonce. L'aide derrière le « i » dit le plafond et porte le lien
d'invitation du serveur (`DiscordInviteLink`), que la notification « absent du serveur »
désigne. Absent tant que l'état Discord n'est pas lu.

- **Tag certifié** : `POST /api/profile/discord/dm-test`, puis une notification :
  remis (`SENT`, succès), messages privés fermés (`DMS_CLOSED`), absent du serveur
  BlueGenji (`NOT_IN_SERVER`), aucun Discord lié (`DISCORD_NOT_LINKED`), bot
  injoignable (`BOT_INTERNAL_UNREACHABLE`, 503), trop d'essais (`TOO_MANY_REQUESTS`,
  429, plafond annoncé et « réessaie dans une heure »), autre échec ou réponse illisible
  côté navigateur (`failed` : le résultat est inconnu, le message a pu partir — le texte
  invite à regarder ses messages privés avant de relancer) (`DISCORD_DM_TEST_FAILED`). Sans Discord lié (`linked` faux), le bouton
  n'est pas rendu ; l'astuce lit le plafond dans `DM_TEST_HOURLY_LIMIT`.
- **Tag non certifié** (ou `DISCORD_NOT_CERTIFIED` rendu par la route, état changé
  sous l'écran : la page relit alors l'état Discord, `onNotCertified`) : rien ne part ;
  une modale (`ConfirmActionDialog`, ton `primary`, un seul paragraphe) dit que sans
  certification le bot n'envoie aucun message de match, avec **« Certifier mon tag »** et
  « Annuler ». « Certifier mon tag » appelle **le même geste** que le bouton « Certifier »
  de la ligne Discord des comptes liés et le bouton « Certifier » du champ :
  `openVerifyDialog` de la page (`DiscordVerificationDialog`), aucune logique de
  certification nouvelle. `ConfirmActionDialog` arrête lui-même la propagation de sa
  soumission : portée dans `<body>`, elle remonterait sinon par l'arbre React jusqu'au
  formulaire du profil et l'enregistrerait.

## Côté serveur

- Destinataire unique : le `discord_id` **rattaché** au compte connecté (jamais un tag
  saisi, jamais un autre compte), exigé certifié (`discord_verified_at`), compte non
  supprimé (`PROFILE_NOT_FOUND` sinon).
- Canal : `pushDiscordDirectMessages` → `POST /internal/notify/dm` du bot, **existant** —
  aucune route ni changement côté bot. Le bot ne cherche le membre que sur le serveur
  BlueGenji : `unresolved` = absent du serveur (le bot range aussi là un membre
  qu'une erreur passagère de Discord l'a empêché de lire : le texte invite alors à
  réessayer), `failed` = Discord refuse (messages privés fermés), `sent` = remis
  (`dmTestOutcome`) ; un bilan vide ou illisible (champ absent ou non tableau) rend
  `DISCORD_DM_TEST_FAILED` (500). Contexte `dm-test` : un essai qui
  n'aboutit pas est compté au journal du staff (« 0 envoyé(s), 1 introuvable(s)… »),
  sans identifiant. Le coupe-circuit des flux d'arrière-plan **ne s'applique pas**
  (`honourCircuit: false`, comme `pushRefereeAlert`) : geste explicite, il mérite sa
  tentative même juste après une panne. Délai 15 s : un bot trop lent rend 503, le
  message pouvant arriver après coup (le texte le dit).
- Texte : court, neutre, sans lien ni nom, dans la langue du compte (bilingue si la
  colonne `locale` manque) — `DM_TEST_MESSAGE`, `renderDm` (`BOT_DM_LANGUAGE.md`).
  Ce n'est pas une notification (`notifyUsers`) : aucun push, le joueur attend
  l'issue précise.
- Requêtes en vol : l'appel au bot (15 s au plus) est abandonné quand le joueur quitte la page (`req.signal` → `AbortSignal.any`, sans compter une panne du bot) ; au plus `DM_TEST_MAX_IN_FLIGHT` (8) tests attendent le bot à la fois, tous comptes confondus — au-delà `DISCORD_DM_TEST_BUSY` (503, place rendue, toast « bot injoignable »). Le bouton abandonne sa requête au démontage.
- Plafond : `DISCORD_DM_TEST_RULE`, **3 essais par heure et par compte**, en mémoire,
  réservé en une instruction (`reserveRateLimit`) avant tout `await`. Rendu sur un refus
  où rien n'est parti (non lié, non certifié, compte absent) ; gardé quand le bot est
  injoignable (on ne martèle pas un bot tombé).
- Provenance vérifiée par la route elle-même en première instruction
  (`rejectCrossSiteRequest`, en plus du middleware : 403 `CROSS_SITE_REQUEST`) ; refus =
  code seul.
- La case « Messages privés Discord de mes matchs » ne s'applique pas : le test est
  demandé par le joueur lui-même.

## RGPD

Registre **T04** (sous-finalité, conservation, sécurité ; `REGISTER_UPDATED_AT`),
`/rgpd#test-messages-prives` (FR et EN), entrée `2026-11-test-messages-prives` de
`PRIVACY_CHANGES` (FR et EN). Rien n'est écrit en base ; le numéro de compte du
plafond vit en mémoire, 61 minutes au plus.

## Tests

`tests/lib/shared/discord-dm-test.test.ts`, `tests/lib/server/discord-dm-test.test.ts`,
`tests/app/api/profile/discord-dm-test-route.test.ts`,
`tests/app/profil-dm-test-button.test.tsx`.
