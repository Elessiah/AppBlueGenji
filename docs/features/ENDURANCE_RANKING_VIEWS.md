# BG Survie — en-tête, bandeau de manche et vues du classement

## Objectif

Rendre le plateau « BlueGenji Survie » lisible d'un coup d'œil : où en est la
manche, qui doit encore jouer, et comment le classement a bougé manche après
manche — sans le tableau « manche par manche », retiré parce qu'il doublait ces
vues. Même rendu sur la page connectée (`/tournois/[id]`) et sur la page sans
compte (`/suivre/tournois/[id]`) : les deux passent par `TournamentSheet` →
`EnduranceView` ; la page sans compte ne reçoit simplement aucun geste.

Le graphique « Évolution de l'endurance » suit le journal des sanctions, replié
à chaque chargement (§ Graphique).

## Ce que voit le lecteur

Dans l'ordre (`EnduranceView`) :

1. **En-tête** (`EnduranceCard`), sous le titre « Endurance et manches » du bloc
   du plateau (`TournamentSheet`, qui n'est pas dupliqué) — le barème, et à
   droite « N équipes en lice → 8 en play-offs » (« joueurs » en tournoi
   individuel).
2. **Bandeau de la manche en cours** — « MANCHE EN COURS 3 / 5 » (le total
   seulement sous plafond de manches), « 7 matchs joués sur 11 » et sa barre
   (`<progress>` natif), « N équipes doivent encore jouer cette manche », et
   **« PROCHAIN MATCH »** : la date à venir la plus proche parmi les rencontres
   non jouées de la manche, avec les deux engagés. Masqué sans date à venir.
   Play-offs lancés : le bandeau dit « PLAY-OFFS » et l'avancement de l'arbre,
   compté sur l'arbre **complet** (`endurancePlayoffMatchTotal` : les tours pas
   encore posés sont projetés, petite finale comprise) — jamais « 0 sur 4 » aux
   quarts puis « 4 sur 6 » aux demies, une barre qui reculerait.
   Tournoi fini : pas de bandeau.
3. **Vues du classement** (`EnduranceRankingViews`), puis la légende « Hors
   course », puis le journal des sanctions.
4. **Volet « Évolution de l'endurance »** (`EnduranceChartPanel`), replié.
5. Aperçu de la manche suivante (arbitrage), play-offs (s'ils sont lancés),
   volets de manche (`ENDURANCE_ROUND_PANELS.md`).

## Les vues

| Vue | Contenu | ▲▼ comparés à |
| --- | --- | --- |
| « M1 » … (manches **closes**) | rang, capital, bilan et statut **à l'issue** de la manche | la manche précédente (l'ordre de départ pour la 1) |
| « Mn en cours » | les seules équipes ayant **déjà joué** la manche ; `#` = place au général | la dernière manche close |
| **« Général »** (par défaut) | le classement tel que le flux le pousse | la dernière manche close |

La vue « en cours » n'existe que si la manche a au moins une rencontre jouée.
Avant la première rencontre, seul « Général » existe et la barre des vues n'est
pas affichée.

La vue suivie se retient **par sa clé** (`general`, `round-2`, `current-3`) : une
manche qui arrive par le flux décale les index, pas les clés. Quand la manche
en cours se clôt, « current-n » devient « round-n » et le lecteur **reste sur sa
manche** (`resolveEnduranceViewIndex`) ; toute autre clé disparue retombe sur
« Général ». L'onglet est clé par sa **manche** (`enduranceTabKey`) : « M3 en
cours » devenu « M3 » est le même bouton, le focus clavier ne tombe pas.

### Colonnes

