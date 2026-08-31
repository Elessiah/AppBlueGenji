# Accès aux tournois non publiés

`bg_tournaments.start_visibility_at` est la date à partir de laquelle un tournoi
existe pour le public. La **liste** l'a toujours respectée — `listTournamentBuckets`
filtre en SQL (`HIDDEN_TOURNAMENTS_SECTION.md`) — mais la **fiche**, elle, ne la
consultait nulle part.

Conséquence : un compte sans le moindre rôle qui devinait l'identifiant — un
entier consécutif — obtenait `HTTP 200` sur `GET /api/tournaments/[id]`, sur le
flux SSE et donc sur la page `/tournois/[id]`. Nom, description, dates, effectif
et plateau d'un tournoi en préparation étaient lisibles avant l'annonce. Rien
n'était modifiable — toutes les écritures ont leurs propres gardes —, mais
l'annonce elle-même fuyait.

## La règle

**Un tournoi non publié n'est lisible que par la permission `tournaments`**
(`ADMIN`, `ARBITRE` — voir `PERMISSION_ROLES.md`).

C'est exactement l'audience de la section « Tournois invisibles » et de
`GET /api/tournaments?scope=hidden` : une seule règle, un seul public, aucune
divergence possible entre ce que la liste montre et ce que la fiche laisse
ouvrir.

Le cast (`casting`) n'y a **pas** droit. Il ne voit pas ces tournois en liste non
plus, et l'aperçu du plateau qu'on lui accorde sert à commenter un tournoi
annoncé, pas à lire un brouillon.

L'organisateur n'a pas besoin d'un traitement à part : seul le staff
`tournaments` peut créer un tournoi, il est donc toujours couvert.

## Où elle est appliquée

La décision est un module **pur**, `lib/shared/tournament-visibility.ts` :

| Fonction | Rôle |
| --- | --- |
| `isTournamentPublished(t, now)` | la date de visibilité est-elle atteinte ? |
| `canViewTournament(t, { canManage }, now)` | ce lecteur peut-il lire ce tournoi ? |

Côté serveur, elle est posée à un seul endroit : `getVisibleTournamentSnapshot`
(`lib/server/tournaments/index.ts`), **unique porte** vers l'instantané en dehors
du module. Ni `getTournamentSnapshot` ni `getTournamentSnapshotFrame` — qui porte
le même instantané, déjà encodé — ne sont réexportés, ni par `tournaments/index.ts`
ni par `tournaments-service.ts` : une route ne peut donc plus les atteindre par
distraction. Même précaution que pour `getTournamentPreview`, réservé de la même
façon.

La salle de diffusion (`lib/server/tournament-broadcast.ts`) est la seule à avoir
besoin de la trame, et l'importe directement de `./snapshot`. Elle n'a pas à
refaire le contrôle : elle ne sert que des abonnés que la route du flux a déjà
laissés passer.

Les deux portes de lecture y passent :

- `GET /api/tournaments/[id]/stream` — le chemin **nominal**, appelle
  `getVisibleTournamentSnapshot` directement ;
- `GET /api/tournaments/[id]` — la lecture REST de **secours**, à travers
  `getTournamentDetail`, qui délègue à la même fonction.

Câbler les deux est une obligation, pas une précaution : le flux étant le chemin
normal, une garde posée sur la seule lecture REST n'entrerait en jeu qu'après une
coupure du direct (`REALTIME_REFRESH.md`).

La page `/tournois/[id]` est un composant client qui ne se nourrit que de ces
deux routes : elle est donc close par la même occasion, et affiche
« Tournoi introuvable » par son chemin d'échec définitif habituel.

## Pourquoi 404 et non 403

Un 403 sur un tournoi qu'on prétend invisible confirmerait son existence — et
l'existence est justement ce qu'on protège, l'identifiant étant devinable.
`getVisibleTournamentSnapshot` rend `null` pour « n'existe pas » comme pour
« pas pour vous », et les deux appelants traduisent ce `null` en un même 404.

## Ce que la garde n'a pas besoin de couvrir

Les routes d'écriture d'un tournoi (`register`, `forfeit`, `matches/.../report`,
`report-issue`) ne sont pas concernées, et pas par oubli : `validateDateOrder`
impose `startVisibilityAt <= registrationOpenAt <= registrationCloseAt <= startAt`
à la création **comme à l'édition**. Un tournoi non publié est donc toujours
`UPCOMING`, et chacune de ces routes exige déjà un état plus avancé ou un
engagement qu'il est impossible d'avoir. `edit` est de son côté gardé par
`can(user, "tournaments")`.

La vitrine publique est logée à la même enseigne : le calendrier et le ticker de
`/` passent par `listTournamentBuckets`, déjà filtré.

## Course entre la lecture et l'édition

Un tournoi qui devient visible pendant qu'on le lit ne fait qu'élargir l'accès.
L'inverse ne peut pas se produire : `startVisibilityAt` n'est modifiable que dans
la fenêtre `FULL`, qui suppose le tournoi *déjà* invisible (`TOURNAMENT_EDITING.md`).
Un flux déjà ouvert n'a donc rien à revérifier à chaque trame — la garde est à
l'ouverture, une fois.

## Tests

- `tests/lib/shared/tournament-visibility.test.ts` — le module pur : bornes,
  seconde exacte (la même que le `<=` de la liste SQL), `Date` comme ISO, et la
  fermeture sur une date illisible.
- `tests/lib/server/tournament-visibility-gate.test.ts` — la porte : ce qui passe,
  ce qui est refusé, le refus **avant** tout calcul de contexte du lecteur, et le
  défaut sans droits déclarés (spectateur, pas staff).
- `tests/app/api/tournaments/stream.test.ts` — le flux transmet bien `canManage` à
  la garde, le cast reste spectateur, et le refus est un 404.
