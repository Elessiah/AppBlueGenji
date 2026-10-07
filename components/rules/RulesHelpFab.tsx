"use client";

import { LocaleLink } from "@/components/i18n/locale-navigation";
import { useTournamentsText } from "@/components/i18n/tournaments-text";
import type { TournamentFormat } from "@/lib/shared/types";
import { rulesHrefForFormat } from "@/lib/shared/rule-mode-definitions";
import { rulesHrefWithTournament } from "@/lib/shared/tournament-settings";

/**
 * Bouton d'aide flottant des pages de tournoi : renvoie vers les règles du mode
 * joué (ou vers l'index `/regles` si le format n'est pas connu, cas de la liste
 * des tournois). Depuis une fiche, le lien porte le tournoi (`?tournoi=<id>`) :
 * la page des règles affiche alors, en tête, les réglages retenus pour lui.
 *
 * Libellé dans la langue de la page (lot 8a, `tournaments.rulesHelp`) ; le
 * français reprend `RULE_MODE_LABELS_FR` (égalité testée). `contextLabel` est
 * une donnée (nom du tournoi), rendue telle quelle.
 */
export function RulesHelpFab({
  format,
  contextLabel,
  tournamentId,
}: Readonly<{
  format?: TournamentFormat;
  contextLabel?: string;
  tournamentId?: number;
}>) {
  const { t } = useTournamentsText();
  const baseHref = format ? rulesHrefForFormat(format) : "/regles";
  const href = format && tournamentId ? rulesHrefWithTournament(baseHref, tournamentId) : baseHref;
  const baseLabel = format ? t("rulesHelp.mode", { mode: t(`rulesHelp.modes.${format}`) }) : t("rulesHelp.index");
  const label = contextLabel ? t("rulesHelp.withContext", { label: baseLabel, context: contextLabel }) : baseLabel;

  return (
    <LocaleLink href={href} className="cta-float-help" aria-label={label} title={label}>
      <span aria-hidden="true">?</span>
    </LocaleLink>
  );
}