`#` (avec ▲▼ et sa phrase pour le lecteur d'écran) · engagé (`EntrantName`, puis
le badge « S6 », titre « Ordre de départ n°6 ») · endurance (badge ambre `−N` =
pénalités cumulées jusqu'à la manche de la vue) · **« MANCHE n »** (variante A) ·
V / D (V / N / D si le tournoi a des nuls) · statut · actions (« Général »
seulement).

La colonne « MANCHE n » montre la manche de la vue (la dernière manche au
Général) :

- rencontre jouée : variation du capital sur la manche (pénalité comprise),
  suivie de « dont −N de pénalité » / « incl. −N penalty » quand la manche en a
  porté une (sans quoi un 3-0 sanctionné de 5 se lisait « −2 », comme une
  défaite), score, adversaire, date ;
- rencontre à jouer : date (ou « Date à fixer ») et adversaire ;
- « Forfait — retirée » (« retiré » en individuel), « Déjà sortie », « Sans
  match cette manche » (effectif impair).

Après la ligne de rang `playoffSize`, une ligne « ZONE PLAY-OFFS — TOP 8 »
sépare les qualifiables du reste (aussi dans la vue filtrée « en cours »).

### Gestes — « Général » seulement

Pénalité, forfait / abandon et annulation d'abandon restent décidés par
`EnduranceView` avec **les mêmes gardes** (`canForfeitRow`, `canPenalizeRow`,
`canCancelRow`) et sont passés en `renderActions`. `EnduranceRankingViews` ne
les rend que dans la vue « Général » : une vue passée est de l'histoire, aucun
geste ne s'y applique. Les gestes de match (score, programmation, live,
arbitrage, contestation, « ★ Votre match ») restent sur les cartes des volets.

## Graphique — « Évolution de l'endurance »

`EnduranceChartPanel` (volet `BoardPanel`, **replié à chaque chargement**) →
`EnduranceChart`, chargé par `dynamic()` au premier dépliage : replié, le volet ne
coûte que son en-tête. `BoardPanel` ne rend ses enfants qu'ouvert, donc replier
**démonte** le graphique. Même rendu, en lecture seule, connecté ou non. Logique
pure dans `_lib/endurance-chart.ts`.

- **Courbes** (SVG en ligne, `viewBox` 760 × 400) : du départ (capital initial)
  aux manches 1 … dernière tirée, une courbe par engagé, lue dans
  `standings[].rounds` (`pointsAfterRound`) ; l'état « pas encore joué » vient du
  match de la manche (`enduranceRoundColumnCell`). Une courbe s'arrête à la
  première manche non jouée : **tête creuse** quand l'engagé n'a pas joué la
  manche affichée (match à jouer, forfait, déjà sorti), **« FF »** en rouge
  quand il en est sorti par forfait. L'axe va jusqu'au plafond de manches
  (manches à venir grisées), sinon jusqu'à la dernière tirée.
- **Manche affichée** : boutons « Manche n » (terminée / en cours · 7/11 / à
  venir) ; une manche à venir est désactivée. Le rang, le Top N, la légende et
  le **seuil** (pointillé vert « SEUIL TOP N » = capital du N-ième, N =
  `playoffSize`) suivent la manche affichée ; la dernière lit le général.
  Sans choix, le graphique **suit la dernière manche tirée** : une manche
  poussée par le flux, volet ouvert, s'affiche d'elle-même (la courbe avance
  sans rejouer depuis le départ) ; une manche passée choisie reste affichée
  (`chartShownRound`, `chartTargetFor`).
- **Modes** : « Top N » (les N premiers de la manche affichée, les autres
  masqués), « Ma sélection » (8 au plus, état du composant seulement — ni
  stockage local, ni serveur), « Toutes » / « Tous » (palette en boucle).
  « Effacer la sélection » (monté dès « Ma sélection », `aria-disabled` une fois
  vide : le focus reste sur lui) et « Rejouer l'animation ».
