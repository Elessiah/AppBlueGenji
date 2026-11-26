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
3. Indicateurs : visiteurs quotidiens cumulés (jamais appelés « visiteurs
   uniques » : somme des visiteurs de chaque jour), pages vues, visites,
   visiteurs par jour, temps par
   visite, temps par page, pages par visite, visites d'une seule page — chacun
   comparé à la période précédente de même durée quand elle est entièrement
   mesurée (flèche + texte, couleur neutre : une hausse n'est pas jugée).
4. Évolution (courbe visiteurs + pages vues ; à la semaine au-delà de 92 jours,
   au mois au-delà de 731).
   Regroupée à la semaine ou au mois, la série s'appelle « Visiteurs quotidiens
   cumulés » (« Daily visitors, summed ») et la bulle d'aide le dit.
5. Visiteurs quotidiens cumulés par semaine (26 dernières), mois (24) et
   année — **somme des visiteurs uniques de chaque jour**, dit dans le titre
   et son « i » : une personne venue trois jours compte trois fois. Les
   chiffres montrés aux partenaires ne doivent jamais paraître plus forts
   qu'ils ne sont.
6. Pages les plus consultées : par type de page, vues, part, temps moyen.
   Un type vu par moins de `AUDIENCE_MIN_VISITORS` (5) visiteurs **dans une
   journée** rejoint, pour ce jour, « Autres pages » — avec, si ce groupe
   reste sous 5 visiteurs distincts, le plus petit type suivant
   (`anonymizeAudienceDay` au repli ; voir `AUDIENCE_MEASUREMENT.md`) : aucune
   ligne, ni aucun écart avec les totaux, ne décrit une poignée de personnes.
7. Moments de visite : carte de chaleur jour × heure (rampe bleue à 5 paliers,
   lecture au survol, pic annoncé), barres par jour de la semaine et par heure.
   Une heure d'un jour sous 5 visiteurs (et, si besoin, la plus petite
   suivante) n'y est pas comptée.
8. Qui nous consulte : appareils, provenance, langue — barres segmentées,
   couleur fixée par catégorie (jamais par rang), légende chiffrée. Les
   lignes d'un jour sous 5 visiteurs y forment « Non détaillé » (« Not broken
   down », `small`) — jamais « non comptés » : ces visiteurs sont dans les
   totaux, seule leur répartition est tue. Le « i » de la carte l'explique
   (`audience.hint`). Le groupe a sa teinte neutre, `--st-series-rest`
   (`shareTone`), la même dans les trois répartitions et toujours en dernier :
   il ne reprend jamais la teinte d'une catégorie (la provenance a 6
   familles, une 7ᵉ teinte de palette retomberait sur celle d'« Accès
   direct »). Le seuil des textes vient de `AUDIENCE_MIN_VISITORS` (`{min}`).
9. La communauté : tournois publiés joués (en cours ou terminés, `PLAYED_STATES`
   comme les fiches d'équipe et les profils), matchs joués de ces tournois (hors exemptions),
   équipes et comptes **avec la définition de l'accueil**
   (`lib/server/site-counts.ts` : équipes de l'annuaire, comptes du site) —
   deux pages publiques ne publient pas deux chiffres différents.
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
  orange, sarcelle, violet, magenta, vert ; chaque teinte ≥ 3:1 sur le blanc,
  test `palette_*`, segments de barre séparés d'un filet blanc), séquentielle bleue pour la carte de
  chaleur. Un seul axe, traits de 2 px, barres ≤ 24 px aux bouts arrondis,
  grille discrète, info-bulles, légende dès deux séries, **tableau de données**
  repliable sous chaque graphique (dans une `<ScrollArea>`).
- **Chart.js 4** (MIT), réduit aux contrôleurs utiles
  (`app/frequentation/chart-setup.ts`) et chargé **à la demande** par
  `AudienceChart` : aucune autre page n'en charge rien. Pas d'animation.
- Mobile (375 px) : indicateurs sur deux colonnes, cartes empilées, carte de
  chaleur resserrée (24 colonnes tiennent sans défilement).

## Structure et explications

- En-tête (`<header>`), `<main id="contenu">` puis pied (`<footer>`) **en
  frères** : les repères `banner` et `contentinfo` ne sont pas noyés dans
  `main`. Pas de `PublicPageShell` (D76 : page formelle hors du site vitrine).
- Les explications (sous-titres de cartes, indicateur cumulé, provenance,
  communauté) sont derrière `<InfoHint>` (`INFO_HINTS.md`) ; la page redéfinit
  les jetons qu'il lit (`--blue-*`, `--cyber-bg-2`, `--ink-soft`) aux teintes
  de la page blanche. Seul l'état vide garde sa phrase visible.
- Les graphiques en marge de la carte de chaleur reçoivent des tableaux
  mémorisés : survoler une case ne recrée pas les graphiques.

## Textes

`messages/{fr,en}/audience.json` (espace de noms `audience`), sans `next-intl`
côté client : la page remplit ses `{nom}` par `fillTemplate`. Nombres et dates
par `Intl` dans la langue de la page.

## Fichiers

`app/frequentation/page.tsx` (serveur : métadonnées, lecture
`getAudienceStats()` en cache 10 min), `AudienceDashboard.tsx`,
`AudienceChart.tsx`, `chart-setup.ts`, `frequentation.module.css`.

## Accessibilité des graphiques (UI/UX, cycle 1)

- Nom accessible de chaque graphique : titre + total/minimum/maximum/nombre de
  points de chaque série + renvoi au tableau (`chartAriaLabel`) ; si Chart.js ne
  se charge pas, un message de repli et un toast d'erreur (`once`).
- Carte de chaleur : 168 boutons étiquetés (« Lundi, 14 h : 12 pages vues »),
  un seul arrêt de tabulation, flèches/Début/Fin (`nextHeatCell`), clic ou
  focus = lecture de la case ; l'état de survol est local à la carte.
- Base injoignable : état « Statistiques momentanément indisponibles », distinct
  de l'état vide.
- Graphique par semaine/mois/année : série « Visiteurs quotidiens cumulés ».
