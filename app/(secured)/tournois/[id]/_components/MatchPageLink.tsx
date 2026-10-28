"use client";

import { LocaleLink } from "@/components/i18n/locale-navigation";
import { useSpectatorView } from "@/components/spectator-view";
import { matchPagePath } from "@/lib/shared/match-page";
import type { BracketMatch } from "@/lib/shared/types";
import { useTournamentPageText } from "@/components/i18n/tournament-page-text";
import { useOnMatchPage } from "../_lib/match-page-context";
import styles from "./MatchRow.module.css";

/**
 * « Page du match » : la carte mène à la page du match (`MATCH_PAGE.md`), où
 * se lisent tous ses streams, l'arbitrage et la création de la partie. Tu sur
 * une exemption (un seul engagé, rien à jouer) et sur la page elle-même.
 */
export function MatchPageLink({
  match,
  matchLabel,
}: Readonly<{
  match: Pick<BracketMatch, "id" | "tournamentId" | "team1Id" | "team2Id" | "status">;
  matchLabel: string;
}>) {
  const { t } = useTournamentPageText();
  const spectator = useSpectatorView();
  const onPage = useOnMatchPage();
  const bye = (match.team1Id === null) !== (match.team2Id === null) && match.status !== "PENDING";
  if (onPage || bye) return null;
  return (
    <p className={styles.pageLink}>
      <LocaleLink
        href={matchPagePath(match.tournamentId, match.id, spectator)}
        className="tap-target"
        aria-label={t("match.viewMatchLabel", { match: matchLabel })}
      >
        {t("match.viewMatch")}
      </LocaleLink>
    </p>
  );
}
