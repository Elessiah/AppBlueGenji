/**
 * Mécanique d'un réordonnancement au geste — logique pure, sans DOM.
 *
 * Deux questions, et deux seulement, décident du confort d'un glisser-déposer
 * dans une liste verticale :
 *
 * 1. **où la ligne tirée atterrit-elle ?** — d'après la position du pointeur
 *    par rapport aux emplacements de la liste ;
 * 2. **quand la page doit-elle défiler d'elle-même ?** — sans quoi le geste ne
 *    porte que sur ce qui tient à l'écran, et réordonner trente engagés
 *    resterait aussi laborieux qu'avec les flèches.
 *
 * Les deux se réduisent à de l'arithmétique sur des nombres relevés dans le
 * navigateur, donc à des fonctions pures — testables sans jsdom, et affranchies
 * de React. Le composant ne garde que le relevé des géométries et la boucle
 * d'animation.
 */

/**
 * Index d'accueil d'une ligne tirée, d'après l'ordonnée du pointeur.
 *
 * `slotMidpoints` porte le **milieu vertical de chaque emplacement**, relevé au
 * début du geste et jamais recalculé ensuite : les emplacements ne bougent pas
 * pendant le glissement, seul leur contenu permute. Recalculer les rectangles à
 * chaque mouvement ferait osciller la cible entre deux rangs — la ligne bouge,
 * donc la géométrie qu'on vient de lire décrit déjà un autre état.
 *
 * Sémantique **extraction puis insertion**, jamais échange : tirer le rang 30
 * sur le rang 1 place la ligne en tête et décale les autres d'un cran ; un
 * échange, lui, expédierait le rang 1 en trentième position, ce que personne ne
 * demande en réordonnant un seeding.
 *
 * Le résultat est borné au dernier index : passé le milieu du dernier
 * emplacement, on ne peut pas aller plus bas que la fin de la liste.
 */
export function dropIndexAt(slotMidpoints: readonly number[], pointerY: number): number {
  if (slotMidpoints.length === 0) return 0;

  let index = 0;
  while (index < slotMidpoints.length && pointerY > slotMidpoints[index]) index += 1;

  return Math.min(index, slotMidpoints.length - 1);
}

/**
 * Déplace un élément à un index donné (extraction puis insertion).
 *
 * Renvoie une copie inchangée si l'élément est absent, si l'index visé est hors
 * bornes, ou s'il désigne la place que l'élément occupe déjà — l'appelant peut
 * donc comparer sans précaution pour savoir s'il y a quelque chose à écrire.
 */
export function moveToIndex<T>(order: readonly T[], item: T, targetIndex: number): T[] {
  const from = order.indexOf(item);
  if (from === -1) return [...order];
  if (targetIndex < 0 || targetIndex >= order.length) return [...order];
  if (targetIndex === from) return [...order];

  const next = [...order];
  next.splice(from, 1);
  next.splice(targetIndex, 0, item);
  return next;
}

/** Épaisseur des bandes haute et basse qui déclenchent le défilement, en pixels. */
export const AUTO_SCROLL_EDGE_PX = 96;

/** Vitesse maximale du défilement automatique, en pixels par seconde. */
export const AUTO_SCROLL_MAX_SPEED = 900;

/**
 * Vitesse de défilement automatique quand le pointeur atteint un bord.
 *
 * Négatif = vers le haut, positif = vers le bas, `0` = le pointeur est loin des
 * bords et la page ne bouge pas. La vitesse croît **linéairement** à mesure que
 * le pointeur s'enfonce dans la bande : effleurer le bord fait défiler
 * doucement, s'y coller fait défiler à pleine vitesse. Un défilement à vitesse
 * constante obligerait à choisir entre « trop lent pour trente lignes » et
 * « impossible à arrêter sur la bonne ».
 *
 * Exprimée en pixels **par seconde** et non par image : la boucle multiplie par
 * le temps écoulé, donc le geste se comporte pareil à 60 Hz et à 144 Hz.
 */
export function autoScrollVelocity(
  pointerY: number,
  viewportHeight: number,
  edge: number = AUTO_SCROLL_EDGE_PX,
  maxSpeed: number = AUTO_SCROLL_MAX_SPEED,
): number {
  // Une fenêtre plus courte que ses deux bandes n'a plus de zone neutre : les
  // bandes se chevaucheraient et la page défilerait dans les deux sens à la
  // fois. On préfère alors ne pas défiler du tout.
  if (edge <= 0 || viewportHeight <= 0 || viewportHeight < edge * 2) return 0;

  if (pointerY < edge) {
    const depth = Math.min(edge - pointerY, edge);
    return -(depth / edge) * maxSpeed;
  }

  const fromBottom = viewportHeight - pointerY;
  if (fromBottom < edge) {
    const depth = Math.min(edge - fromBottom, edge);
    return (depth / edge) * maxSpeed;
  }

  return 0;
}
