# Match mis en avant — accès en un clic

La carte « en cours » de l'accueil met un match en avant. Elle n'y menait pas :
le visiteur lisait deux noms d'équipes, un score et un numéro de manche, puis
devait ouvrir `/tournois`, retrouver le tournoi, ouvrir sa fiche, et repérer la
manche à la main dans un plateau qui peut compter 127 cartes.

Trois gestes, désormais :

1. **La carte mène au tournoi**, ancrée sur le match — `/tournois/7#match-42`.
2. **La fiche s'ouvre défilée sur ce match**, qu'elle le surligne à l'arrivée.
3. **Un bouton mène au direct** quand le match est réellement à l'antenne.

## 1. Le lien : une plaque, pas une ancre enveloppante

La carte porte déjà deux liens — le nom de chaque engagé mène à sa fiche — et un
troisième quand le match est casté. Un `<a>` enveloppant toute la carte les
contiendrait, et un `<a>` dans un `<a>` casse l'hydratation.

C'est donc le motif déjà en place sur les cartes d'annuaire
(`docs/features/ENTITY_LINKS.md`) : une **plaque transparente** `.cardOverlay`
posée sur toute la carte, avec ses trois étages d'empilement — décorations en
`z-index: auto`, plaque à `1`, liens imbriqués (`.nested`) à `2`. Le pied de la
carte (« Voir le match dans le tournoi → ») est l'affordance de cette plaque et
rien d'autre : il est `aria-hidden`, sans lien propre — un second `<a>` redisant
la même cible n'ajouterait qu'un arrêt de tabulation.

## 2. Le chemin : un module pur, une seule écriture

`lib/shared/match-anchor.ts` porte le contrat, parce que c'en est un — entre
**deux pages qui ne partagent rien d'autre** : l'accueil écrit le lien, la fiche
du tournoi le lit. Deux `` `match-${id}` `` écrits à la main dériveraient sans
qu'aucun test s'en aperçoive, et la panne serait muette : le lien mènerait
simplement en haut de la page.

| Fonction | Rôle |
|---|---|
| `matchAnchorId(id)` | L'identifiant DOM posé par `MatchRow` (`match-42`). |
| `tournamentMatchHref(tid, id?)` | `/tournois/7#match-42`, ou `/tournois/7` sans match à désigner. |
| `parseMatchAnchor(hash)` | L'identifiant porté par le fragment, ou `null`. |
| `phaseRevealingMatch(...)` | La phase à sélectionner pour que la cible soit rendue. |

`parseMatchAnchor` refuse tout ce qui n'est pas un entier positif écrit en base
10 — y compris les formes qui *se convertiraient* (`match-0`, `match-01`,
`match-1.5`, `match-1e3`). Le fragment revient du navigateur, donc d'une source
qu'on ne choisit pas : tolérer ici, c'est laisser un `NaN` traverser jusqu'à
`document.getElementById`.

Un test de dépôt (`tests/tournois/match-anchor-wiring.test.ts`) refuse tout
second littéral `match-<id>` ailleurs dans `app/`, `components/` et `lib/`.

## 3. L'ancre côté fiche : `MatchRow`, passage unique