- **Survol, focus, clic** : un bouton de la légende (au focus comme au survol)
  ou la zone de survol d'une courbe met la courbe en avant et remplit l'encart
  (nom, « #rang · S seed · bilan » **à l'issue de la manche affichée** — `chartRecordAt`, comme le rang —, capital manche par manche). Un clic ajoute
  ou retire l'engagé de « Ma sélection ». Le clavier passe par la légende.
- **Palette** : huit jetons froids (`ENDURANCE_CHART_PALETTE` : `--blue-500`,
  `--violet-400`, `--accent-green`, `--pink-400`, `--blue-100`, `--blue-700`,
  `--violet-300`, `--cyan-400`), chacun ≥ 3:1 sur le fond, deux voisins écartés
  aussi par la clarté. **Pas d'ambre** (avertissements seulement) : l'ambre de la
  maquette a été remplacé.
- **Animation** : `requestAnimationFrame` seulement volet ouvert, 650 ms par
  manche, annulée au repli (démontage) ; **une seule image** sous
  `prefers-reduced-motion` ou en régime économe (`useClientPower()`,
  `CLIENT_POWER_MODES.md`). Aucune animation CSS infinie.
- **Accessibilité** : SVG `role="img"` avec un `aria-label` réel (nombre
  d'engagés, manche affichée, seuil) ; légende dans une `<ScrollArea ariaLabel>` ;
  un **tableau `sr-only`** engagé × manche (capital, « à jouer », « Forfait »,
  « sortie ») remplace pour les lecteurs d'écran le tableau « manche par
  manche » retiré. Texte HTML ≥ 11 px ; le texte du SVG est en unités
  utilisateur. Noms rendus en texte par `visibleText`, jamais en HTML.

## Données

Le rang et le bilan de chaque manche viennent du **rejeu**
(`replayEnduranceDetailed`) : chaque `EnduranceRoundCell` porte `rank`
(l'ordre de `assignRanks`), `wins`, `losses`, `draws` cumulés. Champs
facultatifs : un instantané antérieur n'en porte pas, et une vue de manche
retombe alors sur le capital (puis l'ordre du général) pour ranger ses lignes.
Rien n'est redépartagé côté client — deux règles feraient deux vérités.

Le détail d'une rencontre (score, adversaire, date) se lit sur `detail.matches`,
déjà public. Logique pure : `_lib/endurance-ranking-views.ts`.

## Accessibilité et mouvement

- Onglets : `role="tablist"` / `tab` / `tabpanel`, `aria-selected`,
  `aria-controls`, flèches gauche / droite, Début / Fin ; ils défilent dans un
  `<ScrollArea ariaLabel>`. Flèches ‹ › de 44 px nommées, navigation basse
  nommée (« ← Manche 2 »).
- Barre des vues collante sous l'en-tête du site (`--sticky-header-h`). Le
  plateau (`.ds-block`, `overflow: hidden`) aurait annulé `position: sticky` :
  `.board` le passe en `overflow: clip` (`page.module.css`).
- Les flèches ‹ › et la navigation basse ne déplacent pas le focus : le titre de
  la vue atteinte est annoncé par une région `aria-live="polite"` (un onglet
  s'annonce de lui-même). La navigation basse ramène le haut du classement à
  l'écran quand la vue atteinte est plus courte.
- Lignes sorties estompées **cellule par cellule** (`--row-fade`, plancher 0,8
  pour garder 4,5:1 au texte discret et au rouge) ; la cellule des gestes reste
  à pleine opacité.
- Capital d'une vue passée : une case « sortie » / « forfait » ne porte pas de
  capital, la vue lit le dernier connu (`pointsAfterRound`) — jamais 0.
- Mobile (< 920 px) : chaque ligne devient une carte, chaque case porte son
  `data-label` (colonne « MANCHE n » comprise).
- Glissement d'une vue à l'autre : une passe CSS, jamais en boucle, posée
  seulement si `useClientPower().decorativeMotion` et annulée sous
  `prefers-reduced-motion` ; seulement pour une vue **demandée** par le
  lecteur, jamais quand le flux change la vue suivie.
- « Prochain match » lit l'heure par `useClock` (rien avant le montage :
  l'heure du serveur n'est pas celle du lecteur).
- Polices ≥ 11 px, couleurs par jeton, ambre réservé aux pénalités.

## Vie privée

Aucune donnée nouvelle : rang, bilan et rencontres sont des résultats déjà
publics sur les deux pages. Le graphique n'en lit pas d'autres, et la sélection
« Ma sélection » n'est conservée nulle part (état du composant). Pas d'entrée `PRIVACY_CHANGES`, pas de changement
du registre.

## Tests

- `tests/tournois/endurance-ranking-views.test.ts` — vues, lignes, ▲▼, filtre
  « déjà joués », ligne des play-offs, prochain match, colonne « MANCHE n »,
  textes équipe / joueur.
- `tests/tournois/bg-survie-round-rank.test.ts` — rang et bilan par manche du
  rejeu (égalités, nul, forfait, pénalité, élimination, sortie anticipée).
- `tests/tournois/endurance-ranking-views-wiring.test.ts` — ordre des blocs,
  gestes de chaque rôle, gestes réservés au « Général », règles transverses.
- `tests/tournois/endurance-chart.test.ts` — séries, tracés et têtes (creuse,
  « FF »), Top N et seuil par manche, plafond de la sélection, palette (jetons,
  contraste, clarté, pas d'ambre), pas de l'animation.
- `tests/tournois/endurance-chart-wiring.test.ts` — volet replié, chargement à
  la demande, mouvement réduit et régime client, `ScrollArea`, pas d'ambre,
  tableau `sr-only`, lecture seule, textes FR + EN.
- `tests/app/tournament-page-i18n.test.tsx` — rendu anglais sans français,
  accord « joueurs » en français.
