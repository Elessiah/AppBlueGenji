/**
 * Motifs des cartes d'aperçu : une icône Lucide (le jeu de l'interface) en
 * grand, au trait néon, à droite de la carte (`docs/features/SHARE_METADATA.md`).
 *
 * Satori ne sait pas rendre un composant Lucide tel quel — c'est un
 * `forwardRef`, qu'il ne déroule pas. On lit donc le **tracé** de l'icône
 * (`iconNode`, la liste de ses `<path>`, `<circle>`…) en appelant une fois sa
 * fonction de rendu, puis on écrit un `<svg>` simple, que Satori sait dessiner.
 * Un test vérifie que chaque motif rend bien un tracé non vide : une montée de
 * version de Lucide qui changerait cette forme se verrait là, pas en production.
 */
import { createElement, type ComponentType, type ReactElement } from "react";
import {
  Accessibility,
  Bot,
  BookOpen,
  ClipboardList,
  FileText,
  Gamepad2,
  Handshake,
  HeartHandshake,
  Lock,
  LogIn,
  Network,
  Scale,
  ScrollText,
  Shield,
  ShieldCheck,
  SquareTerminal,
  Swords,
  Trophy,
  UserPlus,
  UserRound,
  Users,
} from "lucide-react";
import type { ShareAccent, ShareMotif } from "@/lib/shared/page-share-cards";
import { SHARE_CARD_COLORS, SHARE_CARD_MOTIF_ALPHA } from "./share-card";

/** Couleur de chaque teinte de carte — les tons `.pill-*` de la palette. */
export const SHARE_ACCENT_COLORS: Readonly<Record<ShareAccent, string>> = {
  cyan: SHARE_CARD_COLORS.cyan,
  blue: SHARE_CARD_COLORS.blueSoft,
  violet: SHARE_CARD_COLORS.violetSoft,
  pink: SHARE_CARD_COLORS.pink,
  teal: SHARE_CARD_COLORS.teal,
};

const MOTIF_ICONS: Readonly<Record<ShareMotif, ComponentType>> = {
  handshake: Handshake,
  trophy: Trophy,
  book: BookOpen,
  bracket: Network,
  userPlus: UserPlus,
  heart: HeartHandshake,
  logIn: LogIn,
  bot: Bot,
  terminal: SquareTerminal,
  scale: Scale,
  shield: ShieldCheck,
  clipboard: ClipboardList,
  fileText: FileText,
  accessibility: Accessibility,
  lock: Lock,
  scroll: ScrollText,
  swords: Swords,
  users: Users,
  teamShield: Shield,
  gamepad: Gamepad2,
  user: UserRound,
};

export type MotifShape = readonly (readonly [string, Readonly<Record<string, string>>])[];

type ForwardRefIcon = { render: (props: object, ref: null) => ReactElement<{ iconNode?: MotifShape }> };

/** Le tracé d'un motif : les éléments SVG de son icône Lucide. */
export function motifShape(motif: ShareMotif): MotifShape {
  const icon = MOTIF_ICONS[motif] as unknown as ForwardRefIcon;
  return icon.render({}, null).props.iconNode ?? [];
}

/** Le motif, en `<svg>` simple, au trait de la teinte de la carte. */
export function ShareMotifIcon({ motif, color }: Readonly<{ motif: ShareMotif; color: string }>): ReactElement {
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={SHARE_CARD_MOTIF_ALPHA}
    >
      {motifShape(motif).map(([tag, { key, ...attributes }], index) =>
        createElement(tag, { key: key ?? index, ...attributes }),
      )}
    </svg>
  );
}
