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

Le raccourci affiché suit la plateforme (`searchShortcutLabel`, pur) : « ⌘K »
sur un clavier Apple (`Mac`, `iPhone`, `iPad`, `iPod` dans
`navigator.platform`), « Ctrl+K » partout ailleurs — y compris Windows et
Linux, où le raccourci fonctionne (`Ctrl` est déjà lu par le gestionnaire de
touches) mais s'affichait en `⌘K`. Valeur par défaut `Ctrl+K` au rendu serveur
(sûre, sans DOM), corrigée une fois côté client au montage.

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
cartes par défaut, avec un bouton **réversible** « Voir plus (+N) » /
« Voir moins » (`ShowMoreRow`) — la version d'origine, propre à la section
« Terminés » seule, ne savait que déplier, jamais replier. L'état déplié vit
dans un `expandedSections: Set<LimitedSectionKey>` (un **drapeau**, pas un
compte figé au clic) vidé à chaque changement de recherche ou de filtre de
jeu, pour ne pas laisser une section dépliée sur un résultat qu'on ne cherche
plus. Un drapeau plutôt qu'un total capturé : la page se rafraîchit de fond en
fond, et une section dépliée sur « 46 » ne doit pas rester bornée à ce chiffre
quand un rafraîchissement en apporte 50 — elle montre alors les 50 sans qu'on
ait besoin de redéplier.

## « Créer un tournoi »

Le bouton était un `<button>` posé dans un `<Link>` — deux contrôles
interactifs imbriqués, deux arrêts de tabulation pour un seul geste. Il passe
par `<CyberButton asChild variant="primary"><Link href="/tournois/creer">…`,
qui fusionne les deux en un seul `<a>` (le composant partagé du site pour ce
geste, `components/cyber/CyberButton.tsx`) ; les styles propres au bouton
(`.create`) ont disparu avec lui, `CyberButton` en variante `primary` rendant
déjà la même apparence.
