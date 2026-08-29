# Diffusion en direct

Lier une chaîne de diffusion à un tournoi et à ses matchs, et n'exposer le
bouton « Regarder le live » de la page d'accueil que lorsqu'un direct est
réellement en cours.

## Deux niveaux, volontairement indépendants

| | Porté par | Rôle |
|---|---|---|
| **Chaîne officielle** | `bg_tournaments.live_url` | L'antenne permanente de l'organisation, affichée en tête de la page du tournoi. |
| **Diffusion d'un match** | `bg_matches.live_trigger` / `live_url` / `live_started_at` | Ce match est-il casté, par quelle chaîne, et est-il à l'antenne ? |

**Un match n'hérite jamais de la chaîne officielle.** Un match peut être diffusé
par un streamer indépendant : un lien hérité renverrait le spectateur vers une
antenne qui ne montre pas ce match. Un match sans lien propre affiche donc son
badge sans lien cliquable, et le spectateur passe par la chaîne officielle.

## L'état de diffusion n'est pas stocké

Comme le verrouillage de score (`lib/shared/match-lock.ts`) ou le rejeu de la
Survie, l'état est **dérivé** à chaque lecture par `resolveMatchLiveState`
(`lib/shared/live-streams.ts`). Trois entrées seulement sont persistées : le
mode de déclenchement, le lien, et l'horodatage d'ouverture d'antenne.

```
liveTrigger === null                        → OFF        (match non casté)
status ∈ {AWAITING_CONFIRMATION, COMPLETED} → OFF        (un score a été saisi)
status === PENDING                          → SCHEDULED  (annoncé, pas jouable)
liveTrigger === "AUTO"                      → LIVE
liveTrigger === "MANUAL" && liveStartedAt   → LIVE
liveTrigger === "MANUAL"                    → SCHEDULED
```

Deux conséquences voulues :

- **L'arrêt du direct à la saisie du score ne demande aucune écriture.** Le
  match quitte `READY`, l'état bascule seul.
- **Une correction de score défait le direct qu'elle avait éteint.** Rien à
  réconcilier, rien à rattraper.

C'est aussi la raison pour laquelle aucune requête SQL ne réimplémente cette
règle : `findBroadcastingTournament` charge les seuls matchs castés (leur nombre
est marginal) et filtre en mémoire avec `isMatchLive`, pour qu'il n'existe qu'une
définition de « ce match est à l'antenne ».

### L'exception : le ré-appariement

Une seule chose ne se dérive pas — l'antenne ouverte à la main survivrait à un
changement d'affiche. Quand une correction de score en amont remplace un engagé
d'un match aval par **un autre**, `pushTeamToTarget`
(`lib/server/tournaments/scoring.ts`) referme donc son antenne : la ligne a
changé de rencontre, et la laisser ouverte rallumerait le bouton d'accueil vers
une chaîne qui ne montre pas cette affiche.

Remplir un créneau **encore vide** ne déclenche rien : c'est le cas nominal où le
match prévu se matérialise, et une diffusion programmée à l'avance doit lui
survivre. Le mode de déclenchement et le lien sont eux aussi conservés — ils
disent « ce créneau du tableau est couvert par cette chaîne », ce qui reste vrai
après un ré-appariement ; seule l'antenne, qui affirme « maintenant », tombe.

## Deux modes de passage à l'antenne

Choisis **par match**, au moment où on le marque comme casté :

- **`AUTO`** — le direct s'ouvre dès que le match devient jouable (`READY`),
  c'est-à-dire quand le tournoi atteint le round concerné.
- **`MANUAL`** — le direct s'ouvre au clic (« ▶ Antenne »), et se referme au clic
  (« ■ Couper ») ou tout seul à la saisie du score. C'est le mode qui convient
  aux tournois étalés sur plusieurs jours, où un match peut être jouable des
  heures avant que le cast commence.

Passer un match en `AUTO` referme son antenne : `live_started_at` n'a plus de
sens dans ce mode. Démarquer un match efface aussi son lien et son antenne,
sinon une ouverture fantôme reprendrait effet à la moindre remise en `MANUAL`.

Les contrôles ne sont proposés que sur un match qui peut réellement passer à
l'antenne (`isMatchCastable`) : un bye, un match fantôme ou un match déjà noté
dérivera `OFF` quoi qu'on configure, et lui offrir « ＋ Caster » serait une
impasse. `canConfigureLive` rouvre toutefois la configuration d'un match déjà
marqué, sans quoi une diffusion posée par erreur deviendrait ineffaçable.

## Le bouton « Regarder le live » de l'accueil

Il n'apparaît **que si** un tournoi `RUNNING` porte une chaîne officielle
exploitable **et** qu'au moins un de ses matchs est en état `LIVE`. Sinon il
n'est pas rendu du tout — pas de version grisée : un bouton qui mène vers une
chaîne hors ligne crée plus de confusion qu'il n'en lève.

