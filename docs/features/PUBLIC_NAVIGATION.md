# Navigation des pages vitrine — menu burger et pied de page

Deux listes de liens sur les pages vitrine : le menu burger de l'en-tête
(`PUBLIC_NAV_LINKS`, `components/cyber/landing/PublicNavMenu.tsx`) et les colonnes
du pied de page (`components/cyber/landing/PublicFooter.tsx`).

## Règles

- **Une adresse, une entrée.** Deux libellés vers la même page (« Tournois actifs » et
  « Archives » vers `/tournois`, « Partenaires » et « Partenariats » vers
  `/#sponsors`, « Bénévoles » et « Équipe bénévole » vers `/benevoles`) allongeaient
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
| Tournois · Équipes · Joueurs · Recrutement · Bot · L'asso · Bénévoles | COMPÉTITIONS : Tournois, Classement · COMMUNAUTÉ : Discord, Bot · ASSOCIATION : Manifeste, Bénévoles, Partenaires · CONTACT · LÉGAL (voir `LEGAL_PAGE.md`) |

Accessibilité du menu (Échap, sortie au clavier, `aria-current`) →
`ACCESSIBILITY_LANDMARKS_FOCUS.md`.

## Tests

- `tests/app/navigation-a11y.test.tsx` — adresses uniques du menu, absence de `/regles`.
- `tests/app/legal-forms-consistency.test.ts` — pied de page : adresses uniques,
  absence de `/regles`, lien des conditions d'utilisation vers les règles.
