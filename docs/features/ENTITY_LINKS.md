# Noms cliquables — liens d'équipe et de joueur

Un nom d'équipe ou de joueur mène à sa fiche, **partout où il est affiché**.

Avant, la règle n'existait qu'en pointillé : le plateau et les classements d'un
tournoi liaient leurs engagés, mais l'aperçu du plateau, le seeding, le
classement d'endurance, la bannière de la championne, les demandes d'adhésion,
les invitations reçues, le roster d'une carte d'annuaire et le classement de
l'accueil n'affichaient que du texte mort. Le nom qu'on voulait ouvrir n'était
jamais celui sur lequel on pouvait cliquer.

## Les trois destinations

| Composant | Fichier | Mène à |
| --- | --- | --- |
| `TeamLink` | `components/entity-link.tsx` | `/equipes/[id]` |
| `PlayerLink` | `components/entity-link.tsx` | `/joueurs/[id]` |
| `EntrantLink` | `app/(secured)/tournois/[id]/_lib/entrant-link.tsx` | l'un ou l'autre, selon le tournoi |

`EntityLink` est la primitive des trois : elle ne fait qu'appliquer la classe
`.entity-link` à un `next/link`.

### Pourquoi un composant plutôt qu'un `<Link>`

Deux raisons, aucune décorative.

**L'affordance.** `app/globals.css` pose `a { color: inherit; text-decoration:
none }` : sans marque au survol, un nom cliquable est indiscernable d'un nom
mort. Chaque écran recopiait donc son propre `style={{ color: "inherit",
textDecoration: "none" }}` — c'est-à-dire *rien*. La classe `.entity-link` porte
l'unique affordance de ces liens (bleu + soulignement au survol, contour au
focus clavier), et un nom se comporte pareil d'un écran à l'autre.

**Le chemin.** Un **engagé** de tournoi est une équipe *ou* un joueur : dans un
[tournoi individuel](SOLO_TOURNAMENTS.md), le `team_id` du moteur désigne une
**entrée solo**, qui n'a pas de fiche d'équipe. Un `/equipes/${id}` écrit à la
main dans une vue de plateau mène donc à un cul-de-sac. `EntrantLink` résout le
chemin par le contexte de la page (`soloUserIds`), et le test
`tests/app/entity-links.test.ts` interdit à ces vues d'écrire un chemin
elles-mêmes.

## Les cartes d'annuaire : deux destinations, une seule ancre

`TeamCard` et `PlayerCard` mènent à une fiche **et** portent des liens
imbriqués — les visages du roster pour l'une, le nom de l'équipe pour l'autre.
Un `<a>` dans un `<a>` est invalide (erreur d'hydratation React, destination
indistincte au clavier comme au lecteur d'écran), donc le lien de la carte
n'enveloppe plus son contenu : c'est une **plaque transparente** posée
par-dessus.

```
<article class="card">              ← la carte, plus un lien
  <a class="cardOverlay" />         ← position: absolute; inset: 0; z-index: 1
  …contenu statique, sous la plaque…
  <a class="rosterItem">…</a>       ← position: relative; z-index: 2 — repasse au-dessus
</article>
```

**Le `z-index` de la plaque n'est pas décoratif.** Une carte porte des enfants
déjà positionnés — la pastille de rang, le sigil, le cadre d'avatar — sans
`z-index` à eux. En `z-index: auto`, ils appartiennent à la même couche de
peinture que la plaque et, venant après elle dans le DOM, ils passent
**au-dessus** : un clic sur le `#01` ou sur l'avatar n'ouvrirait plus rien,
alors qu'il faisait partie du lien quand celui-ci enveloppait la carte. D'où
trois étages : décorations positionnées (`auto`) < plaque (`1`) < liens
imbriqués (`2`).

Corollaire : le pointeur ne survole plus les descendants de la carte, seulement
la plaque. Un `:hover` posé sur un descendant (le bouton « Voir l'équipe ») ne
se déclencherait plus jamais — il s'écrit désormais `.card:hover .cta`. Plus
juste, du reste : cliquer n'importe où sur la carte fait ce que le bouton
annonce.

La plaque n'a pas de texte : son seul intitulé est son `aria-label` (« Voir la
fiche de … »). Corollaire dans `TeamCard` : l'avatar du roster devient
décoratif (`alt=""`), le lien qui l'entoure portant déjà le pseudo — sans quoi
le lecteur d'écran l'annoncerait deux fois.

Deux pièges de mise en page, tous deux dus à l'élément de roster nouvellement
intercalé :

