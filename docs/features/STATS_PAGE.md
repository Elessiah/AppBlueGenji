# Page des statistiques de fréquentation (`/frequentation`)

Page **publique non référencée** (D76) qui présente la fréquentation du site
aux partenaires, sponsors et annonceurs. Données : la mesure T19
(`AUDIENCE_MEASUREMENT.md`), plus quatre totaux de la plateforme.

## Diffusion

- Adresse : `/frequentation`, et `/en/frequentation` (route traduite,
  `MIGRATED_ROUTES`).
- `noindex, nofollow` (et `googleBot` idem) dans les métadonnées ; **absente**
  du sitemap (`lib/shared/sitemap.ts` ne la liste pas) et de tout menu. Elle
  n'est **pas** interdite dans `robots.txt` : un robot qui ne peut pas lire la
  page ne verrait pas son `noindex`. On la partage par son lien.
- Lisible par tous, sans compte ; la mise en avant du recrutement s'y tait
  (`onAudiencePage` dans `app/layout.tsx`). Elle n'est pas comptée par la mesure
  T19 (`audiencePageKey` l'écarte).

## Contenu

1. En-tête : surtitre « Dossier partenaires », titre, date des dernières données
   (la veille, heure de Paris : le jour en cours n'est jamais montré) et date de
   début de la mesure.
2. Période : 7 jours, 30 jours (défaut), 12 mois, depuis le début. Tout se
   recalcule côté client à partir des agrégats quotidiens : changer de période
   ne fait aucune requête.
3. Indicateurs : visiteurs, pages vues, visites, visiteurs par jour, temps par
   visite, temps par page, pages par visite, visites d'une seule page — chacun
   comparé à la période précédente de même durée quand elle est entièrement
   mesurée (flèche + texte, couleur neutre : une hausse n'est pas jugée).
4. Évolution (courbe visiteurs + pages vues ; à la semaine au-delà de 92 jours,
   au mois au-delà de 731).
5. Visiteurs par semaine (26 dernières), mois (24) et année — **somme des
   visiteurs uniques de chaque jour**, dit sous le titre.
6. Pages les plus consultées : par type de page, vues, part, temps moyen.
7. Moments de visite : carte de chaleur jour × heure (rampe bleue à 5 paliers,
   lecture au survol, pic annoncé), barres par jour de la semaine et par heure.
8. Qui nous consulte : appareils, provenance, langue — barres segmentées,
   couleur fixée par catégorie (jamais par rang), légende chiffrée.
9. La communauté : tournois terminés publiés, matchs joués (hors exemptions),
   équipes (hors entrées solo, fantômes, supprimées), comptes actifs.
10. Pied : méthode (4 points), lien `/rgpd#audience-detaillee`, « Code source »
    (AGPL), nom de l'association, retour au site.

Sans donnée repliée : état vide (« Les premières mesures arrivent »), la
communauté restant affichée. Base injoignable : même état vide.

## Design (D76, D77)

- **Blanc et formel**, hors « Cyber minimal » : jetons `--st-*` posés sur la
  racine de la page (`app/frequentation/frequentation.module.css`), texte
  ≥ 4,5:1 (encre `#0b0b0b`, secondaire `#4a4945`, lien `#1c5cab`), plancher
  11 px, Inter. Aucune couleur écrite dans le TSX : Chart.js lit les jetons sur
  la page (`getComputedStyle`).
- Palette de la compétence dataviz : catégorielle dans l'ordre fixe (bleu,
  orange, aqua, jaune, magenta, vert), séquentielle bleue pour la carte de
  chaleur. Un seul axe, traits de 2 px, barres ≤ 24 px aux bouts arrondis,
  grille discrète, info-bulles, légende dès deux séries, **tableau de données**
  repliable sous chaque graphique (dans une `<ScrollArea>`).
- **Chart.js 4** (MIT), réduit aux contrôleurs utiles
  (`app/frequentation/chart-setup.ts`) et chargé **à la demande** par
  `AudienceChart` : aucune autre page n'en charge rien. Pas d'animation.
- Mobile (375 px) : indicateurs sur deux colonnes, cartes empilées, carte de
  chaleur resserrée (24 colonnes tiennent sans défilement).

## Textes

`messages/{fr,en}/audience.json` (espace de noms `audience`), sans `next-intl`
côté client : la page remplit ses `{nom}` par `fillTemplate`. Nombres et dates
par `Intl` dans la langue de la page.

## Fichiers

`app/frequentation/page.tsx` (serveur : métadonnées, lecture
`getAudienceStats()` en cache 10 min), `AudienceDashboard.tsx`,
`AudienceChart.tsx`, `chart-setup.ts`, `frequentation.module.css`.
