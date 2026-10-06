"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import "./globals.css";
import { GlobalErrorView, loadGlobalErrorShell } from "@/components/error-page/GlobalErrorView";
import { splitLocalePrefix } from "@/lib/shared/locales";
import type { ShellMessages } from "@/lib/shared/shell-text";

/**
 * Dernier filet : une erreur levée par la mise en page racine elle-même. Elle
 * remplace alors tout le document, d'où `<html lang>` et `<body>` rendus ici,
 * sans en-tête ni menu (ils vivent dans la mise en page qui vient de tomber).
 * Un lien simple plutôt que `next/link` : le routeur client peut être dans
 * l'état qui a provoqué l'erreur, un rechargement complet repart de zéro.
 *
 * La mise en page tombée emporte aussi la langue et les textes de la coquille :
 * la langue se relit ici dans l'adresse (`/en/…` n'est servie que pour une
 * route traduite, le middleware renvoie les autres vers le français), et les
 * textes d'une autre langue se chargent à la demande (`loadGlobalErrorShell`).
 */
export default function GlobalError({
  error,
}: Readonly<{
  error: Error & { digest?: string };
  // Next passe aussi `reset`, volontairement ignoré : voir `retry` plus bas.
}>) {
  const { locale } = splitLocalePrefix(usePathname() ?? "/");
  const [messages, setMessages] = useState<ShellMessages | undefined>(undefined);

  useEffect(() => {
    console.error(error);
  }, [error]);

  useEffect(() => {
    let live = true;
    loadGlobalErrorShell(locale)
      .then((loaded) => {
        if (live) setMessages(loaded);
      })
      // Morceau injoignable (hors ligne) : la page reste en français.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [locale]);

  // La mise en page racine est tombée : `reset()` rejouerait la réponse déjà
  // reçue, qui porte l'erreur. Un rechargement complet redemande tout au
  // serveur.
  const retry = () => window.location.reload();

  return <GlobalErrorView error={error} locale={locale} messages={messages} onRetry={retry} />;
}
