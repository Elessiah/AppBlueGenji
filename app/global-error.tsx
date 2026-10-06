"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import "./globals.css";
import { FONT_VARIABLES } from "./site-fonts";
import { CyberButton } from "@/components/cyber";
import { ErrorPanel } from "@/components/error-page/ErrorPanel";
import enShell from "@/messages/en/shell.json";
import { errorPageTitle, errorReference, runtimeErrorCopy } from "@/lib/shared/error-pages";
import { localeHref, splitLocalePrefix } from "@/lib/shared/locales";
import { shellText } from "@/lib/shared/shell-text";

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
 * textes anglais sont inclus dans ce seul fichier.
 */
export default function GlobalError({
  error,
}: Readonly<{
  error: Error & { digest?: string };
  // Next passe aussi `reset`, volontairement ignoré : voir `retry` plus bas.
}>) {
  const { locale } = splitLocalePrefix(usePathname() ?? "/");
  const { t } = locale === "en" ? shellText("en", enShell) : shellText("fr");
  const reference = errorReference(error.digest);
  const copy = runtimeErrorCopy(reference, t);

  useEffect(() => {
    console.error(error);
  }, [error]);

  // La mise en page racine est tombée : `reset()` rejouerait la réponse déjà
  // reçue, qui porte l'erreur. Un rechargement complet redemande tout au
  // serveur.
  const retry = () => window.location.reload();

  return (
    <html lang={locale}>
      <body style={FONT_VARIABLES}>
        <title>{errorPageTitle(copy, t)}</title>
        <main>
          <ErrorPanel copy={copy} reference={reference} referenceLabel={t("errorPages.reference")}>
            <CyberButton type="button" onClick={retry}>
              {t("errorPages.retry")}
            </CyberButton>
            <CyberButton asChild variant="ghost">
              {/* `<a>` nu : rechargement complet voulu. */}
              <a href={localeHref("/", locale)}>{t("errorPages.links.home")}</a>
            </CyberButton>
          </ErrorPanel>
        </main>
      </body>
    </html>
  );
}
