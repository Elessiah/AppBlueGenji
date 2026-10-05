import { ReactNode, CSSProperties, ComponentPropsWithoutRef } from "react";

/**
 * Badge inline du système « Cyber minimal ».
 *
 * Les attributs de `<span>` non listés ici sont transmis tels quels : une
 * pastille sert parfois d'indicateur d'état (`role="status"`, `aria-live`) ou
 * porte une explication au survol (`title`), et il n'y a aucune raison de
 * dupliquer le composant pour cela.
 */
export type PillVariant =
  | "default"
  | "live"
  | "blue"
  | "info"
  | "accent"
  | "success"
  | "highlight"
  | "neutral"
  | "warning"
  | "waiting";

/** Classe CSS globale d'une variante (`app/globals.css`), `null` pour la pastille de base. */
export function pillVariantClass(variant: PillVariant): string | null {
  return variant === "default" ? null : `pill-${variant}`;
}

interface PillProps extends Omit<ComponentPropsWithoutRef<"span">, "children" | "className" | "style"> {
  /** Sens de la pastille (DESIGN_SYSTEM.md § Pastilles) : jamais tout gris. */
  variant?: PillVariant;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function Pill({ variant = "default", children, className = "", style, ...rest }: Readonly<PillProps>) {
  const classes = [
    "pill",
    pillVariantClass(variant),
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} style={style} {...rest}>
      {variant === "live" && <span className="dot" />}
      {children}
    </span>
  );
}
