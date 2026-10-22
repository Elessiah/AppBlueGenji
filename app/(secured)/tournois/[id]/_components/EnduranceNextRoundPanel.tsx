"use client";

import { useId, useState } from "react";
import type { EnduranceNextRoundPreview } from "@/lib/shared/endurance-next-round/types";
import {
  nextRoundEmptyLabel,
  nextRoundPendingLabel,
  nextRoundSummary,
  nextRoundTitle,
} from "../_lib/endurance-next-round";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
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
              {preview.matches.map((match, index) => (
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
                  {/* Pourquoi les côtés restent à confirmer : derrière le
                      « i », un `title` échappant au toucher et au clavier. La
                      rangée passe à la ligne : l'explication s'ouvre dessous. */}
                  {!match.sidesKnown && (
                    <>
                      <span className={styles.tag}>{t("nextRound.sidesUnknown")}</span>
                      <InfoHint id={`${panelId}-sides-${index}`} subject={t("nextRound.sidesUnknown")}>
                        <p>{sidesHint}</p>
                      </InfoHint>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          <InfoHintRow>
            <p className={styles.footnote}>{t("nextRound.footnoteShort")}</p>
            <InfoHint id={`${panelId}-footnote`} subject={t("nextRound.footnoteSubject")}>
              <p>{preview.stage === "PLAYOFFS" ? t("nextRound.footnotePlayoffs") : t("nextRound.footnoteRound")}</p>
            </InfoHint>
          </InfoHintRow>
        </div>
      </BoardPanel>
    </div>
  );
}
