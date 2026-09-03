"use client";

import { computeRecommendedRounds } from "@/lib/shared/swiss";
import { participantWording } from "@/lib/shared/participants";
import type { TournamentField } from "@/lib/shared/tournament-edit";
import { PhaseBuilder } from "../creer/PhaseBuilder";
import { FULL_WIDTH, HINT } from "../_lib/form-styles";
import type { TournamentFormValues } from "../_lib/tournament-form-values";

/**
 * Réglages propres au format choisi : phases (MULTI), endurance (BG Survie),
 * cadence des coupes (Survie), rondes et barème (Suisse), petite finale
 * (élimination simple).
 *
 * Sortis de `TournamentForm`, qui approchait les 900 lignes : ces cinq blocs
 * s'excluent mutuellement et ne partagent rien d'autre que les valeurs du
 * formulaire. Le composant ne tient aucun état — il lit `values` et rend la
 * main par `set`, comme le reste du formulaire.
 */
export type FormatSettingsProps = {
  values: TournamentFormValues;
  set: <K extends keyof TournamentFormValues>(key: K, value: TournamentFormValues[K]) => void;
  /** Le champ est-il figé par la fenêtre d'édition ? */
  locked: (field: TournamentField) => boolean;
  /** Attributs d'accessibilité à poser sur un champ figé (renvoie vers l'explication). */
  lockedAttr: (field: TournamentField) => { "aria-describedby"?: string };
  /**
   * Le nombre de rondes suisses n'est pas un `set` ordinaire : le saisir à la
   * main coupe le suivi automatique de la recommandation, que seul le
   * formulaire connaît.
   */
  onSwissTotalRoundsChange: (value: number) => void;
};

