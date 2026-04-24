"use client";

import { forwardRef, ButtonHTMLAttributes, ReactNode } from "react";
import { Slot } from "@radix-ui/react-slot";
import styles from "./CyberButton.module.css";

interface CyberButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost";
  asChild?: boolean;
  children: ReactNode;
}

export const CyberButton = forwardRef<HTMLButtonElement, CyberButtonProps>(
  ({ variant = "primary", asChild = false, className = "", children, ...props }, ref) => {
    const Component = asChild ? Slot : "button";

    const classes = [
      styles.root,
      variant === "primary" && styles.primary,
      variant === "ghost" && styles.ghost,
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <Component ref={ref} className={classes} {...props}>
        {children}
      </Component>
    );
  }
);

CyberButton.displayName = "CyberButton";
