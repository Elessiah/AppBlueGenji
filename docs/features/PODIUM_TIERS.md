# Marches du podium — partout où le nom s'affiche

Depuis le 2026-10-06. Les trois premières équipes du classement du site portent
leur **marche** (1re, 2e, 3e) sur leur nom **partout** où il passe par les liens
d'entité, et leurs **membres** en portent une version adoucie. Avant, l'effet ne
vivait que sur le podium de `/classement`, et il était trop discret (la 2e se
lisait blanche en production).

## Quel podium

**Celui de l'onglet « Général » de `/classement`** (tous jeux) : même chargeur
(`loadTeamRanking({ includeUnplayed: true })`), même tri (`compareRankedTeams`).
Jamais deux podiums qui se contredisent.

- Sous **trois** équipes classées, aucune marche (pas de podium sur
  `/classement` non plus, `splitRankingPodium`).
- Les onglets par jeu gardent **leur** podium, sur `/classement` seulement :
  `RankingBoard` impose la marche de l'onglet affiché (`podiumTier` sur
  `TeamLink`), le reste du site suit le podium « Général ».
- **Entrées solo** (`solo_user_id`) : `loadTeamRanking` les écarte de la liste,
  elles ne montent donc **jamais** sur le podium. Un engagé solo
  (`EntrantLink`/`EntrantName`) porte la marche **adoucie de son joueur** (s'il
  est membre d'une équipe du podium), comme son `PlayerLink`, jamais celle d'une
  équipe.

## Données

| Étape | Où |
|---|---|
| Règles pures (marches, membres, plus haute marche, classes) | `lib/shared/podium-tiers.ts` |
| Chargement : classement « Général » + **une** requête (`bg_team_members` actifs des trois équipes, `left_at IS NULL`) | `lib/server/podium-tiers.ts` (`loadPodiumTiers`) |
| Cache | `cachedRanking("podium-tiers")` : même durée (60 s) et **même invalidation** que le classement — tout score qui tombe l'oublie (`invalidateTeamRanking`) |
| Remise au client | `app/layout.tsx` → `<PodiumTiersProvider>` (`components/podium-tiers.tsx`) : aucune requête par lien |

- **Plus haute marche** : un joueur membre de plusieurs équipes du podium prend
  la plus haute.
- `loadPodiumTiers` **ne lève jamais** : une panne rend un site sans marche.
- Un changement d'effectif (arrivée, départ) n'invalide pas le cache : il se
  voit au plus 60 s plus tard.
- **Rafraîchissement** : la mise en page racine n'est pas re-rendue d'un lien à
  l'autre ; les marches suivent au **chargement suivant** (ou `router.refresh()`).
  Le flux SSE du tournoi ne les porte pas : une marche qui change pendant qu'une
  page de tournoi est ouverte se voit à la navigation suivante — choix assumé,
  le podium bouge à l'échelle d'un tournoi, pas d'un match.

### Vie privée

Les équipes du podium sont publiques (`/classement`). Les **membres** (des
identifiants numériques) ne partent qu'à un visiteur **connecté**
(`visiblePodiumTiers`) : les effectifs ne se lisent que sur les fiches d'équipe,
réservées aux comptes. Rien de nouveau n'est collecté ni exposé : aucune entrée
`PRIVACY_CHANGES` ni registre.

## Où la marche s'affiche

Tout nom rendu par `TeamLink`, `EntrantLink`, `EntrantName` (marche pleine) ou
`PlayerLink` (marche adoucie) — `/classement`, tournois (inscrites, arbres,
cartes de match, classements de phase), fiche joueur, profil, statistiques,
accueil (leaderboard ; la carte « direct » rend un `EntityLink` nu, sans
marche). Noms **non cliquables** :

- `TeamPodiumName` : titre de la fiche d'équipe (`TeamHeader`), nom des cartes
  de l'annuaire `/equipes` (`TeamCard`) et de son bandeau de tête
  (`HighlightStrip`) ;
- `PlayerPodiumName` : pseudo des cartes `/joueurs` (`PlayerCard`) et titre de
  la fiche joueur.

Exceptions :

- **Écrans d'administration sobres** : `PodiumTiersOff` sur le panneau des
  signalements (`app/(secured)/admin/signalements/layout.tsx`) et les contacts
  d'arbitrage (`EntrantContactsPanel`) et l'aperçu de l'étape suivante de
  l'Endurance (`EnduranceNextRoundPanel`, enveloppé dans `EnduranceView`) —
  des outils, pas une vitrine.
- **Ligne en retrait** (`data-podium-muted` : perdant d'un match dans
  `MatchRow`, équipe éliminée ou forfait dans les classements Survie, Suisse et
  Endurance, et dans l'historique manche par manche de l'Endurance) : la marche garde son repère (couronne, losange) mais quitte
  dégradé, lueur, mouvement et graisse — sinon le nom distancé brillerait plus
  fort que les autres.
- **Vainqueur d'un match** : sans lueur — le fond teinté turquoise de la ligne
  ferait tomber violets et rose sous 4,5:1 sous la lueur.
- **Graisse en ligne** des classements Suisse et Survie : `standingNameWeight`
  (700 pour l'engagé du lecteur, 500 ailleurs) ne l'impose pas à une marche,
  qui porte la sienne.
- **Lien-avatar sans texte** (roster des cartes `/equipes`) : `podiumTier={null}`
  — la peinture sur le texte effacerait l'initiale de repli ; le nom de
  l'équipe, au-dessus, porte déjà la marche.

## Apparence (`app/globals.css`, famille `.podium-tier` / `.podium-member`)

**Décision de l'utilisateur (2026-10-06)** : **ni or ni bronze**. Le style
brillant et animé en teintes froides est gardé (irisé cyan → violet → rose à la
1re, givre/glacier à la 2e, néon violet à la 3e, reflet animé) — il devait
seulement devenir **nettement visible** et suivre l'équipe partout.

| Marche | Équipe (`.podium-tier-N`) | Membre (`.podium-member-N`) |
|---|---|---|
| 1re | dégradé **irisé** cyan → violet → rose → cyan, balayé d'un reflet clair (`--ink`, 3,6 s), lueur cyan + aura violette (`drop-shadow`), **couronne** en repère, gras | dégradé cyan → violet → rose, immobile |
| 2e | **chrome glacier** bleu → cyan, reflet `--blue-100` plus lent (6 s), lueur cyan, **losange** glacier, gras | dégradé bleu glacier → cyan, immobile |
| 3e | **néon** violet → rose, immobile, lueur violette, **losange** violet → rose, gras | dégradé violet → rose, immobile |

- Texte **réel** peint par `background-clip: text` (`-webkit-text-fill-color:
  transparent`, robuste dans un titre `.ds-title` déjà en dégradé) ; repères en
  `::before` sans texte : **nom accessible inchangé**.
- Lueur par `drop-shadow`, jamais `text-shadow` (sous un texte peint par son
  fond, l'ombre recouvrirait le dégradé).
- **Contraste** : chaque arrêt est un jeton de texte qui tient **4,5:1** sur le
  fond le plus clair où la lueur reste — la ligne de l'engagé du lecteur, à
  6 % de cyan — **éclairé par la lueur** au bord des lettres (moitié de chaque
  opacité, lueurs cumulées) — `tests/app/podium-tiers-style.test.ts`. D'où des
  lueurs retenues : cyan 0,16 + violet 0,3 à la 1re, violet 0,25 à la 3e.
- **Mouvement** : le reflet ne déplace que `background-position`, motif
  périodique (pas de saut), en pause par `var(--deco-anim-state)` (régime de
  charge `useClientPower`, mouvement réduit, menu d'accessibilité). À l'arrêt,
  la moitié la plus colorée du dégradé reste peinte.
- Survol / focus d'un lien : couleur pleine `--blue-100`, soulignement lisible ;
  « Liens soulignés » : trait `--blue-300` malgré le texte transparent.
- Contraste renforcé : lueur effacée. Couleurs forcées : fond retiré, couleur
  du système. Impression : couleur pleine `--blue-500`, repère masqué.

## Tests

- `tests/lib/shared/podium-tiers.test.ts` — marche par place, propagation aux
  membres, plus haute marche, moins de trois équipes, anonymes sans membres.
- `tests/lib/server/podium-tiers.test.ts` — classement « Général », une requête,
  cache et invalidation, panne.
- `tests/components/podium-tier-links.test.tsx` — `TeamLink`, `PlayerLink`,
  `EntrantLink` (solo compris), noms non cliquables, marche imposée,
  `PodiumTiersOff` sur les écrans d'administration.
- `tests/app/podium-tiers-style.test.ts` — contraste sous la lueur, teintes
  froides, hiérarchie, mouvement en pause, accessibilité, impression.
