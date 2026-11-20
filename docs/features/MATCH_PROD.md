# Prod d'un match

La **prod** assure la production du direct d'un match. Elle fait partie du cast
du match, **distincte des casters** : elle n'est jamais comptée comme caster, ne
tient ni stream ni antenne, et ne paraît pas dans les contacts du lancement
(elle n'est pas présentée aux équipes).

## Modèle

- `bg_matches.prod_user_id` (`BIGINT NULL`, index `idx_bg_matches_prod`, clé
  étrangère `fk_bg_matches_prod` `ON DELETE SET NULL`) : **une prod au plus** par
  match. Écrite dans le `CREATE TABLE` et dans `RECENT_SCHEMA_CHANGES`.
- Instantané : `BracketMatch.prod` (`{ userId, pseudo } | null`, `mapMatchProd`) ;
  la vue spectateur masque son id comme celui des casters.
- Contexte du lecteur : `TournamentViewerContext.canProd` (`can(user, "prod")`),
  câblé sur les **deux portes** (flux SSE et REST).

## Permission

`prod` (`lib/shared/permissions.ts`) : rôles `PROD` et `ADMIN`. Elle ne donne
**que** le droit de se placer comme prod d'un match ou de s'en retirer — ni
antenne, ni aperçu du plateau (`PERMISSION_ROLES.md`). Un compte marqué
**invité** du planning la garde (la marque ne retire que `planning`).

## Gestes

| Geste | Qui | Route | Refus |
| --- | --- | --- | --- |
| Se placer | `prod` (session, incarnation comprise) | `POST /api/matches/[id]/prod` | `NOT_PROD` (relu en base), `MATCH_PROD_TAKEN`, `PROD_IS_PLAYER`, `PROD_IS_CASTER`, match joué ou exemption |
| Se retirer | la prod elle-même | `DELETE /api/matches/[id]/prod` | `NOT_MATCH_PROD` |
| Placer, changer, retirer | staff `tournaments` | `GET`/`PUT /api/admin/matches/[id]/prod` (`{ userId, expectedUserId }`) | `NOT_PROD`, `PROD_UNAVAILABLE` (suspendu), `PROD_IS_PLAYER`, `PROD_IS_CASTER`, `PROD_CHANGED` (la prod a changé depuis l'ouverture de la fenêtre) |

Un caster ne peut pas être la prod du même match (`CASTER_IS_PROD` à
l'inscription de cast, `PROD_IS_CASTER` dans l'autre sens). Verrous : ligne du
compte (`LOCK IN SHARE MODE`) puis match (`FOR UPDATE`, sans jointure).

Sur la carte, « Plus d'actions » : « Être la prod » / « Quitter la prod » /
« Prod du match… » (fenêtre `ProdDialog`, retrait confirmé par
`ConfirmActionDialog`). La page du match l'affiche dans ses faits clés (« Prod »).

## Annonces

- Journal du staff (salon des casts) : une ligne **anonyme** (`formatProdChangeLog`,
  🎛️) — placée, retirée, placée par le staff, remplacée, retirée par le staff,
  retirée d'office (rôle perdu). Aucun pseudo, staff anonyme.
- Avis au compte que le **staff** place ou retire, ou dont la place est rendue
  d'office (jamais à qui agit sur sa propre place) : message privé de match
  (tag certifié) et push `MATCH_PROD`.

## Planning

Le calcul automatique du planning ne place pas les casters sur les matchs (seuls
les arbitres y sont désignés) : il ne place donc pas non plus la prod. La prod
placée sur un match paraît au planning comme une ligne `PROD` tenue (source
`CAST`, `entryAssignments`), qui remplace une proposition provisoire de prod ; elle
se retire depuis le match (`PLANNING_CAST_MANAGED`). Elle compte dans l'historique
de charge (`loadPlanningHistory`).

## Données du compte

- Rôle `prod` perdu (`setUserRoles`) : ses places sur des matchs à jouer sont
  rendues (`withdrawLostProdPlaces`), annonce « retirée d'office ».
- Anonymisation : places des matchs à jouer rendues ; effacement : toutes
  (`withdrawUserCasts`). Les tournois concernés sont rediffusés.
- Export : `prodAssignments` (match, tournoi) — `RGPD_DATA_RIGHTS.md`.

## Seed

La deuxième manche des cas de lancement a pour prod `Test_Prod2` ; les autres
sont libres pour `Test_Prod` (`docs/seed/SEED_RULES.md`).
