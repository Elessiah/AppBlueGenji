# Réglages du cast par son caster

Demande de l'utilisateur du 2026-11-04. Un caster n'a plus qu'**un** bouton de
cast sur la carte d'un match : « Caster ce match », qui devient « Configurer ma
diffusion » dès qu'il est inscrit — et disparaît sinon.

Code : `lib/shared/cast-settings.ts` (règles pures),
`lib/server/tournaments/cast-settings.ts` (écritures),
`claimMatchCast` / `setCastSettings` (`lib/server/tournaments/match-launch.ts`),
`app/api/matches/[matchId]/caster/route.ts` (GET, POST, PUT, DELETE),
`CastClaimDialog`, `CastSettingsDialog`, `CastSettingsFields`,
`match-card-actions.ts`, `launch-strip.ts`.

## Ce que la carte offre, et à qui

| Action | Public | Ouvre |
| --- | --- | --- |
| **Caster ce match** | permission `live`, match castable hors du sien, pas déjà caster | `CastClaimDialog` |
| **Configurer ma diffusion** | **caster inscrit** de ce match, s'il reste quelque chose à régler (`offersCastSettings`) | `CastSettingsDialog` |
| **Retirer le caster** | permission `tournaments`, et un **autre** caster que le lecteur | confirmation existante (avis au caster, `CAST_NOTICES.md`) |
| **Diffuser ce match / Configurer la diffusion** | permissions `tournaments` **et** `live` (ses routes, `/api/admin/matches/[id]/live` et la rediff, demandent `live`) | `MatchLiveDialog` (diffusion de l'organisation) |

Trois conséquences voulues :

- un porteur de `live` qui **ne caste pas** n'a plus aucune configuration de
  diffusion : elle appartient soit au caster (la sienne), soit au staff
  `tournaments` (celle de l'organisation) ;
- « Ne plus caster » quitte la carte : il vit dans « Configurer ma diffusion »,
  d'où il fait revenir « Caster ce match » ;
- « Lancer / Couper le direct » et « Ajouter / Modifier la rediff » quittent la
  carte aussi : ils vivent dans les **deux** fenêtres de diffusion (celle du
  caster et celle du staff), la rediff gardant sa propre fenêtre
  (`MatchReplayDialog`), ouverte depuis elles. Seule exception : un match
  joué **sans diffusion marquée** n'ouvre aucune des deux fenêtres
  (`canConfigureLive` faux, aucun caster) ; « Ajouter / Modifier la rediff »
  reste alors sur la carte pour ce même staff (`tournaments` et `live`).

## S'inscrire : « Caster ce match »

- **Rejoindre un stream** du match (co-cast) : aucun lien à donner.
- **Ouvrir son propre stream** : le lien de sa chaîne est **obligatoire** —
  l'interface désarme le bouton, le serveur refuse `STREAM_URL_REQUIRED`. Un
  stream sans lien n'apparaissait ni sur la carte, ni sur la page du match, ni
  dans l'annonce #live : il ne servait à rien et laissait croire le contraire.
  Ce choix porte en plus, du **même geste et dans la même transaction**, le mode
  de passage à l'antenne du match et, pour la permission `tournaments`, l'origine
  du lien (case « lien de l'organisation », décochée par défaut).
- Le **BattleTag du cast** suit les deux choix : il parle du caster, non de son
  stream (un co-caster paraît lui aussi dans les contacts).

Une inscription déjà acquise (rejouée) ne réécrit **aucun** réglage. Le mode
d'antenne envoyé à l'inscription ne s'écrit que s'il **change** et que le match
est encore castable (`isMatchCastable`) : un match dont le score attend sa
confirmation s'inscrit toujours, son mode ne bouge plus. Un lien dit de
l'organisation n'est rattaché à **aucun** compte (`link_user_id` nul) : il reste
au match quand le staff qui l'a posé part.

## « Configurer ma diffusion »

Fenêtre du caster, sur **son** cast :

- **lien de sa chaîne** — celui du stream qu'il tient ; le stream du staff se
  lit seulement (`CAST_STREAM_NOT_OWNED` au serveur, champ en lecture seule avec
  sa note dans la fenêtre). Le lien reste obligatoire : pour s'en défaire, on ne
  caste plus (un `liveUrl` vide ou nul : `STREAM_URL_REQUIRED`) ;
- **passage à l'antenne** du match (`AUTO` / `START_TIME` / `MANUAL`), avec la
  même garde que la fenêtre du staff : `START_TIME` demande une date de début
  (`MATCH_START_AT_REQUIRED`) ;
- **antenne** (mode manuel) : ouvrir ou couper, sans quitter la fenêtre ;
- **BattleTag pour ce cast** (Overwatch seulement) ;
- **rediff**, une fois la rencontre jouée : ouvre `MatchReplayDialog` ;
- **« Ne plus caster »** : `DELETE …/caster`, sans confirmation (le caster qui se
  retire lui-même n'est prévenu de rien, `CAST_NOTICES.md`) — refusé sur un match
  terminé, où le bouton n'est pas offert (`offersCastRelease`).

La fenêtre lit à l'ouverture `GET /api/matches/[id]/caster`
(`loadOwnCastSettings`) : le BattleTag d'un cast **ne voyage pas** dans
l'instantané du plateau, commun à tous les lecteurs. Un échec de cette lecture
(place reprise entre-temps) referme la fenêtre en le disant.

## BattleTag d'un cast

`bg_match_casters.cast_battletag` (VARCHAR(64), nul = celui du compte).

- Jamais **vérifié** : `battletagVerified` est faux dès qu'un tag de cast est
  posé, quel que soit le Battle.net du compte — personne ne l'a prouvé.
- Jamais recopié sur le profil, et jamais lu par la condition du cast
  (`castBlockReason` continue d'exiger un BattleTag **tiré d'un compte
  Battle.net** sur le compte).
- Montré **exactement** là et quand celui du compte l'était
  (`buildLaunchCaster`) : fenêtres « Contacts » et de lancement, page du match,
  aux seules parties du match, dans un tournoi Overwatch
  (`battletagRelevantFor`).
- Le réglage « BattleTag OW » du profil **ne le masque pas** : c'est une
  divulgation volontaire pour ce match, alors que le réglage protège le tag du
  compte. Les deux ne sortent de toute façon que dans la fenêtre des contacts
  (`sharesLiveMatch`).
- Part avec l'inscription de caster (retrait, suppression du compte) : rien à
  effacer à part.
- Saisie : `parseCastBattletagInput` (rognée, passée par `visibleText`, 64
  signes au plus, `INVALID_CAST_BATTLETAG`).
- RGPD : entrée `2026-11-battletag-de-cast` de `PRIVACY_CHANGES` (public
  `LIVE_STAFF`), `/rgpd#retransmission` (FR et EN), registre T04 (données, base,
  rétention).

## API

| Route | Qui | Corps |
| --- | --- | --- |
| `GET …/caster` | caster inscrit | — → `{ streamId, liveUrl, staffStream, battletag }` |
| `POST …/caster` | permission `live` | `{ streamId }` ou `{ liveUrl }` (obligatoire), plus `trigger`, `battletag`, `organisationLink` |
| `PUT …/caster` | caster inscrit | `trigger`, `liveUrl`, `battletag`, `organisationLink` — **chaque champ absent n'est pas touché** |
| `DELETE …/caster` | le caster, ou `tournaments` pour un autre | `?userId=` |

`organisationLink: true` sans la permission `tournaments` : 403, jamais ignoré
en silence. Les refus des réglages portent leur code
(`tournamentErrors.json` FR et EN, `LAUNCH_ERROR_MESSAGES`) :
`STREAM_URL_REQUIRED`, `INVALID_CAST_BATTLETAG`, `CAST_STREAM_NOT_OWNED`,
`INVALID_CAST_SETTINGS`, `MATCH_NOT_CASTABLE`, `MATCH_START_AT_REQUIRED`.

La fenêtre n'envoie le mode d'antenne que si le caster en a **choisi** un autre :
un match démarqué montre « automatique » sans qu'enregistrer un BattleTag le
marque casté.

Le dernier caster qui se retire (`releaseMatchCast`) sans qu'aucun stream ne
reste — ni celui du staff avec son lien — démarque le match (`live_trigger` et
`live_started_at` vidés) : l'inscription l'avait marqué casté, il ne passerait
sinon « En direct » à son lancement pour personne.

Le BattleTag de cast figure dans l'export des données du caster
(`casts[].castBattletag`, `listOwnMatchRoles`). Il part avec l'inscription ; sur un match joué gardé à
l'anonymisation d'un compte (`withdrawUserCasts`, `includeCompleted` faux),
l'inscription reste mais son `cast_battletag` est effacé.

## Qui règle le mode d'antenne

CAST-FOLLOWUP (décisions du 2026-11-05). Le mode d'antenne
(`bg_matches.live_trigger`) est commun à tous les streams du match : le
caster qui le pose en devient le propriétaire (`live_trigger_user_id`). Règle
unique, pure, `lib/shared/live-trigger-owner.ts` (`mayChangeLiveTrigger`,
`viewerMayChangeLiveTrigger` pour l'interface) :

- match pas encore casté (`live_trigger` nul) : le premier à le poser ;
- **admin** de la plateforme ou **arbitre désigné** du match (permission
  `tournaments`, condition de l'arbitrage) : toujours ;
- mode d'un caster : lui seul — un co-caster est refusé ;
- mode sans propriétaire (posé par le staff, caster parti) : le staff `tournaments`.

Propriétaire écrit (`liveTriggerOwnerAfter`) : le caster du match qui le pose,
lui seul ; personne quand il est posé par qui ne caste pas (staff, admin,
arbitre, porteur de la seule permission `live`). Un propriétaire que
l'instantané tait (caster devenu inéligible) n'y est pas nommé mais signalé
(`liveTriggerOwnerHidden`) : l'interface garde le mode verrouillé. L'arbitre reconnu est l'arbitre
**retenu** (sans opposition), qui **ne joue pas** le match (`KEPT_REFEREE_SQL`)
et remplit encore la condition d'arbitrage du jeu (`refereeQualifies`).

Refus serveur, sous le verrou du match : 403 `LIVE_TRIGGER_NOT_OWNED` (PUT
`…/caster`, `POST` qui rejoint un stream avec `trigger`, route
`/api/admin/matches/[id]/live`). Les contrôles sont **cachés** à qui ne peut
pas (`CastSettingsFields`, `MatchLiveDialog`). Le propriétaire est effacé
quand il quitte le match (`releaseMatchCast`), quand il en est retiré d'office
(`dropTriggerOwner` : il rejoint une équipe du match, devient inéligible),
quand un autre change le mode ou le retire, et à la suppression de son compte
(`match-casters.ts`, tous les matchs dont il a posé le mode, castés ou non).
À l'inscription, un mode verrouillé n'est pas envoyé (`castClaimBody`). Il
figure dans l'export (`liveTriggers`, `listOwnMatchRoles`).

## L'arbitre désigné, médiateur de la diffusion

L'arbitre désigné **de ce match** (et lui seul : celui d'un autre match est
refusé, 403) entre sur `/api/admin/matches/[id]/live` sans la permission
`live` (`mayConfigureMatchLive`, `lib/server/tournaments/live-access.ts`), et y
est relu sous le verrou du match (`NOT_MATCH_REFEREE` s'il ne l'est plus) ; la
rediff (`…/replay`) reste à la permission `live` :
il configure la diffusion de l'organisation et modifie ou retire le lien d'un
caster (`streamLinks: [{ streamId, liveUrl }]`, lu par `parseStreamLinks`,
400 `INVALID_STREAM_LINKS`). Les liens des casters s'écrivent **avant** celui
de l'organisation : celui-ci n'habille jamais un stream de caster qui vient
de recevoir son lien — ni celui dont il vient d'effacer le lien — dans la même requête.
La fenêtre n'envoie que les liens que l'arbitre a saisis (`casterLinkEdits`) : un
stream arrivé, ou un lien changé par son caster pendant qu'elle est ouverte,
n'est ni effacé ni remis à l'ancien. Le bouton de la carte du match lui est montré
(`markViewerReferee`, contexte du lecteur).

**Lien de l'organisation, gardé** : le stream dont le lien est celui de
l'organisation part avec son dernier caster (`pruneMatchStreams`) — comportement
conservé (décision du 2026-11-05) ; le lien posé dans la configuration du
direct du match reste au match.

## Verrous

Tout passe par le verrou de la ligne du match, pris en **première instruction**
(`lockLaunchMatch`), comme l'inscription : le match (mode d'antenne), puis ses
streams, puis le ménage (`pruneMatchStreams`). `m.live_trigger` et
`m.live_started_at` sont donc lus par `lockLaunchMatch` — un caster règle le
mode du match dans la transaction qui l'inscrit.

## Tests

`tests/lib/shared/cast-settings.test.ts` (règles pures : BattleTag, stream
éditable, offres), `tests/tournois/cast-claim.test.tsx` (corps envoyé, textes),
`tests/tournois/match-card-actions.test.tsx` (inventaire et rangement),
`tests/app/api/match-launch-routes.test.ts` (lien obligatoire, réglages
transmis, lien de l'organisation refusé), `tests/lib/server/match-launch.test.ts`
(inscription : lien de l'organisation, mode inchangé ou non castable),
`tests/lib/server/cast-settings.test.ts` (lien obligatoire au réglage),
`tests/app/api/match-caster-settings-route.test.ts` (GET de son cast, PUT : champs
présents seuls, types, lien de l'organisation refusé, refus traduits),
`tests/tournois/match-card-roles.test.tsx` (diffusion sans `live`, rediff d'un
match joué non diffusé),
`tests/lib/server/match-casters.test.ts` (BattleTag de cast à l'anonymisation).
