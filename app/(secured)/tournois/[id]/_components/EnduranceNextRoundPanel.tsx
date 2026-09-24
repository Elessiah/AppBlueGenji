"use client";

import { useId, useState } from "react";
import type { EnduranceNextRoundPreview } from "@/lib/shared/endurance-next-round";
import {
  nextRoundEmptyLabel,
  nextRoundPendingLabel,
  nextRoundSummary,
  nextRoundTitle,
} from "../_lib/endurance-next-round";
import { BoardPanel, PanelPill } from "./BoardPanel";
import { EntrantName } from "./EntrantName";
import styles from "./EnduranceNextRoundPanel.module.css";

interface EnduranceNextRoundPanelProps {
  preview: EnduranceNextRoundPreview;
  maxRounds: number | null;
  /** Nom de chaque engagé, lu sur le classement d'endurance. */
  teamNames: Map<number, string>;
}

/** Accent de l'aperçu : distinct du bleu des manches réelles, qu'il ne doit pas imiter. */
const PREVIEW_ACCENT = "var(--blue-300, #8fd5ff)";

/**
 * Aperçu de la manche suivante, réservé à l'arbitrage
 * (`docs/features/ENDURANCE_NEXT_ROUND_PREVIEW.md`).
 *
 * Il ne montre que des rencontres **acquises** : celles que le moteur posera
 * quel que soit le score des matchs encore ouverts. Une rencontre probable n'y
 * figure jamais — l'arbitrage s'en sert pour ouvrir des salons et annoncer des
 * horaires, et un couple annoncé à tort se paierait devant deux équipes.
 */
export function EnduranceNextRoundPanel({ preview, maxRounds, teamNames }: EnduranceNextRoundPanelProps) {
  const [open, setOpen] = useState(true);
  const panelId = useId();
  const title = nextRoundTitle(preview, maxRounds);
  const name = (teamId: number) => teamNames.get(teamId) ?? `#${teamId}`;

  return (
    <div className={styles.wrapper}>
      <BoardPanel
        accent={PREVIEW_ACCENT}
        title={`Aperçu · ${title}`}
        open={open}
        onToggle={() => setOpen((value) => !value)}
        panelId={panelId}
        ariaLabel={`Aperçu de l'étape suivante : ${title}`}
        meta={
          <>
            <PanelPill>{nextRoundSummary(preview)}</PanelPill>
            <PanelPill>{nextRoundPendingLabel(preview)}</PanelPill>
          </>
        }
      >
        <div className={styles.body}>
          {!preview.stageCertain && !preview.freeScore && (
            <p className={styles.warning}>
              La phase qualificative peut encore s&apos;achever sur la manche en cours : ces
              rencontres ne se joueront que si elle continue.
            </p>
          )}

          {preview.matches.length === 0 ? (
            <p className={styles.empty}>{nextRoundEmptyLabel(preview)}</p>
          ) : (
            <ul className={styles.list} aria-label={`Rencontres acquises — ${title}`}>
              {preview.matches.map((match) => (
                <li
                  key={`${match.bracket}-${match.teamAId}-${match.teamBId ?? "bye"}`}
                  className={styles.item}
                >
                  {match.bracket === "THIRD_PLACE" && (
                    <span className={styles.tag}>Petite finale</span>
                  )}
                  <EntrantName
                    teamId={match.teamAId}
                    name={name(match.teamAId)}
                    truncate
                    className={styles.team}
                  />
                  {match.teamBId === null ? (
                    <span className={styles.bye}>
                      {preview.stage === "PLAYOFFS"
                        ? "passe le tour (exemption)"
                        : "ne joue pas cette manche (effectif impair)"}
                    </span>
                  ) : (
                    <>
                      <span className={styles.versus} aria-label="contre">
                        vs
                      </span>
                      <EntrantName
                        teamId={match.teamBId}
                        name={name(match.teamBId)}
                        truncate
                        className={styles.team}
                      />
                    </>
                  )}
                  {!match.sidesKnown && (
                    <span
                      className={styles.tag}
                      title="Les deux équipes s'affrontent quoi qu'il arrive ; les matchs restants décideront laquelle, mieux classée, part à gauche et accueille la partie."
                    >
                      Côtés à confirmer
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          <p className={styles.footnote}>
            Rencontres sûres quel que soit le score des matchs restants — hors décision
            d&apos;arbitrage (abandon, pénalité, double forfait). Le moteur ne pose la{" "}
            {preview.stage === "PLAYOFFS" ? "suite" : "manche"} qu&apos;une fois la précédente
            terminée.
          </p>
        </div>
      </BoardPanel>
    </div>
  );
}
