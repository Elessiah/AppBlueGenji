import Link, { LinkProps } from "next/link";
import { ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost";

interface ButtonLinkProps extends LinkProps {
  variant?: ButtonVariant;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function ButtonLink({ variant = "primary", className = "", ...props }: ButtonLinkProps) {
  const variantClass = variant === "primary" ? "" : variant;
  const finalClass = `btn ${variantClass} ${className}`.trim();

  return <Link className={finalClass} {...props} />;
}
