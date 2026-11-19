# Incarner un rôle (administrateurs)

Un **administrateur** (colonne `is_admin`) réduit **temporairement** les droits
de sa session à exactement les rôles de plateforme qu'il choisit, pour voir le
site comme les verrait un arbitre, un caster, une prod… — ou, sans rôle, comme
un joueur (« vue joueur », la version #627 de cette fonctionnalité) :
« Incarner un rôle » dans le menu du compte ouvre la modale du choix,
« Revenir en vue admin » (bannière affichée sur toutes les pages, et menu du
compte) rend tous les droits.

Seul un administrateur incarne : il tient déjà tous les droits, l'incarnation
ne fait que les **réduire**. Un autre titulaire d'un rôle de plateforme n'a
plus la bascule (décision du 2026-11-19 ; avant, la vue joueur était ouverte à
tous) ; une vue joueur qu'il aurait encore posée n'a plus d'effet
(`canImpersonate` lu dans `fromRow`), ses droits sont entiers.

## Les rôles incarnables

`IMPERSONABLE_ROLES` (`lib/shared/player-view.ts`) : tous les rôles de
plateforme sauf `ADMIN` — `ARBITRE`, `CASTER`, `PROD`, `COMMUNITY_MANAGER`,
`RECRUTEUR`, `DEV`, cumulables. Aucun rôle : vue joueur. Les rôles d'équipe ne
sont pas concernés.

## Où vit le drapeau

- **Sur la session**, côté serveur : `bg_user_sessions.player_view_until`
  (`DATETIME NULL`, l'échéance) et `bg_user_sessions.impersonated_roles_json`
  (`VARCHAR(255) NULL`, les rôles incarnés en JSON, `[]` pour la vue joueur),
  tous deux dans le `CREATE TABLE` et en `ALTER` tolérant de
  `RECENT_SCHEMA_CHANGES`. Jamais un cookie ni un état du client : rien que le
  navigateur puisse forger. Les rôles sont relus par `parseImpersonatedRoles`
  (rôles connus, `ADMIN` écarté) : une valeur illisible vaut « aucun rôle »,
  jamais plus de droits.
- **Par session** : les autres appareils du compte gardent leurs droits.
- **Échéance** : `PLAYER_VIEW_MAX_HOURS` (12 h, `lib/shared/player-view.ts`)
  après la bascule. La lecture de la session compare l'échéance à `NOW()` :
  passé ce délai, les droits reviennent d'eux-mêmes, sans tâche planifiée.
  La ligne part avec la session (déconnexion, révocation, purge, suppression).

## Un seul point d'application

`getCurrentUser()` (`lib/server/auth.ts`, `fromRow`) lit les colonnes avec la
session et, quand l'échéance est dans le futur (et que le compte est
administrateur), rend `isAdmin: false` et `roles` = **les rôles incarnés**
(`sessionPlatformRights`). Tout ce qui décide d'un droit lit ces deux champs —
`can()`, `canAny()`, `isStaffMember()`, `canComputePlanning()`, les tests
directs de `user.isAdmin` (suppression d'un tournoi, annulation d'un abandon)
— si bien que **aucune route n'a à y penser** : un administrateur qui incarne
`CASTER` a `casting`, `live` et `planning` et rien d'autre (routes
`app/api/admin/*` en 403, pas de « Signalements »), `TournamentViewerContext`
ne porte que les champs de ces permissions (flux et REST de secours, même
contexte), `GET /api/auth/me` rend ces rôles. En vue joueur : aucun droit,
palier SSE ordinaire, barre sans « Signalements » ni « Documentation dev »,
`/devdoc` fermé, sections staff de `/bot` et `/bot/docs` masquées.

Le contournement de développement (`DEV_AUTH_BYPASS.md`) suit la même règle :
sans session, une ligne dédiée de `bg_user_sessions` (`devBypassSessionKey`)
porte l'échéance.

Si l'une des deux colonnes manque (son `ALTER` a échoué), la lecture se
rejoue sans elles : aucune session n'incarne alors de rôle, les droits restent
entiers ; la bascule, elle, échoue (`500 PLAYER_VIEW_FAILED`).

## Ce qui reste au compte pendant l'incarnation

- **Ses rôles d'équipe** (`OWNER`, `MANAGER`, `CAPITAINE`…) : ce ne sont pas
  des droits de plateforme ; il inscrit, gère et joue comme tout joueur.
