"use client";

import { useEffect } from "react";
import "./globals.css";
import { FONT_VARIABLES } from "./site-fonts";
import { CyberButton } from "@/components/cyber";
import { ErrorPanel } from "@/components/error-page/ErrorPanel";
import {
  RETRY_LABEL,
  RUNTIME_ERROR_COPY,
  errorPageTitle,
  errorReference,
} from "@/lib/shared/error-pages";

/**
 * Dernier filet : une erreur levée par la mise en page racine elle-même. Elle
 * remplace alors tout le document, d'où `<html lang="fr">` et `<body>` rendus
 * ici, sans en-tête ni menu (ils vivent dans la mise en page qui vient de
 * tomber). Un lien simple plutôt que `next/link` : le routeur client peut être
 * dans l'état qui a provoqué l'erreur, un rechargement complet repart de zéro.
 */
export default function GlobalError({
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
    <html lang="fr">
      <body style={FONT_VARIABLES}>
        <title>{errorPageTitle(RUNTIME_ERROR_COPY)}</title>
        <main>
          <ErrorPanel copy={RUNTIME_ERROR_COPY} reference={errorReference(error.digest)}>
            <CyberButton type="button" onClick={reset}>
              {RETRY_LABEL}
            </CyberButton>
            <CyberButton asChild variant="ghost">
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- rechargement complet voulu */}
              <a href="/">Retour à l&apos;accueil</a>
            </CyberButton>
          </ErrorPanel>
        </main>
      </body>
    </html>
  );
}
