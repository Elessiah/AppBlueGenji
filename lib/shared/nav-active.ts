/**
 * Le lien de navigation qui désigne la page courante.
 *
 * Écrit une fois pour les deux navigations du site (`ArenaNav` de l'espace
 * connecté, `PublicNavMenu` de la vitrine), qui en tenaient chacune une copie.
 * La réponse sert **deux** lecteurs : le style du lien actif, et
 * `aria-current="page"` — sans lequel la page courante ne se signalait que par
 * la couleur, invisible d'un lecteur d'écran (WCAG 1.3.1).
 *
 * Une section est active sur sa page et sur ses sous-pages (`/equipes/12`
 * désigne encore « Équipes »), mais pas sur une page qui commence seulement
 * pareil (`/equipes-archive`). Un lien vers une ancre (`/#tournois`) ne désigne
 * jamais la page courante : il mène à un endroit de l'accueil, pas à une page.
 */
export function isNavLinkActive(pathname: string | null | undefined, href: string): boolean {
  if (!pathname || !href.startsWith("/") || href.includes("#")) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
