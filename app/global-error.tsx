"use client";

import { useEffect } from "react";
import "./globals.css";
import { FONT_VARIABLES } from "./site-fonts";
import { CyberButton } from "@/components/cyber";
import { ErrorPanel } from "@/components/error-page/ErrorPanel";
import {
  RETRY_LABEL,
  errorPageTitle,
  errorReference,
  runtimeErrorCopy,
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
}: Readonly<{
  error: Error & { digest?: string };
  // Next passe aussi `reset`, volontairement ignoré : voir `retry` plus bas.
}>) {
  const reference = errorReference(error.digest);
  const copy = runtimeErrorCopy(reference);

  useEffect(() => {
    console.error(error);
  }, [error]);

  // La mise en page racine est tombée : `reset()` rejouerait la réponse déjà
  // reçue, qui porte l'erreur. Un rechargement complet redemande tout au
  // serveur.
  const retry = () => window.location.reload();

  return (
    <html lang="fr">
      <body style={FONT_VARIABLES}>
        <title>{errorPageTitle(copy)}</title>
        <main>
          <ErrorPanel copy={copy} reference={reference}>
            <CyberButton type="button" onClick={retry}>
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
