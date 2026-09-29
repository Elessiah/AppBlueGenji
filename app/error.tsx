"use client";

import { useEffect } from "react";
import Link from "next/link";
import { CyberButton } from "@/components/cyber";
import { ErrorPanel } from "@/components/error-page/ErrorPanel";
import {
  RETRY_LABEL,
  RUNTIME_ERROR_COPY,
  errorPageTitle,
  errorReference,
} from "@/lib/shared/error-pages";

/**
 * Limite d'erreur des pages : une erreur d'exécution rend cette carte, en
 * français, à la place du « Application error » de Next. Rendue dans la mise en
 * page racine (menu d'accessibilité, notifications) ; `<main>` pour que le lien
 * d'évitement trouve sa cible.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main style={{ position: "relative", zIndex: 1 }}>
      <title>{errorPageTitle(RUNTIME_ERROR_COPY)}</title>
      <ErrorPanel copy={RUNTIME_ERROR_COPY} reference={errorReference(error.digest)}>
        <CyberButton type="button" onClick={reset}>
          {RETRY_LABEL}
        </CyberButton>
        <CyberButton asChild variant="ghost">
          <Link href="/">Retour à l&apos;accueil</Link>
        </CyberButton>
      </ErrorPanel>
    </main>
  );
}