- **Le retour**, et rien d'autre d'administrateur. `AuthUser.playerViewAvailable`
  (administrateur **réel**, incarnation ou non) ouvre seul la bascule ; aucun
  `can()` ne le lit.
- **Ses casts et arbitrages désignés restent en base**, mais la session ne les
  tient que si les rôles incarnés ouvrent leur permission (`sessionHolds` :
  `live` pour un cast, `tournaments` pour un arbitrage ; vue joueur : aucun).
  Sinon la modale de lancement et « Contacts » ne lui présentent que ses
  matchs de joueur (`viewerRole`, `casterContactsRole`), le « Prêt » d'un
  caster ou d'un arbitre est refusé (`NOT_MATCH_PARTY`), et les routes de cast
  et le retrait d'arbitrage répondent `403 FORBIDDEN`. La résolution de la
  partie du match (`resolveMatchParty`, qui lit l'éligibilité en base) prend
  **obligatoirement** l'état de la session (`PartySession` = `SessionRights`,
  `{ playerView, roles }`, requis aussi par `setMatchReady` ; et `LaunchViewer`
  côté lancement et contacts) : un nouvel appelant qui l'oublie ne compile
  pas, et des rôles absents valent « aucun » (refus, jamais ouverture).
  Revenir en vue admin les lui rend tels quels.
- Les notifications push staff suivent le **compte** (abonnement de
  l'appareil), pas la session : elles continuent d'arriver.

## La bascule — `POST /api/auth/player-view`

- Corps `{ active: boolean, roles?: PlatformRole[] }` (JSON, 32 Kio au plus) ;
  `roles` à l'entrée seulement (absent ou vide : vue joueur) ; provenance
  vérifiée en première instruction (`403 CROSS_SITE_REQUEST`, `415` hors JSON).
- `401 UNAUTHORIZED` sans session ; `403 FORBIDDEN` pour un compte qui n'est
  pas réellement administrateur ; `400 INVALID_PLAYER_VIEW` pour un corps sans
  booléen, un rôle inconnu, `ADMIN`, plus de seize entrées ou `roles` au
  retour (`parsePlayerViewBody`, refus jamais ignoré) ; `429` au-delà de dix
  bascules par minute et par compte (`PLAYER_VIEW_TOGGLE_RULE`) ;
  `500 PLAYER_VIEW_FAILED` sur une panne. Réponse `{ playerView, until, roles }`,
  tirés de l'état **relu** (`playerView` = `until !== null`).
- `setPlayerView` (`lib/server/player-view.ts`) écrit l'échéance et les rôles
  (ou `NULL`) sur la ligne de **cette** session, **seulement si l'état
  change** (écriture conditionnée en une instruction) : redemander une
  incarnation ne repousse pas l'échéance ni ne change les rôles (revenir, puis
  choisir à nouveau), quitter une incarnation absente n'écrit ni ne journalise
  rien.
  `until` est relu en base (`toIso`), jamais recalculé sur l'horloge du
  serveur d'application.
- Un changement fait reconnecter les flux SSE de la session
  (`reconnectSessionStreams`, motif `RECONNECT` : la route relit le contexte
  du lecteur, sans refus). Il laisse aussi une trace datée par le repère des
  révocations : un flux qui lisait la session pendant la bascule la retrouve
  (`reconnectRequestedSince`) et répond la seule demande de reconnexion
  (`{"type":"reconnect"}`, `lib/shared/stream-reconnect.ts`), **sans trame
  d'ouverture** (aucun contexte staff servi). Un flux ouvert reçoit la même
  trame avant sa fermeture. Le client rouvre sur-le-champ, sans témoin « Hors
  ligne » ni sondage de secours ; une seconde demande sans ouverture entre
  les deux passe par l'attente croissante. Les traces sont bornées **par
  compte** (`RECONNECT_MEMORY_PER_USER` = 20, le double du débit permis) :
  les bascules d'un compte ne chassent jamais la trace en attente d'un autre. Flux et ligne pm2 partent sitôt l'écriture faite, avant la
  relecture : une relecture en échec (500) ne les perd pas.
