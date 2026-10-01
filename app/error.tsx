"use client";

import { startTransition, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CyberButton } from "@/components/cyber";
import { ErrorPanel } from "@/components/error-page/ErrorPanel";
import {
  RETRY_LABEL,
  errorPageTitle,
  errorReference,
  runtimeErrorCopy,
} from "@/lib/shared/error-pages";

/**
 * Limite d'erreur des pages : une erreur d'exécution rend cette carte, en
 * français, à la place du « Application error » de Next. Rendue dans la mise en
 * page racine (menu d'accessibilité, notifications) ; `<main>` pour que le lien
 * d'évitement trouve sa cible.
 *
 * « Réessayer » redemande la page au serveur (`router.refresh()`) **puis**
 * relance le rendu (`reset()`) : `reset()` seul rejouerait la réponse déjà
 * reçue, qui porte encore l'erreur — une panne passagère côté serveur (base
 * injoignable un instant) ne se lèverait jamais.
 */
export default function ErrorBoundary({
  error,
  reset,
}: Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>) {
  const router = useRouter();
  const reference = errorReference(error.digest);
  const copy = runtimeErrorCopy(reference);

  useEffect(() => {
    console.error(error);
  }, [error]);

  const retry = () => {
    startTransition(() => {
      router.refresh();
      reset();
    });
  };

  return (
    <main style={{ position: "relative", zIndex: 1 }}>
      <title>{errorPageTitle(copy)}</title>
      <ErrorPanel copy={copy} reference={reference}>
        <CyberButton type="button" onClick={retry}>
          {RETRY_LABEL}
        </CyberButton>
        <CyberButton asChild variant="ghost">
          <Link href="/">Retour à l&apos;accueil</Link>
        </CyberButton>
      </ErrorPanel>
    </main>
  );
}