L'identifiant est posé **dans `MatchRow`**, et nulle part ailleurs. Les quatre
vues du plateau (arbre d'élimination, survie, ronde suisse, endurance) rendent
toutes leurs cartes par ce composant : l'ancre y est donc universelle sans
qu'aucune vue ait à y penser — la poser dans une vue, c'est l'oublier dans trois.

## 4. Le défilement : `useMatchAnchor`

`app/(secured)/tournois/[id]/_hooks/useMatchAnchor.ts`. Cinq étapes séparées,
chacune pouvant échouer seule :

1. **Lire le fragment** — au montage, et à chaque `hashchange` (un second clic
   depuis la même page ne remonte pas le composant).
2. **Révéler la phase** — en `MULTI`, le plateau ne rend qu'une phase à la fois.
   La bascule n'est appliquée **qu'une fois par cible** (`phaseAppliedFor`) :
   sans ce garde-fou, un clic du lecteur sur une autre phase serait défait par
   l'ancre à chaque instantané SSE, et la page deviendrait innavigable tant que
   le fragment resterait dans l'URL.
3. **Chercher l'élément, défiler, poser le focus.**
4. **Contrôler le placement** 700 ms plus tard.
5. **Surligner**, trois secondes.

### Le défilement est instantané, et le placement se vérifie

Pas d'animation : c'est ce que fait le navigateur sur une ancre native — on
arrive à destination, on ne s'y rend pas. Et surtout, `behavior: "smooth"` s'étale
sur plusieurs frames pendant lesquelles cette page-là vit encore (instantané SSE,
bascule de phase, volet qui se déplie). **L'animation y est avalée sans la
moindre erreur** : mesuré en conditions réelles, `scrollY` restait à 0 tandis que
le halo s'allumait sur une carte hors écran — la panne parfaite, silencieuse et
plausible. Le même appel en instantané tient.

Pour la même raison, le placement est **vérifié** plutôt que supposé : 700 ms
après l'arrivée, si la carte a quitté l'écran, on la recentre — une fois, et
seulement si elle en est réellement sortie, pour ne pas reprendre la main sur un
lecteur qui a commencé à défiler.

Le **focus** va sur la carte (`tabIndex={-1}` sur `MatchRow`, `focus({
preventScroll: true })` dans le hook) : le défilement et le halo ne disent rien à
qui ne voit pas la page, et un navigateur en fait autant sur une ancre native.

### On ne reprend jamais la main sur le lecteur

La recherche peut durer vingt secondes, et la page reste utilisable pendant ce
temps. Arriver après coup pour recadrer et déplacer le focus arracherait le
curseur d'un champ de score en cours de saisie. Le hook guette donc les gestes
qui ne peuvent venir que d'une personne (`pointerdown`, `keydown`, `wheel`,
`touchstart` — pas `scroll`, que nous déclenchons nous-mêmes) : si l'un d'eux est
passé, on **renonce au déplacement, pas au repère**. Le halo s'allume quand même —
il désigne toujours la manche qu'on venait voir, et on la trouve en défilant.

### L'ancre se rejoue d'un tournoi à l'autre

L'App Router **réutilise** cette page d'un `[id]` à l'autre — `useTournamentLive`
et les trois dialogues de la page prennent déjà cette précaution — et une
navigation client passe par `history.pushState`, qui ne déclenche **pas** de
`hashchange`. La lecture du fragment dépend donc de `tournamentId` : sans cela,
`/tournois/5#match-42` → `/tournois/7#match-99` ignorerait purement l'ancre du
second tournoi, et le halo du premier pourrait suivre sur une manche de même
identifiant.

La sélection de phase repart de zéro avec elle, et **les deux repères ensemble** :
`selectedPhaseId` à `null` (une phase appartient à son tournoi — garder son
identifiant laisserait `selectedPhase` introuvable, donc `filteredMatches` non
filtré, et la fiche empilerait toutes les phases) et `lastCurrentPhaseId` à
`undefined`. Remettre le seul second ferait passer le premier instantané du
nouveau tournoi pour un démarrage de phase, qui écraserait la phase que l'ancre
vient de choisir ; remettre la seule sélection laisserait ce faux démarrage la
reprendre.

### Trois pièges, traités explicitement

**Le contenu arrive après le premier rendu.** La page ouvre le flux SSE, et
c'est lui qui apporte le plateau : chercher l'élément une seule fois après le
montage ne trouverait jamais rien. Le hook **guette** (`setTimeout` toutes les
100 ms — et non `requestAnimationFrame`, qui n'est plus servi quand l'onglet
passe en arrière-plan) et **renonce au bout de 20 s**. Un identifiant qui ne
désigne aucun match de ce tournoi — manche d'un autre tournoi, plateau régénéré
depuis, manche qualificative masquée par les play-offs d'une BG Survie — ne
laisse donc pas une boucle derrière lui : la page reste simplement en haut.

