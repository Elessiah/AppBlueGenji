# Événements de l'accueil cliquables (`CalendarCard`)

Le bloc « Prochains événements » de l'accueil
(`components/cyber/landing/CalendarCard.tsx`) listait les tournois à venir sans
mener nulle part : pour s'inscrire, le visiteur devait retrouver le tournoi à
la main sur `/tournois`. Chaque ligne mène désormais à la fiche de son tournoi
(`/tournois/[id]`).

## Règles

- **Le lien est le nom du tournoi**, étiré sur toute la ligne par un
  `::after` (`.link::after`, `position: absolute` dans `.row`, qui est
  `position: relative`) : date, heure et pastilles mènent aussi à la fiche.
  Faire de la ligne entière un `<a>` lui aurait donné pour nom accessible la
  date, le jeu, l'état, le nom et l'heure concaténés ; ici le nom du lien est
  exactement celui du tournoi, sans `aria-label` (WCAG 2.5.3).
- Le `::after` a pour bloc conteneur la **ligne**, ancêtre du `.title` : le
  `overflow: hidden` qui tronque le nom à deux lignes en mobile ne le rogne
  donc pas.
- Le chemin passe par `tournamentMatchHref` (`lib/shared/match-anchor.ts`),
  écriture unique du chemin d'une fiche de tournoi — sans match, il rend le
  tournoi seul.
- Un visiteur sans compte arrive sur la carte « Connexion requise » de la
  fiche, qui garde la destination : même comportement que la carte « en
  cours » de l'accueil.
- Le focus clavier se dessine sur toute la ligne (`.link:focus-visible::after`),
  le survol éclaire la ligne et le nom.
