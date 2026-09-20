import Image from "next/image";

/**
 * Le tag Discord d'un joueur, et sa pastille de certification.
 *
 * **Passage unique** des trois écrans qui l'affichent (son propre profil, la
 * fiche d'un joueur, les contacts d'un tournoi). La pastille est une image de
 * 360 px servie par le site : elle passe par `next/image`, donc redimensionnée
 * et convertie, comme toute image du dépôt — un `<img>` brut enverrait 6 ko pour
 * en afficher 16 px.
 *
 * La pastille porte un `title` **et** un `alt` : le premier pour la souris, le
 * second parce qu'elle ne répète aucun texte voisin — « vérifié » est une
 * information qui n'existe que là, elle ne peut donc pas être décorative.
 */
const BADGE_SRC = "/badge-certifie.webp";

export type VerifiedBadgeProps = {
  size?: number;
};

export function VerifiedBadge({ size = 16 }: VerifiedBadgeProps) {
  return (
    <Image
      src={BADGE_SRC}
      alt="Tag Discord vérifié"
      title="Tag Discord vérifié : ce joueur a prouvé qu'il possède ce compte Discord."
      width={size}
      height={size}
      style={{ flexShrink: 0, verticalAlign: "middle" }}
    />
  );
}

export type DiscordTagProps = {
  /** Tag à afficher. `null` = rien à montrer (masqué, ou jamais saisi). */
  tag: string | null | undefined;
  verified?: boolean;
  /** Texte rendu à la place d'un tag absent. */
  fallback?: string;
};

/**
 * Tag + pastille, ou le repli.
 *
 * La pastille n'accompagne que le tag : la certification d'un tag qu'on ne voit
 * pas ne dit rien à personne, et c'est déjà ce que le serveur garantit
 * (`discordVerified` suit `discordPseudo`).
 */
export function DiscordTag({ tag, verified = false, fallback = "—" }: DiscordTagProps) {
  if (!tag) {
    return <span style={{ color: "var(--ink-dim)" }}>{fallback}</span>;
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span className="mono">{tag}</span>
      {verified ? <VerifiedBadge /> : null}
    </span>
  );
}
