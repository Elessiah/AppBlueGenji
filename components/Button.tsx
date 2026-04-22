import { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  children: ReactNode;
}

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  const variantClass = variant === "primary" ? "" : variant;
  const finalClass = `btn ${variantClass} ${className}`.trim();

  return <button className={finalClass} {...props} />;
}
