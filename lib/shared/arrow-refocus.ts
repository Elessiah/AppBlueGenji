/**
 * Flèches de réordonnancement d'une liste de la vitrine (partenaires, piliers et
 * chiffres de « L'association ») : après un déplacement, à quel bouton rendre
 * le focus (`docs/features/BUSY_BUTTONS.md`). Module **pur**.
 *
 * La carte déplacée change de place dans le DOM : React déplace son nœud, et un
 * bouton focalisé qui sort du document perd le focus (il tombait sur le
 * `<body>`, au milieu d'une série de déplacements au clavier). On le rend donc
 * à la flèche pressée, retrouvée par `data-arrow` ; arrivée en bout de liste
 * (`data-edge`, la flèche ne mène plus nulle part), à la flèche opposée, qui
 * ramène la carte d'où elle vient.
 */
export type ArrowDirection = "up" | "down";

/** Valeur de `data-arrow` d'une flèche : la liste, la carte, le sens. */
export function arrowKey(list: string, id: number, direction: ArrowDirection): string {
  return `${list}:${id}:${direction}`;
}

/** Ce que la recherche d'une flèche rend : il suffit de savoir si elle est en bout. */
export type ArrowCandidate = { dataset: { edge?: string } };

/**
 * La flèche à focaliser : la pressée si elle mène encore quelque part, sinon
 * l'opposée, sinon la pressée quand même (liste d'une seule carte) ; `null`
 * si la carte n'est plus rendue (supprimée, liste rechargée).
 */
export function pickArrowTarget<T extends ArrowCandidate>(pressed: T | null, opposite: T | null): T | null {
  if (pressed && pressed.dataset.edge === undefined) return pressed;
  return opposite ?? pressed;
}
