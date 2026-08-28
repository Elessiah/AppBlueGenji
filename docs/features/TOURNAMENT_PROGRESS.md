# Frise de progression d'un tournoi

En bas de `/tournois/[id]`, une frise horizontale situe le tournoi sur son cycle
de vie, de **« masqué »** à **« terminé »** : barre remplie, jalons datés, étape
courante mise en avant, et compte à rebours vers le jalon suivant.

L'information existait déjà sur la page, mais éclatée : une pastille d'état en
tête, quatre dates nulle part, et rien qui dise *ce qu'on attend maintenant*.

## Six étapes, pas quatre

`TournamentState` connaît quatre états ; la frise en affiche six.

| Étape | Clé | Ce qui la distingue |
| --- | --- | --- |
| Masqué | `HIDDEN` | `start_visibility_at` n'est pas passée : le tournoi n'existe pour personne d'autre que son organisateur (cf. [MY_TOURNAMENTS_TAB](MY_TOURNAMENTS_TAB.md)) |
| Annoncé | `ANNOUNCED` | Visible, inscriptions pas encore ouvertes |
| Inscriptions | `REGISTRATION` | Entre `registration_open_at` et `registration_close_at` |
| Clôture | `LOCKED` | Inscriptions fermées, coup d'envoi pas encore atteint |
| En cours | `RUNNING` | Les matchs se jouent |
| Terminé | `FINISHED` | Classement final figé |

Les deux étapes en plus sont celles que l'état stocké ne sait pas nommer :

- la **visibilité** n'entre pas dans `computeTournamentState` — un tournoi masqué
  est déjà `UPCOMING` ;
- `UPCOMING` recouvre **deux** moments opposés, avant l'ouverture des
  inscriptions et après leur clôture (`computeTournamentState` renvoie
  `UPCOMING` dans les deux cas). Pour une équipe qui regarde la page, la
  différence est tout : dans l'un elle peut encore s'engager, dans l'autre la
  porte est fermée.

## Où passe le calcul

`lib/shared/tournament-progress.ts`, pur et testé, est la seule implémentation.
Le composant `app/(secured)/tournois/[id]/_components/TournamentProgress.tsx` ne
fait que peindre le résultat.

### `computeTournamentProgress(card, options)`

Renvoie les six étapes qualifiées (`DONE` / `CURRENT` / `TODO`), leur date
d'entrée, l'index courant, le remplissage `ratio` et le jalon `next`.

**L'étape courante croise deux sources.** Les dates départagent les trois
visages de `UPCOMING` ; l'état stocké impose un plancher pour `REGISTRATION`,
`RUNNING` et `FINISHED`, parce qu'un tournoi peut être clos à la main avant
l'heure ou tourner encore bien après son horaire — la frise suit le tournoi, pas
le calendrier. `UPCOMING` ne pose aucun plancher : c'est justement l'état que les
dates doivent trancher, et un plancher l'empêcherait d'afficher « masqué ».

**Les dates sont nettoyées avant usage.** Une date illisible emprunte celle du
jalon précédent (l'étape se réduit à un point plutôt que de casser la barre), et
la suite est forcée croissante : une reprise à la main peut placer la clôture
après le coup d'envoi, ce qui ferait reculer la jauge.

**Le remplissage est indexé sur les étapes, pas sur le temps.** Chaque étape
occupe un sixième de la barre, quelle que soit sa durée : `ratio = (index +
avancement interne) / 5`. Une frise proportionnelle au temps écraserait tout le
tournoi sur un centimètre quand la visibilité est ouverte trois mois à l'avance —
et rendrait invisibles les étapes de durée nulle (le jeu de test donne la même
heure à la visibilité et à l'ouverture des inscriptions).

L'avancement interne est la part de temps parcourue entre les deux jalons qui
bornent l'étape. Deux exceptions : `HIDDEN` n'a pas de début connu (il reste à
zéro), et `RUNNING` n'a pas de fin annoncée — d'où `playedRatio`.

### `computeRunningRatio(input)`

Situe un tournoi **en cours**, de 0 à 1, ou `null` si rien ne le permet. Chaque
famille de formats a sa propre mesure, faute d'une commune honnête :

| Format | Mesure | Pourquoi pas les matchs |
| --- | --- | --- |
| `SINGLE`, `DOUBLE` | matchs joués / matchs du plateau | — (le plateau est connu dès le départ) |
| `SWISS` | rondes jouées / `totalRounds` | une seule ronde est générée à la fois |
| `SURVIVAL`, `BG_SURVIE` | éliminés / (effectif − 1) | ni le nombre de manches ni leur contenu ne sont connus d'avance (il dépend des coupes) |
| `MULTI` | phases réglées / phases, affinées par les matchs de la phase en cours | idem, phase par phase |

Compter les matchs partout afficherait un tournoi de survie à **100 %** dès sa
première manche : sa seule manche générée est intégralement jouée. Une phase
`SKIPPED` compte comme franchie — l'effectif était déjà sous la cible, il n'y
avait rien à jouer (cf. [MULTI_PHASE_TOURNAMENTS](MULTI_PHASE_TOURNAMENTS.md)).

### `formatStageCountdown(from, to)`

« dans 3 j 4 h ». Deux unités au plus, et `null` sur un jalon déjà passé — le
serveur ne fait basculer l'état qu'au premier accès, mieux vaut taire l'échéance
que l'afficher à l'envers.

## Interface

- La frise est une zone défilante (`<ScrollArea orientation="x">`) : elle garde
  ses six jalons lisibles sur mobile plutôt que de les empiler.
- `role="progressbar"` porte `aria-valuenow` et un `aria-valuetext` parlant
  (« En cours — 84 % ») ; le pourcentage affiché est `aria-hidden`, il ne serait
  qu'un doublon à la lecture d'écran.
- Une horloge interne réveille le composant toutes les 30 s : le compte à rebours
  descend et la barre avance sans recharger la page.
- Les animations (pulsation du jalon courant, liseré de tête) s'éteignent sous
  `prefers-reduced-motion`.
