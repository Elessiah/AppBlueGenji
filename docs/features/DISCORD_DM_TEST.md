# « Tester mes MP » — message privé de test depuis « Mon profil »

> `lib/shared/discord-dm-test.ts` (pur) · `lib/server/discord-dm-test.ts` ·
> `POST /api/profile/discord/dm-test` ·
> `app/(secured)/profil/_components/DiscordDmTestButton.tsx`

## Le besoin

Un joueur ne sait pas, avant son premier match, si le bot peut lui écrire : messages
privés fermés aux membres du serveur, serveur BlueGenji quitté, bot bloqué. Il
l'apprend en manquant un rappel ou un check-in.

## Le geste

Sous le champ « Pseudo Discord » (section « Identités de jeu et comptes liés »),
le bouton **« Tester mes MP »** (EN « Test my DMs », `BusyButton` + `useBusyGuard`,
libellé accessible « Tester mes MP (messages privés Discord) », aide derrière un « i »).
Absent tant que l'état Discord n'est pas lu.

- **Tag certifié** : `POST /api/profile/discord/dm-test`, puis une notification :
  remis (`SENT`, succès), messages privés fermés (`DMS_CLOSED`), absent du serveur
  BlueGenji (`NOT_IN_SERVER`), aucun Discord lié (`DISCORD_NOT_LINKED`), bot
  injoignable (`BOT_INTERNAL_UNREACHABLE`, 503), trop d'essais (`TOO_MANY_REQUESTS`,
  429), autre échec (`DISCORD_DM_TEST_FAILED`).
- **Tag non certifié** (ou `DISCORD_NOT_CERTIFIED` rendu par la route, état changé
  sous l'écran) : rien ne part ; une modale (`ConfirmActionDialog`, ton `primary`)
  dit que sans certification le bot n'envoie aucun message de match, et pourquoi
  certifier, avec **« Certifier mon tag »** et « Annuler ». « Certifier mon tag »
  appelle **le même geste** que le bouton « Certifier » de la ligne Discord des comptes
  liés : `openVerifyDialog` de la page (`DiscordVerificationDialog`), aucune logique de
  certification nouvelle. La modale est enveloppée d'un `onSubmit` arrêté : portée
  dans `<body>`, sa soumission remonterait sinon par l'arbre React jusqu'au
  formulaire du profil.

## Côté serveur

- Destinataire unique : le `discord_id` **rattaché** au compte connecté (jamais un tag
  saisi, jamais un autre compte), exigé certifié (`discord_verified_at`), compte non
  supprimé (`PROFILE_NOT_FOUND` sinon).
- Canal : `pushDiscordDirectMessages` → `POST /internal/notify/dm` du bot, **existant** —
  aucune route ni changement côté bot. Le bot ne cherche le membre que sur le serveur
  BlueGenji : `unresolved` = absent du serveur, `failed` = Discord refuse (messages
  privés fermés), `sent` = remis (`dmTestOutcome`). Contexte `dm-test` : un essai qui
  n'aboutit pas est compté au journal du staff (« 0 envoyé(s), 1 introuvable(s)… »),
  sans identifiant. Le coupe-circuit du bot s'applique (bot tombé : réponse immédiate).
- Texte : court, neutre, sans lien ni nom, dans la langue du compte (bilingue si la
  colonne `locale` manque) — `DM_TEST_MESSAGE`, `renderDm` (`BOT_DM_LANGUAGE.md`).
  Ce n'est pas une notification (`notifyUsers`) : aucun push, le joueur attend
  l'issue précise.
- Plafond : `DISCORD_DM_TEST_RULE`, **3 essais par heure et par compte**, en mémoire,
  réservé en une instruction (`reserveRateLimit`) avant tout `await`. Rendu sur un refus
  où rien n'est parti (non lié, non certifié, compte absent) ; gardé quand le bot est
  injoignable (on ne martèle pas un bot tombé).
- Provenance vérifiée par le middleware (403 `CROSS_SITE_REQUEST`) ; refus = code seul.
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