**Le match dort dans un volet replié.** Un gros tableau est découpé en
volets (« Premiers tours », « Quarts de finale »…) et `BracketSections` n'en rend
qu'un à la fois : sur le tableau des perdants d'un plateau à 128 équipes, 214
cartes sur 254 ne sont pas dans le DOM. Le hook chercherait donc jusqu'à
renoncer. C'est `BracketSections` qui **ajoute** le volet de la cible à ses
volets ouverts — il est le seul endroit qui sache relier un match à un volet —,
et il n'en referme jamais aucun : le lecteur reste libre de replier ensuite. La
cible lui arrive par `useMatchAnchorTarget()`, distinct du surlignage : l'une
vaut *avant* d'avoir trouvé le match, l'autre *après*.

**Le match vit dans une zone défilante.** Les rondes, les rounds et les colonnes
d'arbre sont dans un `<ScrollArea>` horizontal. `scrollIntoView` avec
`block`/`inline: "center"` fait défiler **tous** les conteneurs ancestraux : la
zone défilante n'a rien à savoir de l'ancre, et l'ancre rien à savoir de la zone.

Le fragment n'est **pas** effacé de l'URL après usage : le lien reste copiable,
et un rechargement doit redéfiler au même endroit. C'est aussi pourquoi
`MatchRow` porte une `scroll-margin` — le saut natif du navigateur sur un
`#match-…` déjà présent au chargement colle la carte en haut de fenêtre.

### Le surlignage

`MatchAnchorProvider` (`_lib/match-anchor-context.tsx`) diffuse par contexte,
comme `LiveProvider` et `IssueReportProvider` : les cartes sont rendues depuis
quatre vues, et faire descendre en props un identifiant qui ne concerne qu'une
carte sur cent obligerait chacune à relayer une valeur dont elle n'a que faire.

**Deux contextes plutôt qu'un objet**, parce que la cible et le surlignage n'ont
ni le même public (`BracketSections` / `MatchRow`) ni le même moment. Réunis, ils
feraient redessiner les 127 cartes d'un gros plateau à chaque changement de l'un
ou l'autre ; séparés, ce sont deux valeurs primitives, qui ne changent d'identité
qu'en changeant de valeur.

Le style est global (`.match-anchor-target` dans `app/globals.css`) parce que
`MatchRow` n'a pas de module CSS — ses styles sont en ligne, et une animation ne
s'écrit pas en style en ligne. Sous `prefers-reduced-motion`, le fondu disparaît
mais **le repère reste** : sans lui, on ne saurait plus quelle carte on venait
voir.

## 5. Le bouton de direct

Le bandeau de diffusion de la carte existait déjà, avec un lien souligné, rendu
aussi bien pour `LIVE` que pour `SCHEDULED`. C'est maintenant un **bouton**, et
il n'apparaît **que** pour un match réellement à l'antenne :

| État (`resolveMatchLiveState`) | Bandeau | Bouton |
|---|---|---|
| `LIVE` + `liveUrl` | bouton seul (rouge) — la pastille « En direct » le dit déjà | « Regarder sur Twitch » |
| `LIVE` sans `liveUrl` | — (pastille « En direct » seule) | — (casté sans lien public) |
| `SCHEDULED` | « ○ DIFFUSION ANNONCÉE » (bleu) | — |
| `OFF` | — | — |

`SCHEDULED` annonce un cast à venir : la chaîne ne montre pas encore ce match, et
l'y envoyer serait la même impasse que le bouton « Regarder le live » du hero,
qui ne se rend qu'à l'antenne ouverte (`docs/features/LIVE_STREAMS.md`). L'URL
est celle du **match**, jamais celle du tournoi — un match n'hérite pas de la
chaîne officielle — et elle est bornée par la liste blanche de
`normalizeStreamUrl` côté serveur.

### Vocabulaire et couleur

La carte porte **une seule pastille, celle du match** (voir § 7, « État du match
et état du tournoi »). Le rouge (`pill-live`) n'habille que « En direct », un
match réellement à l'antenne (`LIVE_STREAMS.md`) ; « En cours » et « Lancement »
sont bleus, « En attente de lancement » neutre.

## 6. Ce que la carte n'invente plus

Deux mentions étaient **écrites en dur**, identiques pour tous les matchs de tous
les tournois : « FR · SEED 1 » / « FR · SEED 4 », et un bloc « CARTE EN COURS · — ».

- Le **bloc de carte de jeu est retiré** : le modèle ne porte pas la map jouée,
  et la case du pied sert maintenant l'affordance du lien.
