"use client";

import { visibleReplayUrl } from "@/lib/shared/match-replay";
import type { BracketMatch } from "@/lib/shared/types";
import styles from "./MatchReplayStrip.module.css";
import { useTournamentPageText } from "@/components/i18n/tournament-page-text";
import { versusText } from "@/lib/shared/tournament-page-text";
import { useShownEntrantName } from "./EntrantName";

/**
 * Bandeau « Rediff disponible » d'un match terminé, sous sa carte : tout le
 * monde le voit dès qu'une rediff est posée sur une rencontre jouée — la carte
 * entière du bandeau est le lien, pour qu'on ne puisse pas le manquer.
 *
 * Le bouton qui pose, modifie ou retire le lien vit dans le menu d'actions de la
 * carte (`MatchCardActions`, permissions `tournaments` et `live`) et, pour le
 * caster du match, dans sa fenêtre de diffusion — portes déduites de
 * `mayEditReplay` / `canEditReplay` (`lib/shared/match-replay.ts`). Le lien
 * stocké n'est pas montré tel quel : `visibleReplayUrl` le tait sur un match
 * rouvert par un retour en arrière — le staff garde alors son bouton, pour
 * pouvoir retirer un lien qui ne correspondrait plus.
 */
export function MatchReplayStrip({ match }: Readonly<{ match: BracketMatch }>) {
  const text = useTournamentPageText();
  // Noms nettoyés (`UNTRUSTED_NAMES.md`) : appelés avant tout retour anticipé.
  const team1 = useShownEntrantName(match.team1Id, match.team1Name) ?? text.t("match.tbd");
  const team2 = useShownEntrantName(match.team2Id, match.team2Name) ?? text.t("match.tbd");
  const replayUrl = visibleReplayUrl(match);
  if (replayUrl === null) return null;

  // Sorti de son contexte visuel, « Rediff disponible » ne dit pas de quel match
  // il s'agit : le lien porte le nom de la rencontre.
  const matchLabel = versusText(text, team1, team2);

  return (
    <div className={styles.banner}>
      <a
        href={replayUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.link}
        // Commence par le texte visible (WCAG 2.5.3) : la commande vocale
        // « cliquer sur Rediff disponible » doit trouver ce lien.
        aria-label={text.t("match.replayLabel", { match: matchLabel })}
      >
        <span aria-hidden="true" className={styles.icon}>
          ▶
        </span>
        {/* NOSONAR S6772 — lien en flex avec `gap` */}
        {text.t("match.replay")}
      </a>
    </div>
  );
}
