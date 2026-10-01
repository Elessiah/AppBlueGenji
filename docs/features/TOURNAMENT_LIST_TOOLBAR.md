# Barre d'outils de `/tournois` — recherche, filtres, sections

La liste des tournois (`app/(secured)/tournois/page.tsx`) porte une recherche,
trois pastilles de jeu, et quatre sections repliables dont le volume peut
dépasser la centaine de cartes. Trois défauts corrigés ensemble, tous relevés
sur cette même barre d'outils.

## Recherche

`filterTournamentsByQuery` (`app/(secured)/tournois/_lib/buckets.ts`, pure)
lit le nom, la description, et le **format** du tournoi (`FORMAT_LABELS`,
« ronde suisse », « survie »… plutôt que le code `SWISS`) — c'est tout ce
qu'une carte annonce sans requête à part. Les équipes engagées n'y figurent
pas : `TournamentCard` ne porte qu'un compte de places, jamais les noms des
inscrites, une recherche ne les couvre donc pas non plus. Le placeholder
(« Rechercher un tournoi, un format… ») dit exactement cela, plus rien
d'autre.

Le champ porte un `aria-label="Rechercher un tournoi"` : le placeholder seul
n'est pas un nom accessible, il disparaît à la frappe.

Le raccourci affiché suit la plateforme (`searchShortcutLabel`, pur, dans
`lib/shared/search-shortcut.ts`) : « ⌘K » sur un clavier Apple (`Mac`,
`iPhone`, `iPad`, `iPod` dans `navigator.platform`), « Ctrl+K » partout
ailleurs. Valeur par défaut `Ctrl+K` au rendu serveur (sûre, sans DOM),
corrigée une fois côté client au montage. Libellé **et** touche passent par
`useSearchShortcut(ref)`, partagé avec les annuaires `/equipes` et `/joueurs`
(`AnnuaireSearchField`) : ceux-ci affichaient « ⌘K » en dur sans écouter la
moindre touche. La pastille est `aria-hidden` (le champ porte
`aria-keyshortcuts`) et **masquée sous `(hover: none)`** : sur un écran
tactile elle ne sert à rien et se faisait rogner à 320 px.

Les trois champs de recherche sont en **16 px** : en dessous, iOS Safari zoome
la page au focus.

## Pastilles de jeu

Chaque pastille porte `aria-pressed={gameFilter === key}` (état de bascule) et
un `aria-label` qui compose proprement le libellé et le compte
(`` `${label} (${count})` ``) — le compte visible, lui, passe en
`aria-hidden="true"`, sinon le nom accessible collait les deux
(« Tous83 »).

Les compteurs suivent désormais la recherche en cours : une pastille dit
« ce que donnerait CE filtre de jeu, la recherche déjà tapée gardée » — pas le
total brut du site. `countGame` compte sur `queryFilteredBuckets`
(`filterBuckets(scheduledBuckets, query, "all")`), jamais sur `buckets` :
sinon la pastille annonçait un total figé pendant que les sections en dessous,
elles, suivaient la recherche.

## Message d'une section vide

Une section vidée par un filtre actif (recherche ou pastille de jeu) ne dit
plus la même chose qu'une section réellement sans tournoi :
`sectionEmptyMessage(whenUnfiltered, query, gameFilter)` (pur) retombe sur
« Aucun résultat pour cette recherche. » dès que `hasActiveFilter` est vrai,
et sur le message d'origine sinon.

## En-tête de section (`Section.tsx`)

Un `<h2>` n'est pas du contenu phrasé : il ne pouvait pas vivre à l'intérieur
du `<button>` qui bascule l'ouverture. C'est désormais le bouton qui va dans
le titre — `<h2><button aria-expanded aria-controls>…</button></h2>` — jamais
l'inverse. Englober tout le bouton dans le `<h2>` en pollue le nom accessible
(index, compte, chevron : « 01 EN COURS 46 ») ; un `aria-label` sur le `<h2>`
le retranche au seul titre — **et à l'accent** (`title` puis, s'il y en a un,
` ${accent}` — « TOURNOIS INVISIBLES · STAFF », pas juste « TOURNOIS
INVISIBLES », qui tairait à un parcours par titres que la section est réservée
au staff). `aria-controls` (un `useId()`) n'est posé que **section dépliée** :
repliée par défaut (« Terminés »), le corps n'est jamais monté — poser
`aria-controls` quand même désignerait un id absent du DOM.

## Volume d'une section

