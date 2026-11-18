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
  injoignable (`BOT_INTERNAL_UNREACHABLE`, 503), trop de tests en cours sur le site
  (`DISCORD_DM_TEST_BUSY`, 503, toast `busy`), trop d'essais (`TOO_MANY_REQUESTS`,
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
- Requêtes en vol : quand le joueur quitte la page, la route cesse d'attendre
  (`REQUEST_ABORTED`) mais l'appel au bot (15 s au plus) **n'est pas** interrompu — le
  bot, qui a reçu la demande, travaille encore ; la place en vol reste prise jusqu'à sa
  réponse ou son délai. Au plus `DM_TEST_MAX_IN_FLIGHT` (8) tests en cours côté bot,
  tous comptes confondus — au-delà `DISCORD_DM_TEST_BUSY` (503, places rendues, toast
  « trop de tests en cours sur le site »). Joueur parti avant l'appel : rien n'est
  demandé au bot. Le bouton abandonne sa requête au démontage.
- Coupe-circuit : le test l'ignore (`honourCircuit: false`) et, réussi, **ne le referme
  pas** s'il est ouvert — un clic ne relance pas les flux d'arrière-plan vers un bot en
  panne partielle ; ouvert ou fermé, son succès remet la série d'échecs à zéro comme tout
  autre (`recordBypassSuccess`) : des échecs suivis d'un succès ne sont plus « d'affilée ».
  Vaut aussi pour les alertes arbitres et dirigeants.
- Plafonds, en mémoire du processus, contrôlés et décomptés en une instruction avant tout
  `await` :
  - par compte, **3 essais par heure** (`reserveDmTestTry`), **vraie fenêtre glissante** :
    l'heure de chaque essai décompté est gardée et un essai n'est accepté que si moins de 3
    datent de la dernière heure — aucune heure glissante n'en porte plus de 3 ; refus 429
    `TOO_MANY_REQUESTS` avec `Retry-After` (sortie du plus ancien essai). Un essai rendu est
    retiré, une fois au plus, sans rien repousser. Le compte est effacé une heure après son
    dernier essai décompté : **un** minuteur détaché par compte, réarmé sur le dernier
    essai (rendu compris), qui efface le compte **sans condition** à l'échéance — une
    horloge qui recule ne le garde pas. Au-delà de `DM_TEST_MAX_TRACKED_ACCOUNTS` comptes
    suivis : purge par la tête (table rangée par dernier essai, arrêt au premier actif),
    puis `DISCORD_DM_TEST_BUSY` ;
  - `DISCORD_DM_TEST_GLOBAL_RULE`, seau à jetons tous comptes confondus (30 d'un coup, puis
    un toutes les 30 s) : chaque test non remis écrit une ligne au journal du staff ; un test
    remis (`SENT`) rend son jeton, **même** remis après que la route a cessé d'attendre
    (`onLateOutcome` de `sendDiscordDmTest`) — vide : `DISCORD_DM_TEST_BUSY` (place du
    compte rendue) ;
  - `DISCORD_DM_TEST_VOLUME_RULE`, seau à jetons tous comptes confondus (60 d'un coup, puis
    un toutes les 10 s, 360 par heure au plus) : **tous** les tests demandés au bot, remis
    compris — seul un test où rien n'est parti rend son jeton. Borne le volume de messages
    privés du bot pour ce bouton quel que soit le nombre de comptes — vide :
    `DISCORD_DM_TEST_BUSY` (place du compte et jeton du journal rendus) ;
  - `DISCORD_DM_TEST_ATTEMPT_RULE`, 30 appels par heure et par compte, refus compris,
    jamais rendu : borne la boucle de refus rendus. Seau plein (`overflow: "refuse"`) : les
    plafonds en cours sont gardés, un compte sans fenêtre ouverte reçoit
    `DISCORD_DM_TEST_BUSY` (jamais un 429 faux).
  Une erreur `DmTestError` dit si rien n'est parti (`nothingSent`) : non lié, non
  certifié, compte absent, lecture du compte en échec, occupé, joueur parti avant
  l'appel → places rendues ; bot injoignable, bilan illisible, joueur parti pendant
  l'appel → gardées (on ne martèle pas un bot tombé).
- **En mémoire, pas en base** (écart assumé à la règle de `CLAUDE.md` « un quota se
  réserve en une instruction (`UPDATE … WHERE attempts < ?` + `affectedRows`) ») : la
  règle vise ce qu'elle interdit — lire puis écrire de part et d'autre d'un `await`, qui
  laisse passer deux requêtes simultanées. Ici le contrôle et le décompte sont **une seule
  instruction synchrone** (`reserveDmTestTry`, aucun `await`) dans un processus unique
  (pm2, une instance) : la course est fermée de la même façon. Ce plafond ne protège ni un
  secret ni une connexion (rien à deviner, le message ne part qu'au compte lui-même) ; le
  passer en base ajouterait un stockage de données personnelles (numéro de compte, heures
  des essais) à déclarer et à purger, pour un garde-fou contre la rafale.
- **Redémarrage** : ces plafonds vivent en mémoire ; un redémarrage du site (déploiement,
  `pm2 restart`) les remet à zéro — un compte peut alors refaire jusqu'à 3 essais. Accepté :
  c'est un garde-fou contre la rafale, pas une promesse faite au joueur, et rien n'est
  écrit en base. Le numéro du compte n'est gardé que 61 minutes au plus après son dernier
  essai (registre T04, `/rgpd#test-messages-prives`).
- Provenance vérifiée par la route elle-même en première instruction
  (`rejectCrossSiteRequest` avec `requireJson`, en plus du middleware : 403
  `CROSS_SITE_REQUEST`, 415 sans corps JSON — ferme le formulaire forgé d'un navigateur
  qui n'envoie ni `Sec-Fetch-Site` ni `Origin`) ; refus = code seul.
- La case « Messages privés Discord de mes matchs » ne s'applique pas : le test est
  demandé par le joueur lui-même.

## RGPD

Registre **T04** (sous-finalité, conservation, sécurité ; `REGISTER_UPDATED_AT`),
`/rgpd#test-messages-prives` (FR et EN), entrée `2026-11-test-messages-prives` de
`PRIVACY_CHANGES` (FR et EN). Rien n'est écrit en base ; le numéro de compte du
plafond vit en mémoire, 61 minutes au plus après le dernier essai.

## Tests

`tests/lib/shared/discord-dm-test.test.ts`, `tests/lib/server/discord-dm-test.test.ts`,
`tests/app/api/profile/discord-dm-test-route.test.ts`,
`tests/app/profil-dm-test-button.test.tsx`.