Le lien s'ouvre dans un nouvel onglet (`rel="noopener noreferrer"`) et pointe
vers la **chaîne officielle** du tournoi, jamais vers un lien de match.

Quand plusieurs tournois diffusent en parallèle, celui au `start_at` le plus
récent l'emporte — le même ordre que `listTournamentBuckets`. `getLandingLive`
retient d'ailleurs ce tournoi-là pour sa carte live, faute de quoi la carte et le
bouton pourraient désigner deux tournois différents. La carte met également en
avant un match réellement à l'antenne plutôt que le premier match jouable.

Une seule boucle de sondage alimente les deux : `useLandingLive`, appelé par le
`Hero` (`components/cyber/landing/`). Deux sondages séparés les feraient diverger
le temps d'un tick — une carte annonçant un direct au-dessus d'un bouton absent.

## Liste blanche de plateformes

`normalizeStreamUrl` n'accepte que `twitch.tv`, `youtube.com`, `youtu.be` et
`kick.com` (préfixes `www.` et `m.` tolérés, et rien d'autre :
`twitch.tv.exemple.com` est refusé). Le champ est saisi par du staff mais
réaffiché à tous les visiteurs — un lien libre ferait du site un tremplin de
redirection.

Sont également refusés : les identifiants dans l'URL (`user:pass@`), un port
explicite, et toute URL dépassant 255 caractères une fois normalisée. Un schéma
manquant est en revanche toléré (`twitch.tv/bluegenji` devient
`https://twitch.tv/bluegenji`) : le staff colle volontiers l'adresse sans
`https://`. Le résultat est toujours ramené en `https`.

Ajouter une plateforme = ajouter une entrée à `LIVE_PLATFORMS`.

## Permissions

Une nouvelle permission **`live`**, portée par le rôle **`CASTER`**
(`lib/shared/permissions.ts`, voir `PERMISSION_ROLES.md`).

`CASTER` porte deux permissions aux portées bien distinctes : `casting` ne donne
que la **lecture** de l'aperçu du plateau (`TOURNAMENT_PREVIEW.md`), tandis que
`live` est le droit d'**écriture** sur l'état de diffusion décrit ici.

| Action | Permission |
|---|---|
| Renseigner la chaîne officielle du tournoi | `tournaments` |
| Marquer un match comme casté, son mode, sa chaîne | `live` |
| Ouvrir / fermer l'antenne d'un match | `live` |

`live` est volontairement séparée de `tournaments` : un streamer doit pouvoir
ouvrir l'antenne sans pouvoir toucher aux scores ni aux tournois. À l'inverse,
`ARBITRE` cumule les deux — sans quoi il faudrait deux personnes pour lancer un
match casté. `ADMIN` a tout.

## Fichiers

| Fichier | Rôle |
|---|---|
| `lib/shared/live-streams.ts` | Pur : liste blanche d'URL, dérivation de l'état, libellés. |
| `lib/server/tournaments/live-streams.ts` | Écritures + résolution de la cible du bouton d'accueil. |
| `app/api/admin/tournaments/[id]/live/route.ts` | `PUT` — chaîne officielle (`tournaments`). |
| `app/api/admin/matches/[matchId]/live/route.ts` | `PUT` — configuration ; `POST` — antenne (`live`). |
| `components/cyber/landing/useLandingLive.ts` | Sondage unique de l'accueil. |
| `app/(secured)/tournois/[id]/_components/MatchLiveStrip.tsx` | Badge, lien et contrôles sous chaque match. |
| `app/(secured)/tournois/[id]/_components/MatchLiveDialog.tsx` | Configuration de diffusion d'un match. |
| `app/(secured)/tournois/[id]/_components/TournamentLiveLink.tsx` | Chaîne officielle en tête de page. |

## Codes d'erreur

| Code | HTTP | Sens |
|---|---|---|
| `INVALID_STREAM_URL` | 400 | Lien hors liste blanche, ou inexploitable. |
| `INVALID_LIVE_TRIGGER` | 400 | Mode autre que `AUTO` / `MANUAL`. |
| `INVALID_ON_AIR` | 400 | `onAir` absent ou non booléen. |
| `LIVE_TRIGGER_NOT_MANUAL` | 409 | Antenne basculée sur un match en `AUTO` (rien à basculer). |
| `MATCH_NOT_LIVE_READY` | 409 | Antenne ouverte sur un match non jouable ou déjà noté. |

## Jeu de test

`npm run seed` produit trois cas (`lib/server/seed-cases.ts`, champ `live`) :

- **Live Auto (à l'antenne)** — chaîne officielle + matchs en `AUTO` : le cas
  nominal du bouton d'accueil.
- **Live Manuel (hors antenne)** — chaîne renseignée, antenne fermée : les matchs
  sont « programmés » et ce tournoi **ne doit pas** faire apparaître le bouton.
- **Live Manuel (antenne ouverte)** — antenne ouverte sans lien sur les matchs :
  badge « en direct » seul, le spectateur passe par la chaîne officielle.

Le compte `Test_Caster` porte la permission `live` seule.
