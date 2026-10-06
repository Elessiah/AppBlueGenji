import { LocaleLink } from "@/components/i18n/locale-navigation";
import type { TournamentFormat } from "@/lib/shared/types";
import { RULE_MODE_LABELS_FR, rulesHrefForFormat } from "@/lib/shared/rule-mode-definitions";
import { rulesHrefWithTournament } from "@/lib/shared/tournament-settings";

/**
 * Bouton d'aide flottant des pages de tournoi : renvoie vers les règles du mode
 * joué (ou vers l'index `/regles` si le format n'est pas connu, cas de la liste
 * des tournois). Depuis une fiche, le lien porte le tournoi (`?tournoi=<id>`) :
 * la page des règles affiche alors, en tête, les réglages retenus pour lui.
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
  const baseHref = format ? rulesHrefForFormat(format) : "/regles";
  const href = format && tournamentId ? rulesHrefWithTournament(baseHref, tournamentId) : baseHref;
  const modeLabel = format ? RULE_MODE_LABELS_FR[format] : undefined;
  const baseLabel = modeLabel ? `Règles du mode ${modeLabel}` : "Règles des tournois";
  const label = contextLabel ? `${baseLabel} — ${contextLabel}` : baseLabel;

  return (
    <LocaleLink href={href} className="cta-float-help" aria-label={label} title={label}>
      <span aria-hidden="true">?</span>
    </LocaleLink>
  );
}
