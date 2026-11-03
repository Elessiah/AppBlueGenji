"use client";

import { useMemo } from "react";
import { Ticker } from "@/components/cyber/Ticker";
import { useLandingText } from "@/components/i18n/landing-text";
import type { TickerItem } from "@/lib/shared/ticker-items";

/**
 * Le bandeau de l'accueil : ses libellés viennent du fournisseur de l'accueil,
 * déjà dans le paquet de la page — le bandeau lui-même ne lit aucun
 * dictionnaire, pour ne pas emporter celui de l'accueil dans chaque liste qui
 * le monte (`/tournois`, `/equipes`, `/joueurs`).
 */
export function LandingTicker({ items }: Readonly<{ items: readonly TickerItem[] }>) {
  const { t } = useLandingText();
  // Libellés mémoïsés : le bandeau (`memo`) ne se redessine qu'avec la langue.
  const labels = useMemo(
    () => ({
      label: t("ticker.label"),
      resume: t("ticker.resume"),
      pause: t("ticker.pause"),
      resumeShort: t("ticker.resumeShort"),
      pauseShort: t("ticker.pauseShort"),
    }),
    [t],
  );
  return <Ticker items={items} labels={labels} />;
}
