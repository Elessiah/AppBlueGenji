"use client";

import dynamic from "next/dynamic";
import { useId, useState } from "react";
import type { BracketMatch, EnduranceMeta } from "@/lib/shared/types";
import { useTournamentViewText } from "@/components/i18n/tournament-page-text";
import { orReload } from "@/lib/shared/lazy-component";
import { ACCENT } from "../_lib/bracket-sections";
import { useEnduranceChartAnimate } from "../_lib/use-endurance-chart-animate";
import { FR_VIEWS_TEXT } from "../_lib/views-text";
import { BoardPanel, PanelPill } from "./BoardPanel";

// Le graphique est chargé au premier dépliage : replié (l'état de chaque
// chargement de page), le volet ne coûte que son en-tête — ni le module du
// graphique, ni son calcul, ni son SVG. `orReload` : un fichier disparu depuis
// un déploiement recharge la page au lieu de la faire tomber.
const EnduranceChart = dynamic(() => orReload(import("./EnduranceChart").then((m) => m.EnduranceChart)), {
  ssr: false,
});

/**
 * Volet « Évolution de l'endurance » (`docs/features/ENDURANCE_RANKING_VIEWS.md`,
 * § Graphique) : **replié** à chaque chargement, en lecture seule pour tous —
 * connectés ou non, la même courbe des résultats publics.
 */
export function EnduranceChartPanel({
  endurance,
  matches,
}: Readonly<{ endurance: EnduranceMeta; matches: BracketMatch[] }>) {
  const { t } = useTournamentViewText(FR_VIEWS_TEXT);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  // « graphique animé » ne se dit que si la courbe s'anime vraiment.
  const animate = useEnduranceChartAnimate();

  // Avant la première manche, il n'y a pas de courbe à tracer.
  if (endurance.currentRound < 1 || endurance.standings.length === 0) return null;

  return (
    <div style={{ marginBottom: 24 }}>
      <BoardPanel
        accent={ACCENT.UPPER}
        title={t("endurance.chartTitle")}
        open={open}
        onToggle={() => setOpen((value) => !value)}
        panelId={panelId}
        meta={<PanelPill>{t(animate ? "endurance.chartMeta" : "endurance.chartMetaStatic")}</PanelPill>}
      >
        <EnduranceChart endurance={endurance} matches={matches} />
      </BoardPanel>
    </div>
  );
}