- Les **seeds sont lus en base** (`bg_tournament_registrations.seed`), mais
  seulement là où cette colonne **est** le tirage. Elle porte l'ordre
  d'inscription ; en Suisse, en Survie et en multi-phases, le moteur seede depuis
  le classement du site (`seedingSource` / `isSeedOrderEffective`,
  `lib/shared/seeding.ts`, voir `docs/features/SEEDING_ORDER.md`). Y afficher un
  seed serait la même invention qu'avant, avec un chiffre plus crédible : la
  ligne disparaît alors, plutôt que de mentir. Un ordre fixé à la main
  (`manual_seeding`) rend le seed à tous les formats.
- Le drapeau « FR » disparaît : le site ne porte aucune donnée de pays.

## 7. Quel match est mis en avant

Retour terrain : l'arbitrage avait daté tous les matchs, et l'accueil présentait
toujours comme match du moment un match « À planifier » — la sélection prenait
le premier match `READY` du plateau, sans lire la planification.

`pickFeaturedMatchIndex` (`lib/shared/landing.ts`) choisit désormais d'après la
phase de lancement (`matchLaunchPhase`, `lib/shared/match-launch.ts`, la même
que la fiche du tournoi) :

1. le match **à l'antenne** (`isMatchLive`), quelle que soit sa phase ;
2. un match **lancé** (`LAUNCHED` : il se joue) ;
3. un match **en lancement** (`LOBBY` : son heure est venue) ;
4. le **prochain match daté** (`SCHEDULED`, horaire le plus proche).

Un match « À planifier » (`TO_PLAN`), terminé ou sans adversaire (`NONE`) n'est
jamais retenu ; sans candidat, la carte se réduit au tournoi. À rang égal,
l'ordre du plateau départage.

### État du match et état du tournoi

Retour terrain (2026-10-05) : la pastille « EN COURS », en tête de carte, était
l'état du **tournoi**, mais se lisait comme celui du match — qui n'était que daté
(« Prochain match · 5 oct. · 21:00 » juste en dessous).

- **La seule pastille est celle du match** (`featuredMatchPill`,
  `lib/shared/landing.ts`), posée juste au-dessus des engagés, à côté de la
  manche. Pour « En cours » et « Lancement », elle reprend les mots des sections
  de manche (`MATCH_SECTION_LABELS`, `ROUND_MATCH_SECTIONS.md`) ; pour un match
  daté, elle garde « En attente de lancement » (`FEATURED_PILL_WAITING_LABEL`),
  là où la section de manche dit « Planifié » :

  | Match | Pastille | Teinte |
  |---|---|---|
  | à l'antenne (`liveState === "LIVE"`), quelle que soit la phase | « En direct » | rouge (`pill-live`) |
  | `LAUNCHED` | « En cours » | bleu |
  | `LOBBY`, ou `SCHEDULED` dont l'heure est passée (horloge) | « Lancement » | bleu |
  | `SCHEDULED` | « En attente de lancement », suivie de « 5 OCT. · 21:00 · MANCHE 1 » | neutre |

  L'horaire (`featuredMatchPill().when`) s'écrit **à côté** de la pastille, avec
  la manche, et non dedans : la pastille tient ainsi sur une ligne dès 320 px.
  La ligne « Prochain match · … » est retirée, elle redisait la même chose.
- **L'état du tournoi devient une mention secondaire**, sans pastille :
  « TOURNOI EN COURS · OVERWATCH » en tête de carte, au-dessus du nom du tournoi
  (`FEATURED_TOURNAMENT_STATE_LABEL`). Sans match mis en avant, c'est la seule
  mention d'état de la carte.

La bascule « En attente » → « Lancement » ne vient que de l'horloge (`useClock`,
active pour un match daté seulement) ; `now = null` au rendu serveur et à
l'hydratation s'en tient à la phase du serveur.

**Fraîcheur.** Le choix dépend de l'horaire et du lancement : `match-schedule.ts`
(horaire), `setMatchReady` / `forceLaunchMatch` et le lancement d'office
(`tournaments/index.ts`) publient avec `{ landingLive: true }`, qui oublie
`landing:live` (`REALTIME_REFRESH.md`). Côté client, `useLandingLive` reprend la
valeur d'un nouveau rendu serveur (`router.refresh()`, retour sur l'accueil)
au lieu de garder la première jusqu'au sondage suivant.

