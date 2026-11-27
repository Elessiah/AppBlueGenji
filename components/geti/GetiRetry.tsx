"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useToast } from "@/components/ui/toast";
import styles from "./geti.module.css";

/**
 * Liste indisponible : la panne s'annonce en notification (jamais en ligne),
 * le bouton relit la page — la panne est souvent brève.
 */
export function GetiRetry({ label, error }: Readonly<{ label: string; error: string }>) {
  const router = useRouter();
  const { showError } = useToast();
  useEffect(() => {
    showError(error);
  }, [error, showError]);
  return (
    <button type="button" className={styles.reset} onClick={() => router.refresh()}>
      {label}
    </button>
  );
}
