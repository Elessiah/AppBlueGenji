# Navigation des pages vitrine — menu burger et pied de page

Deux listes de liens sur les pages vitrine : le menu burger de l'en-tête
(`PUBLIC_NAV_LINKS`, `components/cyber/landing/PublicNavMenu.tsx`) et les colonnes
du pied de page (`components/cyber/landing/PublicFooter.tsx`).

## Règles

- **Une adresse, une entrée.** Deux libellés vers la même page (« Tournois actifs » et
  « Archives » vers `/tournois`, « Partenaires » et « Partenariats » vers
  `/#sponsors`, « Bénévoles » et « Équipe bénévole » vers `/benevoles`, « Discord » de
  l'ancienne colonne COMMUNAUTÉ et « Serveur Discord » de CONTACT vers la même invitation) allongeaient
  les listes sans rien ouvrir de plus : il n'en reste qu'un. Le menu burger le
  vérifie par test ; le pied de page aussi.
- **Les annonces GETI en tête du menu burger, mises en avant.** `/geti-info` est une
  fonction principale du site : son entrée (« Annonces GETI » / « GETI posts »,
  `featured`) ouvre la liste, encadrée et teintée glacier (`.linkFeatured` — bordure
  et graisse, pas la seule couleur). Elle mène à l'adresse canonique de la liste par
  défaut, `/geti-info/lfp` (`GETI_DEFAULT_LIST_PATH`, comme le bouton de l'accueil :
  une seule adresse par liste), et reste page courante sur toute la rubrique
  (`section: "/geti-info"`, donc aussi sur `/geti-info/lfs`) — alors
  `.linkFeatured.linkActive` : bordure pleine, fond plus soutenu, trait intérieur.
- **La page courante se voit autrement que par la couleur**, sur toute entrée du
  menu : `.linkActive` pose un trait intérieur à gauche en plus de la teinte
  (WCAG 1.4.1), et `aria-current="page"` la dit aux lecteurs d'écran.
- **Rien dans le menu burger ne mène à la partie compétitive.** « Tournois »,
  « Équipes », « Classement » et « Joueurs » en sont sortis (GETI-NAV) : on entre
  dans la compétition par l'accueil (tableau des tournois, classement, calendrier),
  par le bouton « Accéder à la partie compétitive » de l'en-tête une fois connecté —
  qui ouvre la barre des connectés, inchangée — et par la colonne COMPÉTITIONS du
  pied de page. Un test interdit leur retour.
- **Pas de « Règles des tournois » dans les menus.** L'association ne joue pas tous
  les modes que le moteur sait faire tourner : l'index `/regles` exposait des modes
  qu'aucun de ses tournois n'utilise. Les pages restent en ligne et indexées (sitemap),
  mais on y entre par le tournoi lui-même — bouton flottant `RulesHelpFab`, qui vise
  le mode **réellement joué** — et par les conditions d'utilisation, qui invoquent
  ces règles (`/conditions-utilisation`).

## Contenu

| Menu burger | Pied de page |
|---|---|
| **Annonces GETI** (`/geti-info/lfp`, mise en avant) · Bot · L'asso · Recrutement · Bénévoles | COMPÉTITIONS : Tournois, Classement (`/classement`), Bot · ASSOCIATION : Manifeste, Bénévoles, Partenaires · CONTACT (courriel, tag et serveur Discord, `FooterContact`) · LÉGAL (voir `LEGAL_PAGE.md`) |

L'adresse vient de `lib/shared/geti/path.ts` (`GETI_PAGE_PATH`, module sans aucune
dépendance, que `page.ts` réexporte) : `PublicNavMenu`, composant client de l'en-tête de
chaque page, ne doit jamais importer `page.ts`, qui chargerait les filtres des annonces
(un test le tient). Le menu, l'encart et la page n'ont ainsi qu'une source. L'accueil
annonce aussi la page (`GetiSpotlight`, voir `GETI_INFO.md` § Navigation).

Coût de l'encart à l'accueil : aucune lecture de données ni requête (texte du bundle
`landing`, rendu serveur), `InfoHint` déjà dans le paquet de l'accueil (`AboutStats`),
aucun message envoyé au client ; compact sous 720 px pour ne pas repousser le tableau
des tournois. Le bouton burger (44 px) ne fige aucune hauteur d'en-tête : les décalages
collants se mesurent (`StickyHeaderOffset`).

## Barre des connectés

`SiteNav` (`components/site-nav.tsx`, pages `/(secured)`) liste
`SITE_NAV_LINKS` : Joueurs (glacier `--blue-500-rgb`), Équipes (violet
`--violet-400-rgb`), Tournois (vert d'eau `--teal-400-rgb`), **Classement**
(`/classement`, rose `--pink-400-rgb`). Chaque lien a sa propre teinte, jamais
chaude (ni rouge du direct, ni ambre, ni `--result-loss`), et porte
`aria-current="page"` sur sa section (`isNavLinkActive`). `/classement` est une
page publique (hors `(secured)`) qui suit la session (`SessionPageShell`, voir
`RANKING_PAGE.md`) : un connecté y retrouve cette barre, « Classement » en
page courante ; un déconnecté, l'en-tête vitrine. En mobile (≤ 720 px)
les liens passent sur une seconde ligne qui se replie : pas de menu à part.
Entre 721 et 1000 px, les quatre liens tiennent dans leur tiers de grille par
un interlettrage resserré (0,08 em) et, en dernier recours, passent à la ligne
plutôt que de décentrer le logo ou de rogner le pseudo, le trait du lien actif
remonté sous son libellé (vérifié à 721, 768, 900 et 1010 px : aucun
débordement horizontal). Sous 720 px, l'interlettrage passe à 0,06 em (nul
sous 380 px) pour garder les quatre liens sur une seule ligne dès 360 px.

Accessibilité du menu (Échap, sortie au clavier, `aria-current`) →
`ACCESSIBILITY_LANDMARKS_FOCUS.md`.

## Tests

- `tests/app/navigation-a11y.test.tsx` — contenu exact du menu (annonces GETI en
  tête et seules mises en avant, aucune adresse de la partie compétitive, libellé
  anglais), adresses uniques, absence de `/regles` ;
  barre des connectés : lien « Classement » et son `aria-current`, teintes
  froides toutes distinctes.
- `tests/app/legal-forms-consistency.test.ts` — pied de page : adresses uniques,
  absence de `/regles`, lien des conditions d'utilisation vers les règles.