Les quatre sections à cartes (« En cours », « Inscriptions ouvertes »,
« Prochainement », « Terminés ») sont bornées à `SECTION_DISPLAY_LIMIT` (12)
cartes par défaut, avec un bouton **réversible** « Voir plus (N) » /
« Voir moins » (`ShowMoreRow`) — la version d'origine, propre à la section
« Terminés » seule, ne savait que déplier, jamais replier. L'état déplié vit
dans un `expandedSections: Set<LimitedSectionKey>` (un **drapeau**, pas un
compte figé au clic) vidé à chaque changement de recherche ou de filtre de
jeu, pour ne pas laisser une section dépliée sur un résultat qu'on ne cherche
plus. Un drapeau plutôt qu'un total capturé : la page se rafraîchit de fond en
fond, et une section dépliée sur « 46 » ne doit pas rester bornée à ce chiffre
quand un rafraîchissement en apporte 50 — elle montre alors les 50 sans qu'on
ait besoin de redéplier.

### L'archive des terminés, à la demande

La liste publique mutualisée (`listTournamentBuckets(null)`, lue par l'accueil
et par chaque ouverture de `/tournois`) ne porte plus que les
`FINISHED_TOURNAMENTS_LIST_LIMIT` (12) tournois terminés les plus récents —
elle chargeait tout l'historique, résumés compris, pour une section qui en
montre douze repliée. Elle dit alors ce qu'elle a laissé de côté
(`finishedTotals` : en tout et par jeu), si bien que le sommaire, les pastilles
de jeu et « Voir plus (N) » comptent l'archive entière sans l'avoir reçue
(`finishedBeyondList`). L'archive elle-même est servie par
`GET /api/tournaments?finished=all`, mutualisée à part : la page la demande dès
que le lecteur va la chercher — « Voir plus » sur les terminés, une recherche ou
un filtre de jeu (`needsFinishedArchive`) — puis la garde pour le reste de la
visite.

## « Créer un tournoi »

Le bouton était un `<button>` posé dans un `<Link>` — deux contrôles
interactifs imbriqués, deux arrêts de tabulation pour un seul geste. Il passe
par `<CyberButton asChild variant="primary"><Link href="/tournois/creer">…`,
qui fusionne les deux en un seul `<a>` (le composant partagé du site pour ce
geste, `components/cyber/CyberButton.tsx`) ; les styles propres au bouton
(`.create`) ont disparu avec lui, `CyberButton` en variante `primary` rendant
déjà la même apparence.

## Notes reprises de CLAUDE.md

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

- **Barre d'outils de `/tournois`** (`app/(secured)/tournois/page.tsx` + `Section.tsx` + `_lib/buckets.ts` pur) : la recherche filtre nom, description **et format** (`FORMAT_LABELS` — les équipes engagées n'y figurent pas, `TournamentCard` ne porte que des comptes) et porte un `aria-label` propre, le placeholder seul n'en étant pas un ; son raccourci affiché suit la plateforme (`searchShortcutLabel`, `lib/shared/search-shortcut.ts` : « ⌘K » sur Apple, « Ctrl+K » ailleurs), libellé et touche passant par `useSearchShortcut`, partagé avec `/equipes` et `/joueurs` (`AnnuaireSearchField`, qui affichait « ⌘K » sans écouter aucune touche) ; pastille masquée sous `(hover: none)`, champs en 16 px (iOS zoome en dessous). Les pastilles de jeu portent `aria-pressed` et un `aria-label` qui compose proprement libellé et compte (le chiffre visible passe en `aria-hidden`, sinon le nom accessible les collait — « Tous83 ») ; leur compte suit désormais la recherche en cours, pas seulement le jeu. Une section vidée par un filtre actif dit « Aucun résultat pour cette recherche. » (`sectionEmptyMessage`), distinct d'une section réellement sans tournoi. L'en-tête d'une section pose enfin le bouton **dans** son `<h2>` et non l'inverse (un titre n'est pas du contenu phrasé, il ne pouvait pas vivre dans un `<button>`) — au prix d'un `aria-label` qui retranche le nom accessible du `<h2>` au seul titre et à son accent (« · STAFF »), sans quoi il collerait aussi l'index et le compte ; `aria-controls` ne le relie à son corps que **section dépliée**, jamais vers un id absent du DOM d'une section fermée par défaut. Les quatre sections à cartes sont bornées à 12 par défaut, avec un « Voir plus » **réversible** (`ShowMoreRow`) — la version d'origine, propre à « Terminés », ne savait que déplier, et l'état déplié est un **drapeau** (`expandedSections`), pas un total figé au clic qui resterait périmé après un rafraîchissement de fond. Voir `docs/features/TOURNAMENT_LIST_TOOLBAR.md`.
