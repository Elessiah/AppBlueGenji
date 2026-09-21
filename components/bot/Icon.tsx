/**
 * Le logo Discord, en SVG inline.
 *
 * Six autres pictogrammes (`relay`, `swords`, `user`, `bell`, `key`, `chart`)
 * vivaient ici : ils n'habillaient que la grille « Modules », un bloc que rien ne
 * branchait et qui est parti. Les garder « au cas où » n'aurait servi qu'à faire
 * croire que la page en dessine sept.
 */
interface IconProps {
  name: "discord";
  size?: number;
}

export function Icon({ size = 22 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19.3 4.4A18 18 0 0014.9 3l-.2.4a16 16 0 014 2 14 14 0 00-13.4 0c1.2-.8 2.6-1.6 4-2L9 3a18 18 0 00-4.3 1.4C2 8.5 1.3 12.4 1.7 16.3a18 18 0 005.5 2.8l1.1-1.6a12 12 0 01-1.8-.9l.4-.3a13 13 0 0010.2 0l.4.3a12 12 0 01-1.8.9l1.1 1.6a18 18 0 005.5-2.8c.5-4.5-.4-8.4-2.9-12zM8.5 14.2c-1.1 0-2-1-2-2.3s.9-2.3 2-2.3 2 1 2 2.3-.9 2.3-2 2.3zm7 0c-1.1 0-2-1-2-2.3s.9-2.3 2-2.3 2 1 2 2.3-.9 2.3-2 2.3z" />
    </svg>
  );
}
