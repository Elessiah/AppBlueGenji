# Vue joueur du staff

Un membre du staff (colonne `is_admin` ou tout rôle de plateforme : `ARBITRE`,
`CASTER`, `COMMUNITY_MANAGER`, `RECRUTEUR`, `DEV`) suspend **temporairement**
ses droits pour voir le site exactement comme un joueur : « Passer en vue
joueur » dans le menu du compte, « Revenir en vue admin » dans la bannière
affichée sur toutes les pages tant que la vue dure.

## Où vit le drapeau

- **Sur la session**, côté serveur : `bg_user_sessions.player_view_until`
  (`DATETIME NULL`, dans le `CREATE TABLE` et en `ALTER` tolérant de
  `RECENT_SCHEMA_CHANGES`). Jamais un cookie ni un état du client : rien que le
  navigateur puisse forger.
- **Par session** : les autres appareils du compte gardent leurs droits.
- **Échéance** : `PLAYER_VIEW_MAX_HOURS` (12 h, `lib/shared/player-view.ts`)
  après la bascule. La lecture de la session compare l'échéance à `NOW()` :
  passé ce délai, les droits reviennent d'eux-mêmes, sans tâche planifiée.
  La ligne part avec la session (déconnexion, révocation, purge, suppression).

## Un seul point d'application

`getCurrentUser()` (`lib/server/auth.ts`, `fromRow`) lit la colonne avec la
session et, quand elle est dans le futur, rend `isAdmin: false` et
`roles: []` (`sessionPlatformRights`). Tout ce qui décide d'un droit lit ces
deux champs — `can()`, `canAny()`, `isStaffMember()`, les tests directs de
`user.isAdmin` (suppression d'un tournoi, annulation d'un abandon) — si bien
que **aucune route n'a à y penser** : routes `app/api/admin/*` en 403, aucun
champ staff dans `TournamentViewerContext` (flux et REST de secours), palier
SSE ordinaire, barre sans « Signalements » ni « Documentation dev », `/devdoc`
fermé, sections staff de `/bot` et `/bot/docs` masquées, `GET /api/auth/me`
sans rôle.

Le contournement de développement (`DEV_AUTH_BYPASS.md`) suit la même règle :
sans session, une ligne dédiée de `bg_user_sessions` (`devBypassSessionKey`)
porte l'échéance.

Si la colonne manque (son `ALTER` a échoué), la lecture se rejoue sans elle :
aucune session n'est alors en vue joueur, les droits restent entiers.

## Ce qui reste au compte en vue joueur

- **Ses rôles d'équipe** (`OWNER`, `MANAGER`, `CAPITAINE`…) : ce ne sont pas
  des droits de plateforme ; il inscrit, gère et joue comme tout joueur.
- **Le retour**, et rien d'autre de staff. `AuthUser.playerViewAvailable`
  (droits **réels** du compte, vue joueur ou non) ouvre seul la bascule ;
  aucun `can()` ne le lit.
- **Ses casts et arbitrages désignés restent en base**, mais la session ne les
  tient plus : la modale de lancement et « Contacts » ne lui présentent que
  ses matchs de joueur (`viewerRole`), le « Prêt » d'un caster ou d'un arbitre
  est refusé (`setMatchReady`, `NOT_MATCH_PARTY`), et les routes de cast et le
  retrait d'arbitrage répondent `403 FORBIDDEN`. Revenir en vue admin les lui
  rend tels quels.
- Les notifications push staff suivent le **compte** (abonnement de
  l'appareil), pas la session : elles continuent d'arriver.

## La bascule — `POST /api/auth/player-view`

- Corps `{ active: boolean }` (JSON, 32 Kio au plus) ; provenance vérifiée en
  première instruction (`403 CROSS_SITE_REQUEST`, `415` hors JSON).
- `401 UNAUTHORIZED` sans session ; `403 FORBIDDEN` pour un compte sans droit
  réel ; `400 INVALID_PLAYER_VIEW` pour un corps sans booléen ;
  `500 PLAYER_VIEW_FAILED` sur une panne. Réponse `{ playerView, until }`.
- `setPlayerView` (`lib/server/player-view.ts`) écrit l'échéance (ou `NULL`)
  sur la ligne de **cette** session, puis fait reconnecter ses flux SSE
  (`reconnectSessionStreams`, motif `RECONNECT` : la route relit le contexte
  du lecteur, sans refus).
- **Journal** : une ligne pm2 seulement (`auditStaffAction`, auteur nommé) —
  rien sur Discord, où la bascule ne dirait rien d'utile au staff.
- Côté client : `usePlayerViewToggle` (`components/player-view.tsx`) — un
  second clic n'envoie rien, un échec en notification (`showError`), une
  réussite par `router.refresh()` (la barre et les menus changent).

## Interface

- Menu du compte (`AccountMenu`, prop `playerViewEntry`) : « Passer en vue
  joueur », rendu quand le compte peut basculer et ne l'a pas fait.
- Bannière `PlayerViewBanner`, rendue par la mise en page racine quand
  `user.playerView` : « Vue joueur active », un « i » (`InfoHint`) qui dit
  l'appareil seul et l'échéance, et « Revenir en vue admin ». Bleu glacier,
  jamais l'ambre (un état choisi, pas un avertissement).
- Textes : `shell.account.playerView*` et `shell.playerView.*`, FR et EN.

## RGPD

La colonne ne sert qu'à suspendre des droits, à la demande de la personne
elle-même, et part avec la session : le registre (T05) cite la ligne pm2 de la
bascule et l'échéance portée par la session ; `/rgpd` (FR et EN) l'ajoute aux
traces nommées du staff dans les journaux du serveur. Pas d'entrée
`PRIVACY_CHANGES` : rien ne change pour un joueur, et le membre du staff fait
lui-même le geste (décision à confirmer à la revue juridique).

## Tests

`tests/lib/shared/player-view.test.ts`, `tests/lib/server/auth-player-view.test.ts`,
`tests/lib/server/player-view.test.ts`, `tests/app/api/auth/player-view/route.test.ts`,
`tests/app/player-view.test.tsx` (bannière, menu, textes FR = EN, schéma aux
deux endroits), et des cas « vue joueur » dans `session-streams`, `match-launch`,
`match-launch-routes`, `match-referee-routes`, `users-roles`, `detail-preview`
et `stream` (aucun droit staff par le flux comme par la lecture REST).