export function FormatSettings({
  values,
  set,
  locked,
  lockedAttr,
  onSwissTotalRoundsChange,
}: FormatSettingsProps) {
  const { format, maxTeams, phases } = values;
  const wording = participantWording(values.participantType);
  const recommendedRounds = computeRecommendedRounds(maxTeams);

  return (
    <>
      {format === "MULTI" && (
        <div style={FULL_WIDTH}>
          <PhaseBuilder
            phases={phases}
            maxTeams={maxTeams}
            disabled={locked("phases")}
            onChange={(next) => set("phases", next)}
          />
        </div>
      )}

      {format === "BG_SURVIE" && (
        <>
          <div className="field">
            <label htmlFor="endurance-points">Capital d&apos;endurance</label>
            <input
              id="endurance-points"
              type="number"
              min={1}
              max={99}
              disabled={locked("endurancePoints")}
              value={values.endurancePoints}
              onChange={(e) => set("endurancePoints", Number(e.target.value))}
              {...lockedAttr("endurancePoints")}
            />
            <p style={HINT}>
              Points de départ de chaque équipe. À 0, elle est éliminée.
            </p>
          </div>

          <div className="field">
            <label htmlFor="endurance-win">Points par victoire de map</label>
            <input
              id="endurance-win"
              type="number"
              min={1}
              max={20}
              disabled={locked("enduranceWinDelta")}
              value={values.enduranceWinDelta}
              onChange={(e) => set("enduranceWinDelta", Number(e.target.value))}
              {...lockedAttr("enduranceWinDelta")}
            />
          </div>

          <div className="field">
            <label htmlFor="endurance-loss">Points par défaite de map</label>
            <input
              id="endurance-loss"
              type="number"
              min={1}
              max={20}
              disabled={locked("enduranceLossDelta")}
              value={values.enduranceLossDelta}
              onChange={(e) => set("enduranceLossDelta", Number(e.target.value))}
              {...lockedAttr("enduranceLossDelta")}
            />
          </div>

          <div className="field">
            <label htmlFor="endurance-playoff">Équipes en play-offs</label>
            <input
              id="endurance-playoff"
              type="number"
              min={2}
              max={32}
              disabled={locked("endurancePlayoffSize")}
              value={values.endurancePlayoffSize}
              onChange={(e) => set("endurancePlayoffSize", Number(e.target.value))}
              {...lockedAttr("endurancePlayoffSize")}
            />
            <p style={HINT}>
              La phase d&apos;endurance s&apos;arrête à cet effectif. À 8, l&apos;arbre
              suit le tableau du règlement (8v4, 6v2, 1v5, 3v7) avec petite finale.
            </p>
          </div>

          <div className="field">
            <label htmlFor="endurance-max-rounds">Manches maximum</label>
            <input
              id="endurance-max-rounds"
              type="number"
              min={0}
              max={50}
              disabled={locked("enduranceMaxRounds")}
              value={values.enduranceMaxRounds}
              onChange={(e) => set("enduranceMaxRounds", Number(e.target.value))}
              {...lockedAttr("enduranceMaxRounds")}
            />
            <p style={HINT}>
              0 = aucune limite : la phase court jusqu&apos;à l&apos;effectif ci-dessus.
              Sinon elle s&apos;arrête à cette manche et les meilleures du classement
              sont qualifiées ; celles qui ne peuvent plus les rejoindre sortent
              avant la fin.
            </p>
          </div>
        </>
      )}

      {format === "SURVIVAL" && (
        <>
          <div className="field">
            <label htmlFor="survival-first-cut">Rounds avant la première coupe</label>
            <input
              id="survival-first-cut"
              type="number"
              min={1}
              max={50}
              disabled={locked("survivalRoundsBeforeFirstCut")}
              value={values.survivalRoundsBeforeFirstCut}
              onChange={(e) =>
                set("survivalRoundsBeforeFirstCut", Number(e.target.value))
              }
              {...lockedAttr("survivalRoundsBeforeFirstCut")}
            />
            <p style={HINT}>
              Laisse le classement se former avant la première élimination.
            </p>
          </div>

          <div className="field">
            <label htmlFor="survival-rounds">Rounds entre les coupes suivantes</label>
            <input
              id="survival-rounds"
              type="number"
              min={1}
              max={50}
              disabled={locked("survivalRoundsPerCut")}
              value={values.survivalRoundsPerCut}
              onChange={(e) => set("survivalRoundsPerCut", Number(e.target.value))}
              {...lockedAttr("survivalRoundsPerCut")}
            />
            <p style={HINT}>
              Cadence appliquée après la première coupe.
            </p>
          </div>

          <p style={{ ...HINT, ...FULL_WIDTH }}>
            Toutes les équipes s&apos;affrontent par paires selon leur classement. À
            chaque coupe, les deux dernières équipes sont éliminées, jusqu&apos;à la
            championne. Si le nombre d&apos;inscrites est impair, un barrage entre les
            deux dernières ouvre le tournoi — aucune victoire d&apos;office n&apos;est
            distribuée.
          </p>
        </>
      )}

      {format === "SWISS" && (
        <>
          <div className="field">
            <label htmlFor="swiss-rounds">Nombre de rondes</label>
            <input
              id="swiss-rounds"
              type="number"
              min={1}
              max={20}
              disabled={locked("swissTotalRounds")}
              value={values.swissTotalRounds}
              onChange={(e) => onSwissTotalRoundsChange(Number(e.target.value))}
              {...lockedAttr("swissTotalRounds")}
            />
            <p style={HINT}>
              Recommandé pour {maxTeams} {wording.many} : {recommendedRounds} ronde
              {recommendedRounds > 1 ? "s" : ""}.
            </p>
          </div>

          <div className="field">
            <label htmlFor="swiss-points-win">Barème (victoire / nul / défaite)</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                id="swiss-points-win"
                type="number"
                min={0}
                max={99}
                aria-label="Points par victoire"
                disabled={locked("swissPointsWin")}
                value={values.swissPointsWin}
                onChange={(e) => set("swissPointsWin", Number(e.target.value))}
                {...lockedAttr("swissPointsWin")}
              />
              <input
                type="number"
                min={0}
                max={99}
                aria-label="Points par match nul"
                disabled={locked("swissPointsDraw")}
                value={values.swissPointsDraw}
                onChange={(e) => set("swissPointsDraw", Number(e.target.value))}
                {...lockedAttr("swissPointsDraw")}
              />
              <input
                type="number"
                min={0}
                max={99}
                aria-label="Points par défaite"
                disabled={locked("swissPointsLoss")}
                value={values.swissPointsLoss}
                onChange={(e) => set("swissPointsLoss", Number(e.target.value))}
                {...lockedAttr("swissPointsLoss")}
              />
            </div>
            <p style={HINT}>
              Une victoire d&apos;office rapporte autant qu&apos;une victoire.
            </p>
          </div>

          <p style={{ ...HINT, ...FULL_WIDTH }}>
            Aucune élimination : toutes les équipes jouent les {values.swissTotalRounds}{" "}
            rondes.
            À chaque ronde, on affronte une équipe ayant un total de points proche du
            sien, sans jamais rejouer le même adversaire tant que c&apos;est possible. À
            égalité de points, le départage se fait au Buchholz (somme des points des
            adversaires rencontrés).
          </p>
        </>
      )}

      {format === "SINGLE" && (
        <div className="field" style={FULL_WIDTH}>
          <label htmlFor="third-place" style={{ marginBottom: 6 }}>
            Options supplémentaires
          </label>
          <div
            className="checkbox-card"
            onClick={
              locked("hasThirdPlaceMatch")
                ? undefined
                : () => set("hasThirdPlaceMatch", !values.hasThirdPlaceMatch)
            }
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              padding: "14px 16px",
              border: `1.5px solid ${
                values.hasThirdPlaceMatch ? "var(--blue-500)" : "var(--line-strong-cy)"
              }`,
              borderRadius: 10,
              cursor: locked("hasThirdPlaceMatch") ? "not-allowed" : "pointer",
              opacity: locked("hasThirdPlaceMatch") ? 0.6 : 1,
              transition: "border-color 0.2s ease, background-color 0.2s ease, opacity 0.2s ease",
              backgroundColor: values.hasThirdPlaceMatch
                ? "rgba(90, 200, 255, 0.07)"
                : "transparent",
            }}
          >
            <input
              id="third-place"
              type="checkbox"
              disabled={locked("hasThirdPlaceMatch")}
              checked={values.hasThirdPlaceMatch}
              onChange={(e) => set("hasThirdPlaceMatch", e.target.checked)}
              style={{
                width: 18,
                height: 18,
                accentColor: "var(--blue-500)",
                cursor: locked("hasThirdPlaceMatch") ? "not-allowed" : "pointer",
                flexShrink: 0,
                marginTop: 2,
              }}
              {...lockedAttr("hasThirdPlaceMatch")}
            />
            <div style={{ flex: 1 }}>
              <label
                htmlFor="third-place"
                style={{
                  display: "block",
                  margin: "0 0 4px",
                  cursor: locked("hasThirdPlaceMatch") ? "not-allowed" : "pointer",
                  userSelect: "none",
                  fontSize: 14,
                  fontWeight: 500,
                  color: "var(--ink)",
                }}
              >
                Petite finale
              </label>
              <p style={{ ...HINT, margin: 0 }}>
                Ajoute un match pour déterminer la 3ᵉ place entre les deux perdants des
                demi-finales.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