- Contournement de développement : la ligne `dev-auth-bypass:<id>` est
  reconnue sur l'objet même rendu par `getCurrentUser` (aucune relecture), ses
  bascules reconnectent tous les flux du compte (le contournement passe toute
  requête du compte, cookie compris), seul un doublon de clé à l'insertion est
  toléré (bascule concurrente), et elle n'est ni comptée ni
  fermée par « déconnecter mes autres appareils ».
- **Journal** : une ligne pm2 seulement (`auditStaffAction`, auteur nommé ;
  à l'entrée, les rôles incarnés ou « joueur (aucun rôle) »,
  `impersonationAuditLine`) — rien sur Discord, où la bascule ne dirait rien
  d'utile au staff.
- Côté client : `usePlayerViewToggle` (`components/player-view-toggle.ts`, séparé de la bannière `components/player-view.tsx` chargée à la demande par la mise en page) — un
  second clic n'envoie rien, un échec en notification (`showError`), une
  réussite par `router.refresh()` (la barre et les menus changent).

- **Échéance** : `getCurrentUser` relit aussi `player_view_until`
  (`user.playerViewUntil`). À cette heure (plus une seconde,
  `playerViewExpiryDelayMs`), la bannière relit la page et chaque flux SSE de
  la session envoie la demande de reconnexion puis se ferme : interface et
  droits ne divergent pas quand les droits reviennent d'eux-mêmes.
- **Cast et arbitrage** : `claimMatchCast`, `setCastSettings`,
  `loadOwnCastSettings`, `releaseMatchCast`, `takeMatchReferee` et
  `releaseMatchReferee` prennent l'auteur **avec sa session**
  (`SessionActor = { id, playerView }`) et refusent la vue joueur
  (`PLAYER_VIEW_ACTIVE`, 403) : l'éligibilité se lit en base, un nouvel
  appelant ne peut pas l'oublier. Le retrait par le staff (`assignMatchReferee`,
  route d'administration gardée par `can()`) passe par le retrait interne.

## Interface

- Menu du compte (`AccountMenu`, prop `playerViewEntry` = `playerViewMenuMode(user)`) :
  « Incarner un rôle » (pictogramme `Drama`) pour un administrateur qui
  n'incarne rien — ferme le menu et ouvre la modale —, « Revenir en vue
  admin » pendant l'incarnation — la bannière défile avec la page, le menu,
  sous la barre fixe, reste à portée.
