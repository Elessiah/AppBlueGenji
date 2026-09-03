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
| `LIVE` + `liveUrl` | « ● CE MATCH EST EN DIRECT » (rouge) | « Regarder sur Twitch » |
| `LIVE` sans `liveUrl` | idem | — (casté sans lien public) |
| `SCHEDULED` | « ○ DIFFUSION ANNONCÉE » (bleu) | — |
| `OFF` | — | — |

`SCHEDULED` annonce un cast à venir : la chaîne ne montre pas encore ce match, et
l'y envoyer serait la même impasse que le bouton « Regarder le live » du hero,
qui ne se rend qu'à l'antenne ouverte (`docs/features/LIVE_STREAMS.md`). L'URL
est celle du **match**, jamais celle du tournoi — un match n'hérite pas de la
chaîne officielle — et elle est bornée par la liste blanche de
`normalizeStreamUrl` côté serveur.

### Vocabulaire et couleur

La pastille d'en-tête de la carte est passée de `pill-live` (rouge) à
`pill-blue`. « EN COURS » est l'**état du tournoi**, pas une diffusion, et le
rouge n'habille que ce qui est réellement à l'antenne (`CLAUDE.md`) — ici le
bandeau du match casté, trois lignes plus bas, avec lequel il se confondait.

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
| `tests/app/live-card-featured-match.test.tsx` | Cible du lien, intitulé accessible, bouton de direct réservé à `LIVE`, plus aucune donnée inventée. |
| `tests/lib/server/landing-live.test.ts` | Seeds exposés format par format, seed aberrant écarté. |
| `tests/tournois/match-anchor-wiring.test.ts` | Points de passage (l'ancre est dans `MatchRow`, le hook est branché) et unicité du préfixe. |