- le chevauchement des visages (`margin-left: -6px`) se joue sur cet élément et
  non sur la pastille. `.avatar` est tantôt un `img`, tantôt un `span` ;
  `:first-of-type` ne saurait pas les départager. D'où
  `.rosterItem + .rosterItem` ;
- la pastille « +N » porte `.rosterItem` **et** `.avatar` : un `display`
  différent sur l'un l'emporterait sur l'autre par simple ordre de source, et le
  « +N » sortirait de son cercle. Les deux partagent donc
  `display: grid; place-items: center`.

## Un lien de quatre pixels n'est pas cliquable

Dans le classement d'une ronde suisse et d'une survie, le nom de l'engagé était
le **seul** enfant flexible de la ligne (`flex: 1`, donc de base nulle) : toutes
les autres colonnes portant une largeur fixe, il n'héritait que du reliquat.
Avec le bouton « Abandonner » rendu et la colonne du classement figée à
`flex: 0 0 400px`, ce reliquat tombait à **quatre pixels** — le contenu
principal de la ligne effacé au profit de ses statistiques.

Deux corrections, mécaniques toutes les deux : le nom reçoit une base réelle
(`flex: 1 1 72px`), si bien qu'il rétrécit à proportion des autres au lieu de
perdre à tous les coups ; et la colonne du classement prend l'espace libre
(`flex: 1 1 400px`) plutôt que de rester figée, bornée par un `maxWidth` pour
que les rondes voisines gardent de quoi s'afficher — elles défilent déjà
horizontalement.

## `/equipes/[id]` sur une entrée solo

Rendre les noms cliquables partout fait naître des liens là où l'appelant n'a
qu'un `team_id` sous la main et aucun moyen de savoir ce qu'il désigne —
l'adversaire favori et la bête noire des [statistiques
approfondies](DEEP_STATS.md), par exemple. Si ce `team_id` est une entrée solo,
`getTeamDetail` rend `null` et la page affichait « Équipe non trouvée » sur un
lien pourtant valide.

La règle est posée une fois, à la porte : `GET /api/teams/[id]` répond
**404 `TEAM_IS_SOLO_ENTRY` + `soloUserId`**, et `useTeamDetail` mène au profil
du joueur (`router.replace`, sans message d'erreur — le lien était bon, il mène
simplement ailleurs). Le 404 est conservé : il n'y a bien pas d'équipe à cet
identifiant ; le corps dit seulement où aller.

C'est ce qui permet à tout écran de lier un `team_id` sans se demander ce qu'il
représente. Là où l'information est disponible (page de tournoi, carte du direct
de l'accueil), le chemin reste résolu en amont par `entrantHref` : la
redirection est un filet, pas le chemin nominal.

Pour la porter, `fail()` (`lib/server/http.ts`) accepte un troisième argument
joint au corps de l'erreur, et la branche 404 de `useResourceLoader` lit ce
corps avant de prévenir l'appelant.

## Carte du direct de l'accueil

`LandingLiveMatch` transporte `team1Href` / `team2Href`, résolus **côté
serveur** par `entrantHref` : la carte n'a pas de quoi savoir si le match à
l'antenne oppose des équipes ou des joueurs. Une place vide — bye, adversaire
pas encore désigné — rend `null`, et le nom s'affiche alors sans lien plutôt
qu'avec un lien mort.

## Ce qui reste volontairement hors du champ

- **Les dialogues** (édition de score, programmation, diffusion, transfert de
  propriété, rôles) : un lien y ferait quitter la page au milieu d'une saisie.
- **Le sélecteur d'équipe fantôme** : c'est un `<select>`, pas un affichage.
- **Le nom d'équipe des annonces de recrutement** : champ de texte libre, sans
  `team_id` derrière.
- **Le ticker** de l'accueil : des chaînes de caractères composées côté serveur.

## Fichiers

| Rôle | Fichier |
| --- | --- |
| Composants de lien | `components/entity-link.tsx` |
| Lien d'engagé (contexte tournoi) | `app/(secured)/tournois/[id]/_lib/entrant-link.tsx` |
| Règle de chemin (pure) | `lib/shared/participants.ts` (`entrantHref`) |
| Affordance | `app/globals.css` (`.entity-link`) |
| Plaque des cartes | `app/(secured)/equipes/cards/TeamCard.module.css`, `app/(secured)/_shared/annuaire.module.css` |
| Entrée solo → joueur | `lib/server/solo-entries-service.ts` (`findSoloEntryUser`), `app/api/teams/[id]/route.ts` |
| Tests | `tests/app/entity-links.test.ts`, `tests/app/api/teams/solo-entry-detail.test.ts` |
