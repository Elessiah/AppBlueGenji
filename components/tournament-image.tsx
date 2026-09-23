import Image from "next/image";
import type { CSSProperties } from "react";
import {
  imageObjectPosition,
  tournamentImageSlot,
  type TournamentImage,
} from "@/lib/shared/tournament-image";
import s from "./tournament-image.module.css";

/**
 * Rendu de l'illustration ou du logo d'un tournoi (`lib/shared/tournament-image.ts`).
 *
 * Deux composants et non un seul à variantes : un bandeau et une pastille ne
 * s'insèrent pas au même endroit d'une carte, et chaque écran appelle les deux
 * — c'est `tournamentImageSlot` qui décide lequel rend quelque chose. Un
 * tournoi sans image ne rend **rien** : aucune case vide, aucun repli, la carte
 * garde exactement sa forme d'avant.
 *
 * L'image est **décorative** (`alt=""`) : elle est toujours posée à côté du nom
 * du tournoi, qu'une alternative textuelle ne ferait que répéter.
 */

type BannerProps = {
  image: TournamentImage | null;
  /** Largeur rendue, pour le `srcset` de `next/image` (ex. `"(max-width: 640px) 100vw, 480px"`). */
  sizes: string;
  /** Classe de placement (hauteur, marges pleine largeur) fournie par l'écran. */
  className?: string;
  /** Voile dégradé vers le fond de la carte, en bas du bandeau. */
  fade?: boolean;
  priority?: boolean;
};

/** Bandeau d'une **illustration** ; rien pour un logo ou sans image. */
export function TournamentImageBanner({ image, sizes, className, fade = true, priority }: BannerProps) {
  if (!image || tournamentImageSlot(image) !== "BANNER") return null;
  return (
    <div className={[s.banner, fade ? s.bannerFade : "", className ?? ""].filter(Boolean).join(" ")}>
      <Image
        src={image.url}
        alt=""
        fill
        sizes={sizes}
        priority={priority}
        className={s.cover}
        style={{ objectPosition: imageObjectPosition(image) }}
      />
    </div>
  );
}

type EmblemProps = {
  image: TournamentImage | null;
  /**
   * Côté de la pastille, en pixels. Posé en variable CSS : un écran peut le
   * réduire à une largeur donnée par une règle plus spécifique.
   */
  size: number;
  className?: string;
  priority?: boolean;
};

/** Pastille d'un **logo** ; rien pour une illustration ou sans image. */
export function TournamentImageEmblem({ image, size, className, priority }: EmblemProps) {
  if (!image || tournamentImageSlot(image) !== "EMBLEM") return null;
  return (
    <div
      className={[s.emblem, className ?? ""].filter(Boolean).join(" ")}
      style={{ "--tournament-emblem-size": `${size}px` } as CSSProperties}
    >
      <div className={s.emblemFrame}>
        <Image src={image.url} alt="" fill sizes={`${size * 2}px`} priority={priority} className={s.contain} />
      </div>
    </div>
  );
}