- Modale `ImpersonateRoleDialog` (`components/impersonate-role-dialog.tsx`,
  chargée par `next/dynamic` à l'ouverture : son code ne pèse pas sur la barre
  des autres comptes) : portail sur `document.body`, `useDialogBehavior`,
  `useBackdropDismiss` (`MODAL_DIALOGS.md`). En tête, « Joueur (aucun rôle) »
  (focus d'ouverture, un clic suffit) avec son « i » ; puis le tableau des
  rôles incarnables — une case `Coche` par rôle (`CHECKBOX_STYLES.md`), un
  « i » par rôle qui dit ce qu'il ouvre et ce qu'il n'ouvre pas, et une colonne
  « Ouvre » (motif du tableau des rôles d'équipe, #601), replié en une colonne
  sous 480 px de tableau (`data-label`). « Incarner » envoie les cases cochées
  (aucune : vue joueur). Pendant l'envoi, rien ne ferme la modale, les cases
  sont figées (`aria-readonly`) ; un échec la rend (toast), une réussite la
  ferme avec la relecture de la page. Annuler rend le focus au bouton du
  compte.
- Focus : le geste démonte l'élément cliqué ; `takePlayerViewFocus` le rend
  une seule fois — au bouton de retour de la bannière après l'entrée, au
  bouton du compte après le retour (jamais sur `<body>`).
- Bannière `PlayerViewBanner`, rendue par la mise en page racine quand
  `user.playerView` : « Rôle incarné : Caster, Arbitre » (ou « Vue joueur
  active » sans rôle), un « i » (`InfoHint`) qui dit l'appareil seul,
  l'échéance (`PLAYER_VIEW_MAX_HOURS`, passé en paramètre du texte) et que les
  notifications push staff continuent d'arriver, et « Revenir en vue admin ».
  Bleu glacier, jamais l'ambre (un état choisi, pas un avertissement).
- Textes : `shell.account.impersonate*`, `shell.impersonate.*` et
  `shell.playerView.*`, FR et EN.

## RGPD

Les colonnes ne servent qu'à réduire des droits, à la demande de
l'administrateur lui-même, et partent avec la session (déconnexion, purge des
sessions échues, suppression du compte) ; une échéance passée reste sur la
ligne, sans effet, avec ses rôles, jusque-là. Jusqu'au 2026-11-19, tout
titulaire d'un rôle de plateforme (développeur compris) pouvait passer en vue
joueur : ses lignes pm2 restent jusqu'à leur rotation, d'où les mentions
« avant novembre 2026 » du registre.

- Registre : T01 décrit l'échéance parmi les données de la session ; T05 décrit
  la bascule (sous-finalité « Vue joueur »), la ligne pm2 (pseudo, identifiant,
  sens), la mémoire du plafond (`PLAYER_VIEW_TOGGLE_RULE`) et des reconnexions
  (`session-streams`), la base (intérêt légitime) et les développeurs parmi les
  personnes concernées.
- `/rgpd` (FR et EN) : paragraphe des journaux du staff (base, opposition),
  note sur ce qui survit à la suppression (bascules dans les deux sens),
  paragraphe du cookie de session (l'échéance portée par la session).
- `PRIVACY_CHANGES` : entrée `2026-11-vue-joueur-du-staff` (FR et EN, tous les
  comptes, comme les traces des rôles de plateforme), datée du 2026-11-20 ;
  puis `2026-11-incarner-un-role` (incarnation réservée aux administrateurs,
  rôles incarnés sur la session et dans la ligne pm2), datée du 2026-11-22
  avec `REGISTER_UPDATED_AT`.
- Registre : T01 dit aussi les rôles incarnés ; T05 la finalité « Incarner un
  rôle » (administrateurs, rôles dans la ligne pm2) et, pour l'historique, la
  vue joueur ouverte jusque-là aux autres titulaires de rôle.

## Tests

- `tests/lib/shared/player-view.test.ts` : seul l'administrateur incarne,
  rôles incarnables (jamais `ADMIN`), lecture des rôles stockés, `can()`
  effectif par jeu de rôles, `sessionHolds`, corps de la route (16 rôles au
  plus), échéance.
- `tests/lib/server/auth-player-view.test.ts` : lecture de session (chaque jeu
  de rôles, `ADMIN` stocké ignoré, non-administrateur sans effet, échéance
  passée, contournement de développement).
- `tests/lib/server/player-view.test.ts` : écriture des rôles normalisés,
  plafond de 12 h, retour, ligne pm2 avec les rôles.
- `tests/app/api/auth/player-view/route.test.ts` : non-administrateur refusé
  (403), rôles transmis, `ADMIN` dans le corps refusé (400), débit (429).
- `tests/app/impersonate-role-dialog.test.tsx` (modale rendue, FR et EN) et
  `tests/app/impersonate-role-dialog-behaviour.test.tsx` (choix « Joueur »,
  rôles cochés, envoi unique, refus).
- `tests/app/player-view.test.tsx` (bannière avec les rôles, menu, textes
  FR = EN, schéma aux deux endroits), `tests/app/player-view-toggle.test.tsx`
  (geste, toast, relecture après réussite seulement).
- `tests/lib/shared/player-view-legal.test.ts` : historique, registre (T01,
  T05) et `/rgpd`, FR et EN.
- Cas d'incarnation dans `match-launch` (prêt, cast, arbitrage selon `live` /
  `tournaments`), `match-launch-routes`, `match-referee-routes`,
  `detail-preview` et `stream` (mêmes droits par le flux et par la lecture
  REST).

## Performance

- Le drapeau est lu dans la requête de session existante (`s.player_view_until > NOW()`), sans requête de plus ni index nouveau ; l'échéance est une simple comparaison.
- La bannière est chargée par `next/dynamic` (rendue côté serveur, code absent du morceau des pages publiques) ; le hook et le focus vivent dans `player-view-toggle.ts`, que le menu du compte importe sans la bannière.
- Les changements de contexte (reconnexion) sont gardés à part des révocations (une minute, `RECONNECT_MEMORY_PER_USER` = 20 par compte, filet global `RECONNECT_MEMORY_MAX` = 1024) : une bascule répétée ne ralentit pas `revokedSince`. La reconnexion des flux porte déjà une gigue (`reconnectDelayMs`).
