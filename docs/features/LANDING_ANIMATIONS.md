# Accueil vivant — animations et couleurs (`/`)

Demande du 2026-10-05 : un accueil « plus vivant », plus lumineux, qui fasse rêver côté jeu, et une pastille « En attente de lancement » qui ressorte. Ce lot pose la **fondation de couleurs** du site (`DESIGN_SYSTEM.md` § Palette « néon froid ») et refait l'accueil ; les autres pages suivent par lots (plus bas).

## Ce qui change sur l'accueil

| Élément | Avant | Après |
| --- | --- | --- |
| Fond du hero | halo bleu fixe | deux éclats (cyan, violet) qui dérivent lentement (`Hero.module.css` `.glint`) |
| Chute du titre | dégradé bleu → bleu | `--grad-brand` cyan → glacier → violet |
| Chiffres du hero | bleu uni, fixes | dégradé de marque, décompte de 0 à la valeur (`CountUp`) |
| Carte du match mis en avant | bordure grise | halo bleu → violet, reflet qui balaie la bordure haute (`LiveCard.module.css` `.shimmer`) ; sigle de l'équipe 2 violet (plus ambre) |
| « En attente de lancement » | pastille grise | `pill-waiting` : violet, halo qui respire ; l'horaire à côté en cyan gras (`.when`) |
| Titres de section | texte seul | trait d'accent en dégradé sous le titre |
| Sections sous le hero | statiques | apparition au défilement, une fois (`Reveal`) |
| Cartes et boutons | bordure au survol | léger agrandissement + halo (`CyberCard lift`, `CyberButton`) — un agrandissement, pas une translation : la carte ne fuit pas un pointeur posé sur son bord |
| Calendrier | état gris, barre grise | état en violet, barre en dégradé |

Contenus, liens, structure SEO, repères (`PublicPageShell`), noms accessibles, plancher de 11 px, logique et rafraîchissement du match mis en avant (`FEATURED_MATCH_LINK.md`) : inchangés. `featuredMatchPill` rend désormais la teinte `waiting` (au lieu de `default`) pour un match daté.

## Règles des animations

- **Une seule porte** : `decorativeMotion` de `useClientPower()` — déjà faux sous `prefers-reduced-motion`, sous « Réduire les animations » du menu d'accessibilité (`data-a11y~="motion"`), onglet caché ou machine à la peine. `Reveal` et `CountUp` ne relisent rien d'autre ; logique pure dans `lib/shared/landing-motion.ts` (`shouldDeferReveal`, `countUpValue`).
- **Animations CSS infinies** (éclats, reflet, pastille d'attente) : `animation-play-state: var(--deco-anim-state)` (balayage `deco-animations.test.ts`), plus une variante fixe pour le reflet et des survols sans déplacement, posées **à la fois** sous `prefers-reduced-motion` et sous `:root[data-a11y~="motion"]` (`:global(...)` dans les modules) — le menu ne fait sinon que raccourcir les transitions.
- **Transform et opacité seulement** : aucune animation ne touche la mise en page. Le décompte réserve sa largeur (`min-width` en `ch` sur la valeur finale, chiffres tabulaires).
- **Visible sans JavaScript** : le rendu serveur n'écrit aucune classe de masquage ; `reveal-pending` n'est posée qu'après hydratation, et **jamais** sur une section déjà à l'écran (pas d'éclair plein → vide, pas de recul du LCP). Le hero n'est pas enveloppé. `CountUp` écrit la valeur finale côté serveur, et la garde pour les lecteurs d'écran (`sr-only`) pendant le décompte, le chiffre qui défile étant `aria-hidden`. Une section masquée se montre dès son premier pixel à l'écran **et** dès qu'un de ses contrôles prend le focus (`focusin`) : la tabulation ne pose jamais le focus sur un contrôle invisible (WCAG 2.4.7).
- **Pas d'éclair au décompte** : un chiffre déjà à l'écran au chargement roule de 85 % à sa valeur (`countUpStart`), seul un chiffre encore **sous** la fenêtre part de 0 (un chiffre déjà dépassé, au-dessus, ne se décompte pas) ; déjà à l'écran, il ne part que dans les 1,5 s du chargement (`countUpMayStart`) — une fenêtre ouverte sans focus ne le lance pas au premier clic. À l'impression, `reveal-pending` est neutralisée (`@media print`).
- **Une fois, vraiment** : une section ou un chiffre montré sans animation (mouvement coupé, fenêtre sans focus) est réglé pour de bon — le retour des animations ne le masque ni ne le décompte à nouveau.
- **Une fois** : l'observateur se déconnecte à la première entrée à l'écran ; la boucle `requestAnimationFrame` du décompte s'arrête au bout de `COUNT_UP_MS` (1,2 s).
- **Halo et impression** : le halo de la pastille d'attente est une ombre fixe sur un `::after` dont seule l'opacité s'anime (pas de repeint par image). À l'impression, `.text-gradient` reprend une couleur pleine (les fonds ne s'impriment pas) et le décompte cède la place à la valeur réelle (`.count-up-real`).
- **Coût** : éclats en dégradés radiaux sans `filter: blur`, reflet sur une barre de 2 px ; aucune dépendance ajoutée.

Tests : `tests/lib/shared/landing-motion.test.ts` (porte, bornes du décompte), `tests/app/landing-motion-render.test.tsx` (classe par état de pastille, rendu sans JS), `tests/app/neon-palette.test.ts` (contrastes, « jamais tout gris », pas de teinte chaude, variantes).

## Lots suivants (ordre proposé)

Chaque lot reprend les jetons et variantes de `DESIGN_SYSTEM.md`, sans nouvelle teinte ; l'effet des jetons (textes bleutés, pastilles bleutées, cartes, boutons, traits d'accent) s'applique déjà partout.

1. **Pages tournoi** (`/tournois`, fiche, arbre, sections de manche) : états de tournoi et de match en variantes sémantiques (`accent` à venir, `info` en cours, `success` terminé), titres de phase en dégradé, cartes de match avec halo au survol.
2. **Équipes et joueurs** (`/equipes`, `/joueurs`, fiches) : rôles d'équipe (`TANK`/`DPS`/`HEAL`, `OWNER`…) en étiquettes colorées par rôle, sigles teintés.
3. **Profil** (`/profil`) : sections, connexions et préférences en cartes teintées ; badges d'état de compte.
4. **Pages de règles** (`/regles`, `/regles/[slug]`) et vitrine (`/association`, `/partenaires`, `/bot`) : accents de section, schémas aux couleurs néon.
5. **Administration et signalements** (`app/api/admin/`, `/signalements`) : migrer les usages restants d'`--amber` (avertissements, « Urgente », retour en arrière) vers `highlight`/`accent` — **décision requise** : remplacer l'ambre des avertissements par le rose néon ou garder un ambre fonctionnel.
6. **Nettoyage** : retirer les jetons hérités (`--accent-orange`, `--orange-rgb`, `--text-*` doublons des `--ink*`) une fois sans lecteur.
