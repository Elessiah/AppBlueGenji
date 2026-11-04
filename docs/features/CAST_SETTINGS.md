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
| **Diffuser ce match / Configurer la diffusion** | permission `tournaments` | `MatchLiveDialog` (diffusion de l'organisation) |

Trois conséquences voulues :

- un porteur de `live` qui **ne caste pas** n'a plus aucune configuration de
  diffusion : elle appartient soit au caster (la sienne), soit au staff
  `tournaments` (celle de l'organisation) ;
- « Ne plus caster » quitte la carte : il vit dans « Configurer ma diffusion »,
  d'où il fait revenir « Caster ce match » ;
- « Lancer / Couper le direct » et « Ajouter / Modifier la rediff » quittent la
  carte aussi : ils vivent dans les **deux** fenêtres de diffusion (celle du
  caster et celle du staff), la rediff gardant sa propre fenêtre
  (`MatchReplayDialog`), ouverte depuis elles.

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

Une inscription déjà acquise (rejouée) ne réécrit **aucun** réglage.

## « Configurer ma diffusion »

Fenêtre du caster, sur **son** cast :

- **lien de sa chaîne** — celui du stream qu'il tient ; le stream du staff se
  lit seulement (`CAST_STREAM_NOT_OWNED` au serveur, champ en lecture seule avec
  sa note dans la fenêtre). Le lien reste obligatoire : pour s'en défaire, on ne
  caste plus ;
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
(inscription).
