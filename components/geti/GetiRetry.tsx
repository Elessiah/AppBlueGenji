"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { useToast } from "@/components/ui/toast";
import styles from "./geti.module.css";

/**
 * Liste indisponible : la panne s'annonce en notification (jamais en ligne),
 * le bouton relit la page — la panne est souvent brève. Une relecture qui
 * revient encore sans liste (ce composant reste affiché) le redit : sans quoi
 * rien ne montrerait que l'essai a eu lieu.
 */
export function GetiRetry({ label, error }: Readonly<{ label: string; error: string }>) {
  const router = useRouter();
  const { showError } = useToast();
  const [retrying, startRetry] = useTransition();
  const retried = useRef(false);
  useEffect(() => {
    showError(error);
  }, [error, showError]);
  useEffect(() => {
    if (retrying || !retried.current) return;
    retried.current = false;
    showError(error);
  }, [retrying, error, showError]);
  return (
    <button
      type="button"
      className={styles.reset}
      aria-busy={retrying || undefined}
      onClick={() => {
        retried.current = true;
        startRetry(() => router.refresh());
      }}
    >
      {label}
    </button>
  );
}
