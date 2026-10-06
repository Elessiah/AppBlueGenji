"use client";

import { startTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CyberButton } from "@/components/cyber";
import { ErrorPanel } from "@/components/error-page/ErrorPanel";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { useShellText } from "@/components/i18n/shell-text";
import { errorPageTitle, errorReference, runtimeErrorCopy } from "@/lib/shared/error-pages";

/**
 * Limite d'erreur des pages : une erreur d'exécution rend cette carte, dans la
 * langue de la page, à la place du « Application error » de Next. Rendue dans
 * la mise en page racine (menu d'accessibilité, notifications, textes de la
 * coquille) ; `<main>` pour que le lien d'évitement trouve sa cible.
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
  const { t } = useShellText();
  const reference = errorReference(error.digest);
  const copy = runtimeErrorCopy(reference, t);

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
      <title>{errorPageTitle(copy, t)}</title>
      <ErrorPanel copy={copy} reference={reference} referenceLabel={t("errorPages.reference")}>
        <CyberButton type="button" onClick={retry}>
          {t("errorPages.retry")}
        </CyberButton>
        <CyberButton asChild variant="ghost">
          <LocaleLink href="/">{t("errorPages.links.home")}</LocaleLink>
        </CyberButton>
      </ErrorPanel>
    </main>
  );
}
