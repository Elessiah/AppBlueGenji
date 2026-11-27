"use client";

import { useRouter } from "next/navigation";
import styles from "./geti.module.css";

/** Relit la page quand la liste est indisponible : la panne est souvent brève. */
export function GetiRetry({ label }: Readonly<{ label: string }>) {
  const router = useRouter();
  return (
    <button type="button" className={styles.reset} onClick={() => router.refresh()}>
      {label}
    </button>
  );
}
