"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import type { TournamentFormat, TournamentGame } from "@/lib/shared/types";
import { validatePhases } from "@/lib/shared/tournament-phases";
import { computeRecommendedRounds } from "@/lib/shared/swiss";
import {
  DEFAULT_MATCH_FORMAT,
  MATCH_FORMAT_BOUNDS,
  isValidMatchFormat,
  matchFormatDescription,
  matchFormatLabel,
  type MatchFormatType,
} from "@/lib/shared/match-format";
import { participantWording, type ParticipantType } from "@/lib/shared/participants";
import type { TournamentField } from "@/lib/shared/tournament-edit";
import { useToast } from "@/components/ui/toast";
import { CyberCard, CyberButton } from "@/components/cyber";
import { phaseErrorMessage } from "../creer/phase-form";
import { FormatSettings } from "./FormatSettings";
import {
  EYEBROW,
  FULL_WIDTH,
  GRID,
  HINT,
  SECTION_SEPARATOR,
  SECTION_STACK,
} from "../_lib/form-styles";
import {
  defaultTournamentFormValues,
  toApiPayload,
  toFormValues,
  type TournamentApiValues,
  type TournamentFormValues,
} from "../_lib/tournament-form-values";

// Les valeurs et leurs conversions vivent dans `_lib/tournament-form-values`.
// Réexportées ici : les deux pages qui montent ce formulaire (création et
// édition) n'ont qu'un import à faire, et les tests existants ne bougent pas.
export {
  defaultTournamentFormValues,
  toApiPayload,
  toFormValues,
  type TournamentApiValues,
  type TournamentFormValues,
};

/**
 * Formulaire de tournoi, partagé par la création et l'édition.
 *
 * La page qui l'accueille garde ce qui relève de la route — en-tête, retour à
 * l'accueil, garde de permission, appel réseau. Le composant ne connaît que des
 * valeurs et une liste de champs modifiables : tout champ absent de
 * `editableFields` est rendu non interactif, jamais masqué, pour que
 * l'organisateur voie le réglage qu'il ne peut plus toucher.
 */

export type TournamentFormProps = {
  mode: "create" | "edit";
  initialValues: TournamentFormValues;
  editableFields: ReadonlySet<TournamentField>;
  submitLabel: string;
  onSubmit: (values: TournamentFormValues) => Promise<void>;
  explanationId?: string;
};