## Fichiers

| Fichier | Rôle |
|---|---|
| `lib/shared/match-anchor.ts` | Module pur : identifiant, chemin, relecture, phase à révéler. |
| `components/cyber/landing/LiveCard.tsx` | Plaque de lien, bouton de direct, seeds. |
| `lib/server/landing-service.ts` | Seeds des deux engagés, sous condition de `seedingSource`. |
| `lib/shared/landing.ts` | `LandingLiveMatch.team1Seed` / `team2Seed`. |
| `app/(secured)/tournois/[id]/_hooks/useMatchAnchor.ts` | Lecture du fragment, phase, défilement, surlignage. |
| `app/(secured)/tournois/[id]/_lib/match-anchor-context.tsx` | Diffusion de la cible cherchée et du match surligné. |
| `app/(secured)/tournois/[id]/_components/MatchRow.tsx` | Pose l'ancre et la classe de surlignage. |
| `app/(secured)/tournois/[id]/_components/BracketSections.tsx` | Déplie le volet où dort la cible. |
| `app/globals.css` | `.match-anchor-target` et son repli sans animation. |

## Tests

| Fichier | Ce qu'il tient |
|---|---|
| `tests/lib/shared/match-anchor.test.ts` | Réciprocité écriture/relecture, refus des formes convertibles, résolution de phase. |
| `tests/app/live-card-featured-match.test.tsx` | Cible du lien, intitulé accessible, bouton de direct réservé à `LIVE`, plus aucune donnée inventée, pastille du match distincte de l'état du tournoi. |
| `tests/lib/shared/landing.test.ts` | `featuredMatchPill` : libellé par section, cas « En direct », bascule par l'horloge. |
| `tests/lib/server/landing-live.test.ts` | Seeds exposés format par format, seed aberrant écarté. |
| `tests/tournois/match-anchor-wiring.test.ts` | Points de passage (l'ancre est dans `MatchRow`, le hook est branché) et unicité du préfixe. |

## Notes reprises de CLAUDE.md

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

- **Lien profond vers un match** (`lib/shared/match-anchor.ts` pur) : la carte « en cours » de l'accueil mettait un match en avant sans y mener — le visiteur devait ensuite retrouver la manche à la main dans un plateau qui peut compter 127 cartes. La carte entière mène désormais à `/tournois/[id]#match-[matchId]` (plaque `.cardOverlay`, mêmes trois étages d'empilement que les cartes d'annuaire), et la fiche s'ouvre **défilée sur ce match**, surligné trois secondes. Le préfixe de l'ancre est un **contrat entre deux pages** qui ne partagent rien d'autre : un `match-<id>` recopié à la main dériverait sans qu'un test s'en aperçoive, et la panne serait muette — le lien mènerait simplement en haut de la page ; d'où l'écriture unique (`matchAnchorId` / `tournamentMatchHref` / `parseMatchAnchor`), et un refus strict de tout ce qui n'est pas un entier positif en base 10, le fragment revenant du navigateur. L'ancre est posée dans **`MatchRow`**, passage unique des quatre vues du plateau : la poser dans une vue, c'est l'oublier dans trois. Deux pièges, tenus par `useMatchAnchor` : le plateau **arrive par le flux SSE** (on guette la cible, `setTimeout` et non `requestAnimationFrame` — l'onglet peut être en arrière-plan —, et on renonce au bout de 20 s), et le match peut vivre dans un `<ScrollArea>` horizontal ou dans une phase non affichée (`scrollIntoView` en `block`/`inline: "center"` fait défiler tous les conteneurs ancestraux ; `phaseRevealingMatch` bascule la phase, **une seule fois par cible**, sinon un clic du lecteur sur une autre phase serait défait à chaque instantané). Le bouton de direct de la carte n'apparaît que sur un match **réellement à l'antenne** (`LIVE`, jamais `SCHEDULED`). Voir `docs/features/FEATURED_MATCH_LINK.md`.
