import { ReactNode, CSSProperties, ComponentPropsWithoutRef } from "react";

/**
 * Badge inline du système « Cyber minimal ».
 *
 * Les attributs de `<span>` non listés ici sont transmis tels quels : une
 * pastille sert parfois d'indicateur d'état (`role="status"`, `aria-live`) ou
 * porte une explication au survol (`title`), et il n'y a aucune raison de
 * dupliquer le composant pour cela.
 */
interface PillProps extends Omit<ComponentPropsWithoutRef<"span">, "children" | "className" | "style"> {
  variant?: "default" | "live" | "blue";
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function Pill({ variant = "default", children, className = "", style, ...rest }: PillProps) {
  const classes = [
    "pill",
    variant === "live" && "pill-live",
    variant === "blue" && "pill-blue",
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
