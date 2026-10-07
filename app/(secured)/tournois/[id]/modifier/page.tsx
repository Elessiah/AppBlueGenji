"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { LocaleLink, useLocaleRouter } from "@/components/i18n/locale-navigation";
import { richNodes } from "@/components/i18n/shell-text";
import type { TournamentErrorsText, TournamentFormText } from "@/lib/shared/tournament-actions-text";
import { useToast } from "@/components/ui/toast";
import { can, type PlatformRole } from "@/lib/shared/permissions";
import {
  editableFieldsForWindow,
  type EditLockReason,
  type EditWindow,
  type TournamentField,
} from "@/lib/shared/tournament-edit";
import {
  TournamentForm,
  toApiPayload,
  toFormValues,
  type TournamentApiValues,
  type TournamentFormValues,
} from "../../_components/TournamentForm";
import { editLockNoticeText, editSavedText, type PlanningSaveResult } from "../_lib/edit-entry";
import { canToggleRefereeScheduling } from "@/lib/shared/match-planning";
import type { TournamentState } from "@/lib/shared/types";
import { mapError, useErrorsText } from "../_lib/error-map";
import { useFormText } from "../../_lib/form-text";
import { CodedError } from "@/lib/shared/field-errors";

/**
 * Édition d'un tournoi.
 *
 * Le formulaire lui-même vit dans `_components/TournamentForm`, partagé avec
 * la création. Cette page ne garde que ce qui tient à la route : garde de
 * permission, chargement des valeurs et de la fenêtre d'édition, appel réseau.
 */

/**
 * Champs éditables qu'un refus peut nommer (`edit.fields.*`) : leur nom, dans
 * la langue de la page, suit la phrase du refus entre parenthèses.
 */
const LABELED_FIELDS = [
  "name",
  "description",
  "game",
  "format",
  "participantType",
  "maxTeams",
  "startVisibilityAt",
  "registrationOpenAt",
  "registrationCloseAt",
  "startAt",
  "hasThirdPlaceMatch",
  "survivalRoundsBeforeFirstCut",
  "survivalRoundsPerCut",
  "swissTotalRounds",
  "swissPointsWin",
  "swissPointsDraw",
  "swissPointsLoss",
  "endurancePoints",
  "enduranceWinDelta",
  "enduranceLossDelta",
  "endurancePlayoffSize",
  "enduranceMaxRounds",
  "matchFormat",
  "endurancePlayoffFormat",
  "registrationDiscordRequirement",
  "registrationBlizzardRequirement",
  "registrationMinPlayers",
  "phases",
] as const satisfies readonly TournamentField[];

type EditLoadPayload = {
  window: EditWindow;
  values: TournamentApiValues;
  state: TournamentState;
  refereeScheduling: boolean;
};

/** Raison du verrou affichée en tête : aucune, publication, ou tournoi lancé. */
function lockReasonFor(window: EditWindow): EditLockReason {
  if (window === "FULL") return null;
  return window === "LOCKED" ? "STARTED" : "VISIBLE";
}

/** Refus d'une route d'édition, le champ en cause nommé entre parenthèses. */
function refusalText(
  text: TournamentFormText,
  errors: TournamentErrorsText,
  code: string,
  field: string | undefined,
): string {
  const message = mapError(code, errors);
  const labeled = LABELED_FIELDS.find((candidate) => candidate === field);
  if (!labeled) return message;
  return text.t("edit.fieldRefusal", { message, field: text.t(`edit.fields.${labeled}`) });
}

/** Refus de la bascule de planification (`refereeSchedulingErrorMessage`). */
function planningErrorText(text: TournamentFormText, code: string): string {
  const known = (["TOURNAMENT_NOT_FOUND", "TOURNAMENT_FINISHED", "INVALID_REFEREE_SCHEDULING"] as const).find((c) => c === code);
  return text.t(known ? `edit.planningErrors.${known}` : "edit.planningErrors.fallback");
}

