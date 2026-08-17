import Link from "next/link";
import type { TournamentFormat } from "@/lib/shared/types";
import { rulesHrefForFormat, ruleModeForFormat } from "@/lib/shared/tournament-rules";

/**
 * Bouton d'aide flottant des pages de tournoi : renvoie vers les règles du mode
 * joué (ou vers l'index `/regles` si le format n'est pas connu, cas de la liste
 * des tournois).
 */
export function RulesHelpFab({
  format,
  contextLabel,
}: {
  format?: TournamentFormat;
  contextLabel?: string;
}) {
  const href = format ? rulesHrefForFormat(format) : "/regles";
  const mode = format ? ruleModeForFormat(format) : null;
  const baseLabel = mode ? `Règles du mode ${mode.label}` : "Règles des tournois";
  const label = contextLabel ? `${baseLabel} — ${contextLabel}` : baseLabel;

  return (
    <Link href={href} className="cta-float-help" aria-label={label} title={label}>
      <span aria-hidden="true">?</span>
    </Link>
  );
}