export function TournamentForm({
  mode,
  initialValues,
  editableFields,
  submitLabel,
  onSubmit,
  explanationId,
}: TournamentFormProps) {
  const { showError } = useToast();

  const [values, setValues] = useState<TournamentFormValues>(initialValues);
  const set = <K extends keyof TournamentFormValues>(key: K, value: TournamentFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const locked = (field: TournamentField) => !editableFields.has(field);
  const lockedAttr = (field: TournamentField) => (locked(field) && explanationId ? { "aria-describedby": explanationId } : {});

  // Ronde suisse : le nombre de rondes suit la recommandation ⌈log₂(N)⌉ + 1 tant
  // que l'organisateur n'a pas saisi la sienne — sinon un changement d'effectif
  // écraserait son choix. À l'édition, la valeur enregistrée fait foi d'emblée.
  const [swissRoundsTouched, setSwissRoundsTouched] = useState(mode === "edit");
  // « Libre » ne retient pas de nombre de manches : on garde le dernier saisi
  // pour le restituer si l'organisateur revient à un BO ou un FT.
  const [lastMatchFormatValue, setLastMatchFormatValue] = useState(
    initialValues.matchFormat?.value ?? DEFAULT_MATCH_FORMAT.value,
  );
  const [loading, setLoading] = useState(false);

  const { format, maxTeams, phases } = values;
  const wording = participantWording(values.participantType);

  const matchFormatType: MatchFormatType | "LIBRE" = values.matchFormat?.type ?? "LIBRE";
  const matchFormatValue = values.matchFormat?.value ?? lastMatchFormatValue;
  const isLibre = matchFormatType === "LIBRE";
  const matchFormat = isLibre ? null : { type: matchFormatType, value: matchFormatValue };
  const matchFormatValid = isLibre || isValidMatchFormat(matchFormatType, matchFormatValue);

  const setMaxTeams = (value: number) =>
    setValues((prev) => ({
      ...prev,
      maxTeams: value,
      swissTotalRounds: swissRoundsTouched ? prev.swissTotalRounds : computeRecommendedRounds(value),
    }));
  const setSwissTotalRounds = (value: number) => {
    setSwissRoundsTouched(true);
    set("swissTotalRounds", value);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      if (!matchFormatValid) {
        showError(
          matchFormatType === "BO"
            ? "Un Best of doit se jouer en nombre impair de manches (BO1, BO3, BO5…)."
            : "Nombre de manches du format de match invalide.",
        );
        setLoading(false);
        return;
      }

      // Validate phases for MULTI format
      if (format === "MULTI") {
        const error = validatePhases(phases);
        if (error) {
          showError(phaseErrorMessage(error));
          setLoading(false);
          return;
        }
      }

      await onSubmit(values);
    } catch (e) {
      showError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <CyberCard ticks style={{ padding: "clamp(20px, 3vw, 32px)" }}>
      <form onSubmit={handleSubmit} style={SECTION_STACK}>
        <section>
          <p className="eyebrow" style={EYEBROW}>
            Identité
          </p>
          <div className="form-grid" style={GRID}>
            <div className="field">
              <label htmlFor="tournament-name">Nom du tournoi</label>
              <input
                id="tournament-name"
                required
                disabled={locked("name")}
                value={values.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Mon tournoi"
                {...lockedAttr("name")}
              />
            </div>
            <div className="field">
              <label htmlFor="tournament-game">Jeu</label>
              <select
                id="tournament-game"
                disabled={locked("game")}
                value={values.game}
                onChange={(e) => set("game", e.target.value as TournamentGame)}
                {...lockedAttr("game")}
              >
                <option value="OW2">Overwatch</option>
                <option value="MR">Marvel Rivals</option>
              </select>
            </div>
            <div className="field" style={FULL_WIDTH}>
              <label htmlFor="tournament-description">Description</label>
              <textarea
                id="tournament-description"
                disabled={locked("description")}
                value={values.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="Description du tournoi..."
                {...lockedAttr("description")}
              />
            </div>
          </div>
        </section>

        <section style={SECTION_SEPARATOR}>
          <p className="eyebrow" style={EYEBROW}>
            Format
          </p>
          <div className="form-grid" style={GRID}>
            <div className="field">
              <label htmlFor="tournament-format">Format de bracket</label>
              <select
                id="tournament-format"
                disabled={locked("format")}
                value={format}
                onChange={(e) =>
                  setValues((prev) => ({
                    ...prev,
                    format: e.target.value as TournamentFormat,
                    hasThirdPlaceMatch: false,
                  }))
                }
                {...lockedAttr("format")}
              >
                <option value="SINGLE">Simple élimination</option>
                <option value="DOUBLE">Double élimination</option>
                <option value="SWISS">Ronde suisse</option>
                <option value="SURVIVAL">Survie</option>
                <option value="BG_SURVIE">BlueGenji Survie (endurance)</option>
                <option value="MULTI">Multi-phases</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="participant-type">Type de participants</label>
              <select
                id="participant-type"
                aria-describedby={`participant-type-hint${locked("participantType") && explanationId ? ` ${explanationId}` : ""}`}
                disabled={locked("participantType")}
                value={values.participantType}
                onChange={(e) => set("participantType", e.target.value as ParticipantType)}
              >
                <option value="TEAM">Équipes</option>
                <option value="SOLO">Joueurs (individuel)</option>
              </select>
              <p id="participant-type-hint" style={HINT}>
                En individuel, chaque joueur s&apos;inscrit lui-même, sans passer par une
                équipe.
              </p>
            </div>
            <div className="field">
              <label htmlFor="max-teams">{wording.maxLabel}</label>
              <input
                id="max-teams"
                type="number"
                min={2}
                max={256}
                disabled={locked("maxTeams")}
                value={maxTeams}
                onChange={(e) => setMaxTeams(Number(e.target.value))}
                {...lockedAttr("maxTeams")}
              />
            </div>

            <div className="field">
              <label htmlFor="match-format-type">Format de match</label>
              <select
                id="match-format-type"
                disabled={locked("matchFormat")}
                value={matchFormatType}
                onChange={(e) => {
                  const next = e.target.value as MatchFormatType | "LIBRE";
                  if (next === "LIBRE") {
                    set("matchFormat", null);
                    return;
                  }
                  // Les deux notations n'ont ni les mêmes bornes ni la même
                  // parité : on ramène la valeur héritée dans le domaine du
                  // nouveau type plutôt que de laisser un état invalide que
                  // l'organisateur devrait corriger à la main.
                  const bounds = MATCH_FORMAT_BOUNDS[next];
                  let value = Math.min(Math.max(matchFormatValue, bounds.min), bounds.max);
                  if (next === "BO" && value % 2 === 0) value -= 1;
                  setLastMatchFormatValue(value);
                  set("matchFormat", { type: next, value });
                }}
                {...lockedAttr("matchFormat")}
              >
                <option value="BO">Best of (BO)</option>
                <option value="FT">First to (FT)</option>
                <option value="LIBRE">Libre (aucune limite)</option>
              </select>
              <p style={HINT}>
                {isLibre
                  ? "Les scores sont saisis sans contrainte."
                  : matchFormatValid
                    ? `${matchFormatLabel(matchFormat)} — ${matchFormatDescription(matchFormat)}`
                    : matchFormatType === "BO"
                      ? "Un Best of se joue en nombre impair de manches (BO1, BO3, BO5…)."
                      : "Saisis le nombre de manches à gagner."}
              </p>
            </div>

            {!isLibre && (
              <div className="field">
                <label htmlFor="match-format-value">
                  {matchFormatType === "BO" ? "Manches jouées (impair)" : "Manches à gagner"}
                </label>
                <input
                  id="match-format-value"
                  type="number"
                  min={MATCH_FORMAT_BOUNDS[matchFormatType].min}
                  max={MATCH_FORMAT_BOUNDS[matchFormatType].max}
                  step={matchFormatType === "BO" ? 2 : 1}
                  disabled={locked("matchFormat")}
                  value={matchFormatValue}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    setLastMatchFormatValue(value);
                    set("matchFormat", { type: matchFormatType, value });
                  }}
                  {...lockedAttr("matchFormat")}
                />
                <p style={HINT}>
                  {matchFormatType === "BO"
                    ? "Le score d'une équipe ne peut pas dépasser la moitié supérieure : 3 en BO5."
                    : "Objectif à atteindre pour remporter le match : 3 en FT3."}
                </p>
              </div>
            )}

            <FormatSettings
              values={values}
              set={set}
              locked={locked}
              lockedAttr={lockedAttr}
              onSwissTotalRoundsChange={setSwissTotalRounds}
            />
          </div>
        </section>

        <section style={SECTION_SEPARATOR}>
          <p className="eyebrow" style={EYEBROW}>
            Planning
          </p>
          <div className="form-grid" style={GRID}>
            <div className="field">
              <label htmlFor="visibility-at">Début visibilité</label>
              <input
                id="visibility-at"
                type="datetime-local"
                disabled={locked("startVisibilityAt")}
                value={values.startVisibilityAt}
                onChange={(e) => set("startVisibilityAt", e.target.value)}
                {...lockedAttr("startVisibilityAt")}
              />
            </div>
            <div className="field">
              <label htmlFor="registration-open-at">Début inscriptions</label>
              <input
                id="registration-open-at"
                type="datetime-local"
                disabled={locked("registrationOpenAt")}
                value={values.registrationOpenAt}
                onChange={(e) => set("registrationOpenAt", e.target.value)}
                {...lockedAttr("registrationOpenAt")}
              />
            </div>
            <div className="field">
              <label htmlFor="registration-close-at">Fin inscriptions</label>
              <input
                id="registration-close-at"
                type="datetime-local"
                disabled={locked("registrationCloseAt")}
                value={values.registrationCloseAt}
                onChange={(e) => set("registrationCloseAt", e.target.value)}
                {...lockedAttr("registrationCloseAt")}
              />
            </div>
            <div className="field">
              <label htmlFor="start-at">Début tournoi</label>
              <input
                id="start-at"
                type="datetime-local"
                disabled={locked("startAt")}
                value={values.startAt}
                onChange={(e) => set("startAt", e.target.value)}
                {...lockedAttr("startAt")}
              />
            </div>
          </div>
        </section>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "flex-end",
            gap: 12,
            paddingTop: 24,
            borderTop: "1px solid var(--line-soft)",
          }}
        >
          <CyberButton variant="ghost" asChild>
            <Link href="/tournois">Annuler</Link>
          </CyberButton>
          <CyberButton
            variant="primary"
            type="submit"
            disabled={loading}
            style={{ opacity: loading ? 0.6 : 1, cursor: loading ? "not-allowed" : "pointer" }}
          >
            {loading ? (mode === "create" ? "Création..." : "Enregistrement...") : submitLabel}
          </CyberButton>
        </div>
      </form>
    </CyberCard>
  );
}