/** Envoie les champs de la fenêtre d'édition ; un refus nomme le champ en cause. */
async function saveEditableFields(
  tournamentId: number,
  body: Record<string, unknown>,
  text: TournamentFormText,
  errors: TournamentErrorsText,
): Promise<void> {
  const response = await fetch(`/api/tournaments/${tournamentId}/edit`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.ok) return;
  const result = (await response.json().catch(() => ({}))) as { error?: string; field?: string };
  const code = result.error ?? "TOURNAMENT_UPDATE_FAILED";
  throw new CodedError(code, refusalText(text, errors, code, result.field));
}

async function saveRefereeScheduling(
  tournamentId: number,
  enabled: boolean,
  text: TournamentFormText,
): Promise<PlanningSaveResult> {
  const response = await fetch(`/api/admin/tournaments/${tournamentId}/referee-scheduling`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  const result = (await response.json().catch(() => ({}))) as {
    error?: string;
    changed?: boolean;
    movedToPlanning?: number;
  };
  if (response.ok) {
    return { changed: result.changed === true, movedToPlanning: result.movedToPlanning ?? 0 };
  }
  const code = result.error ?? "UNKNOWN";
  throw new CodedError(code, planningErrorText(text, code));
}

export default function EditTournamentPage() {
  const params = useParams<{ id: string }>();
  const router = useLocaleRouter();
  const { showError, showSuccess } = useToast();
  const text = useFormText();
  const { t } = text;
  const errorsText = useErrorsText();
  const hl = (children: ReadonlyArray<ReactNode>) => <span className="text-gradient">{richNodes(children)}</span>;
  const tournamentId = Number(params.id);

  const [loaded, setLoaded] = useState<{
    window: EditWindow;
    values: TournamentFormValues;
    startVisibilityAt: string;
    state: TournamentState;
    refereeScheduling: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      // Une coupure réseau rejette ici et file vers « Erreur réseau » plus bas,
      // au lieu de se faire passer pour un refus de droits.
      const meResponse = await fetch("/api/auth/me", { cache: "no-store" });
      const me = meResponse.ok
        ? ((await meResponse.json().catch(() => null)) as { user?: { isAdmin?: boolean; roles?: PlatformRole[] } } | null)
        : null;
      if (cancelled) return;
      if (!can(me?.user, "tournaments")) {
        showError(t("edit.forbidden"));
        router.replace("/tournois");
        return;
      }

      const response = await fetch(`/api/tournaments/${tournamentId}/edit`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as
        | EditLoadPayload
        | { error?: string; field?: string };
      if (cancelled) return;
      if (!response.ok) {
        const errorPayload = payload as { error?: string; field?: string };
        showError(refusalText(text, errorsText, errorPayload.error ?? "TOURNAMENT_NOT_FOUND", errorPayload.field));
        router.replace("/tournois");
        return;
      }

      // Les valeurs serveur arrivent en ISO ; le formulaire attend des dates
      // locales `datetime-local`.
      const successPayload = payload as EditLoadPayload;
      setLoaded({
        window: successPayload.window,
        values: {
          ...toFormValues(successPayload.values),
          refereeScheduling: successPayload.refereeScheduling,
        },
        startVisibilityAt: successPayload.values.startVisibilityAt,
        state: successPayload.state,
        refereeScheduling: successPayload.refereeScheduling,
      });
    };
    // Une coupure réseau pendant le chargement laissait la page sur
    // « Chargement du tournoi... » sans rien dire : même sortie que les
    // autres échecs de chargement, message réseau en plus.
    load().catch(() => {
      if (cancelled) return;
      showError(t("edit.network"));
      router.replace("/tournois");
    });

    return () => {
      cancelled = true;
    };
  }, [tournamentId, router, showError, t, text, errorsText]);

  if (!loaded) {
    return (
      <section className="fade-in container">
        <p style={{ color: "var(--ink-mute)" }}>{t("edit.loading")}</p>
      </section>
    );
  }

  // Plus rien ne se règle sur un tournoi terminé, planification comprise. Le
  // bouton « Modifier » n'y apparaît pas, mais l'URL reste atteignable à la
  // main : on explique plutôt que de rendre un formulaire entièrement grisé.
  const planningEditable = canToggleRefereeScheduling(loaded.state);
  if (loaded.window === "LOCKED" && !planningEditable) {
    return (
      <section className="fade-in container">
        <LocaleLink href={`/tournois/${tournamentId}`} style={{ fontSize: 13, color: "var(--ink-mute)" }}>
          {t("edit.back")}
        </LocaleLink>
        <p style={{ color: "var(--amber)", marginTop: 16 }}>{t("edit.finished")}</p>
      </section>
    );
  }

  const editableFields: ReadonlySet<TournamentField> = editableFieldsForWindow(loaded.window);
  // Tournoi lancé : la fenêtre est fermée, seule la planification reste —
  // le formulaire est rendu entier mais grisé, sauf cette case.
  const notice = editLockNoticeText(text, lockReasonFor(loaded.window), loaded.startVisibilityAt);
  const explanationId = notice ? "tournament-lock-notice" : undefined;

  return (
    <section className="fade-in container">
      <div style={{ marginBottom: 28 }}>
        <LocaleLink href={`/tournois/${tournamentId}`} style={{ fontSize: 13, color: "var(--ink-mute)" }}>
          {t("edit.back")}
        </LocaleLink>
        <h1 className="display" style={{ fontSize: "clamp(30px, 6vw, 48px)", margin: "12px 0 8px" }}>
          {richNodes(text.rich("edit.title", {}, { hl }))}
        </h1>
        {notice && <p id={explanationId} style={{ color: "var(--amber)", margin: 0, fontSize: 14 }}>{notice}</p>}
      </div>

      <TournamentForm
        mode="edit"
        initialValues={loaded.values}
        editableFields={editableFields}
        submitLabel={t("edit.submit")}
        explanationId={explanationId}
        refereeSchedulingEditable={planningEditable}
        tournamentState={loaded.state}
        onSubmit={async (values) => {
          const payload = toApiPayload(values);
          const body: Record<string, unknown> = {};
          for (const field of editableFields) {
            if (field === "matchFormat") {
              // `toApiPayload` aplatit le format de match en quatre clés
              // (type, nombre de manches, plafond de maps, égalités) alors que
              // la route d'édition n'en connaît qu'une, `matchFormat` : on les
              // recompose ici plutôt que de recopier `payload.matchFormat`,
              // qui n'existe pas.
              body.matchFormat =
                payload.matchFormatType === null
                  ? null
                  : {
                      type: payload.matchFormatType,
                      value: payload.matchFormatValue,
                      maxMaps: payload.matchFormatMaxMaps,
                      drawsAllowed: payload.matchFormatDraws,
                    };
              continue;
            }
            if (field === "endurancePlayoffFormat") {
              // Même recomposition, pour le format de l'arbre final de BG
              // Survie. `null` = l'arbre reprend celui du tournoi.
              body.endurancePlayoffFormat =
                payload.endurancePlayoffFormatType === null
                  ? null
                  : {
                      type: payload.endurancePlayoffFormatType,
                      value: payload.endurancePlayoffFormatValue,
                    };
              continue;
            }
            body[field] = payload[field];
          }

          // Fenêtre fermée (tournoi lancé) : aucun champ à envoyer, la route
          // d'édition refuserait — seule la planification part.
          const fieldsSent = Object.keys(body).length > 0;
          if (fieldsSent) await saveEditableFields(tournamentId, body, text, errorsText);

          // La planification a sa route : bascule tenue sous verrou du
          // tournoi, qui défait les lancements à défaire — et après l'édition,
          // qu'un refus n'emporte pas. Envoyée **à chaque** enregistrement, et
          // pas seulement quand la case diffère de la lecture d'ouverture :
          // celle-ci a pu être changée depuis la fiche entre-temps, et
          // l'enregistrement doit écrire ce que le formulaire montre. La route
          // est idempotente (rien n'est réécrit ni annoncé sans changement).
          const planning = planningEditable
            ? await saveRefereeScheduling(tournamentId, values.refereeScheduling, text)
            : null;

          showSuccess(editSavedText(text, fieldsSent, planning, values.refereeScheduling));
          router.push(`/tournois/${tournamentId}`);
          router.refresh();
        }}
      />
    </section>
  );
}
