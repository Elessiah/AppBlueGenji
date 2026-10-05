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
- **Pas de « Règles des tournois » dans les menus.** L'association ne joue pas tous
  les modes que le moteur sait faire tourner : l'index `/regles` exposait des modes
  qu'aucun de ses tournois n'utilise. Les pages restent en ligne et indexées (sitemap),
  mais on y entre par le tournoi lui-même — bouton flottant `RulesHelpFab`, qui vise
  le mode **réellement joué** — et par les conditions d'utilisation, qui invoquent
  ces règles (`/conditions-utilisation`).

## Contenu

| Menu burger | Pied de page |
|---|---|
| Tournois · Équipes · Classement · Joueurs · Recrutement · Bot · L'asso · Bénévoles | COMPÉTITIONS : Tournois, Classement (`/classement`), Bot · ASSOCIATION : Manifeste, Bénévoles, Partenaires · CONTACT (courriel, tag et serveur Discord, `FooterContact`) · LÉGAL (voir `LEGAL_PAGE.md`) |

## Barre des connectés

`ArenaNav` (`components/arena-nav.tsx`, pages `/(secured)`) liste
`ARENA_NAV_LINKS` : Joueurs (glacier `--blue-500-rgb`), Équipes (violet
`--violet-400-rgb`), Tournois (vert d'eau `--teal-400-rgb`), **Classement**
(`/classement`, rose `--pink-400-rgb`). Chaque lien a sa propre teinte, jamais
chaude (ni rouge du direct, ni ambre, ni `--result-loss`), et porte
`aria-current="page"` sur sa section (`isNavLinkActive`). `/classement` est une
page publique (hors `(secured)`) : on y arrive sous l'en-tête vitrine, la
barre des connectés n'y est pas rendue — son `aria-current` ne s'allume donc
que si la page passe un jour sous cette barre. En mobile (≤ 720 px)
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

- `tests/app/navigation-a11y.test.tsx` — adresses uniques du menu, absence de `/regles` ;
  barre des connectés : lien « Classement » et son `aria-current`, teintes
  froides toutes distinctes.
- `tests/app/legal-forms-consistency.test.ts` — pied de page : adresses uniques,
  absence de `/regles`, lien des conditions d'utilisation vers les règles.
