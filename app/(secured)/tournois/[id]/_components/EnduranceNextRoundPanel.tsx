"use client";

import { useId, useState } from "react";
import type { EnduranceNextRoundPreview } from "@/lib/shared/endurance-next-round/types";
import {
  nextRoundEmptyLabel,
  nextRoundPendingLabel,
  nextRoundSummary,
  nextRoundTitle,
} from "../_lib/endurance-next-round";
import { BoardPanel, PanelPill } from "./BoardPanel";
import { EntrantName } from "./EntrantName";
import { useActionsText } from "../_lib/actions-text";
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
export function EnduranceNextRoundPanel({ preview, maxRounds, teamNames }: Readonly<EnduranceNextRoundPanelProps>) {
  const text = useActionsText();
  const { t } = text;
  const [open, setOpen] = useState(true);
  const panelId = useId();
  const title = nextRoundTitle(preview, maxRounds, text);
  // Pourquoi une affiche sûre peut avoir des côtés incertains. Écrite sans
  // « équipe » : un tournoi individuel oppose des joueurs.
  const sidesHint = t("nextRound.sidesHint");
  const name = (teamId: number) => teamNames.get(teamId) ?? `#${teamId}`;

  return (
    // Outil d'arbitrage posé sur la fiche (lot 8b).
    <div className={styles.wrapper}>
      <BoardPanel
        accent={PREVIEW_ACCENT}
        title={t("nextRound.panelTitle", { title })}
        open={open}
        onToggle={() => setOpen((value) => !value)}
        panelId={panelId}
        ariaLabel={t("nextRound.panelAria", { title })}
        meta={
          <>
            <PanelPill>{nextRoundSummary(preview, text)}</PanelPill>
            <PanelPill>{nextRoundPendingLabel(preview, text)}</PanelPill>
          </>
        }
      >
        <div className={styles.body}>
          {!preview.stageCertain && !preview.freeScore && (
            <p className={styles.warning}>{t("nextRound.stageUncertain")}</p>
          )}

          {preview.matches.length === 0 ? (
            <p className={styles.empty}>{nextRoundEmptyLabel(preview, text)}</p>
          ) : (
            <ul className={styles.list} aria-label={t("nextRound.listAria", { title })}>
              {preview.matches.map((match) => (
                <li
                  key={`${match.bracket}-${match.teamAId}-${match.teamBId ?? "bye"}`}
                  className={styles.item}
                >
                  {match.bracket === "THIRD_PLACE" && (
                    <span className={styles.tag}>{t("nextRound.thirdPlace")}</span>
                  )}
                  <EntrantName
                    teamId={match.teamAId}
                    name={name(match.teamAId)}
                    truncate
                    className={styles.team}
                  />
                  {match.teamBId === null ? (
                    <span className={styles.bye}>
                      {preview.stage === "PLAYOFFS" ? t("nextRound.byePlayoffs") : t("nextRound.byeRound")}
                    </span>
                  ) : (
                    <>
                      {/* « vs » se lit « versus » ou pas du tout selon le
                          lecteur d'écran : la phrase est écrite pour de bon,
                          et masquée à l'œil. */}
                      <span className={styles.versus} aria-hidden="true">
                        vs
                      </span>
                      <span className="sr-only"> {t("nextRound.versus")} </span>
                      <EntrantName
                        teamId={match.teamBId}
                        name={name(match.teamBId)}
                        truncate
                        className={styles.team}
                      />
                    </>
                  )}
                  {!match.sidesKnown && (
                    <span className={styles.tag} title={sidesHint}>
                      {t("nextRound.sidesUnknown")}
                      {/* NOSONAR S6772 — texte réservé aux lecteurs d'écran, qui commence par « . » */}
                      <span className="sr-only">{`. ${sidesHint}`}</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          <p className={styles.footnote}>
            {preview.stage === "PLAYOFFS" ? t("nextRound.footnotePlayoffs") : t("nextRound.footnoteRound")}
          </p>
        </div>
      </BoardPanel>
    </div>
  );
}
