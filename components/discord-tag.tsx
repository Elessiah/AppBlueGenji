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
 * Le tag — ou son repli — et la pastille.
 *
 * **La pastille ne suit pas le tag**, et c'est tout l'intérêt de ce composant :
 * ce sont deux faits distincts (`lib/shared/discord-identity.ts`). Le tag dit
 * *comment* joindre le joueur et se fait filtrer ; la certification dit
 * seulement *qu'il est joignable*, ne nomme personne, et s'affiche donc aussi
 * à côté d'un « Masqué ». C'est ce qui permet à un capitaine de voir qui de son
 * roster remplit la condition « tous les Discord vérifiés » d'un tournoi.
 *
 * Un appelant pour qui « pas de tag » **signifie** « pas certifié » — le panneau
 * de contacts, dont le serveur n'envoie que des tags certifiés — passe
 * simplement `verified={tag !== null}` : la règle reste la sienne, ce composant
 * ne fait qu'afficher.
 */
export function DiscordTag({ tag, verified = false, fallback = "—" }: DiscordTagProps) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {tag ? (
        <span className="mono">{tag}</span>
      ) : (
        <span style={{ color: "var(--ink-dim)" }}>{fallback}</span>
      )}
      {verified ? <VerifiedBadge /> : null}
    </span>
  );
}
