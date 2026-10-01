"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
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
import { editLockNotice, FINISHED_EDIT_NOTICE } from "../_lib/edit-entry";
import {
  canToggleRefereeScheduling,
  refereeSchedulingErrorMessage,
} from "@/lib/shared/match-planning";
import type { TournamentState } from "@/lib/shared/types";
import { mapError } from "../_lib/error-map";
import { CodedError } from "@/lib/shared/field-errors";

/**
 * Édition d'un tournoi.
 *
 * Le formulaire lui-même vit dans `_components/TournamentForm`, partagé avec
 * la création. Cette page ne garde que ce qui tient à la route : garde de
 * permission, chargement des valeurs et de la fenêtre d'édition, appel réseau.
 */

/** Traduction française des noms de champ éditables. */
const FIELD_LABELS: Partial<Record<TournamentField, string>> = {
  name: "Nom du tournoi",
  description: "Description",
  game: "Jeu",
  format: "Format de bracket",
  participantType: "Type de participants",
  maxTeams: "Nombre de places",
  startVisibilityAt: "Début visibilité",
  registrationOpenAt: "Début inscriptions",
  registrationCloseAt: "Fin inscriptions",
  startAt: "Début tournoi",
  hasThirdPlaceMatch: "Petite finale",
  survivalRoundsBeforeFirstCut: "Manches avant la première coupe",
  survivalRoundsPerCut: "Manches entre les coupes",
  swissTotalRounds: "Nombre de rondes",
  swissPointsWin: "Points par victoire",
  swissPointsDraw: "Points par nul",
  swissPointsLoss: "Points par défaite",
  endurancePoints: "Capital d'endurance",
  enduranceWinDelta: "Points par victoire de map",
  enduranceLossDelta: "Points par défaite de map",
  endurancePlayoffSize: "Équipes en play-offs",
  enduranceMaxRounds: "Manches maximum",
  matchFormat: "Format de match",
  endurancePlayoffFormat: "Format des play-offs",
  registrationDiscordRequirement: "Discord vérifié à l'inscription",
  registrationBlizzardRequirement: "Compte Blizzard à l'inscription",
  registrationMinPlayers: "Joueurs minimum dans l'équipe",
  phases: "Phases du tournoi",
};

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

/** Envoie les champs de la fenêtre d'édition ; un refus nomme le champ en cause. */
async function saveEditableFields(tournamentId: number, body: Record<string, unknown>): Promise<void> {
  const response = await fetch(`/api/tournaments/${tournamentId}/edit`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.ok) return;
  const result = (await response.json().catch(() => ({}))) as { error?: string; field?: string };
  const code = result.error ?? "TOURNAMENT_UPDATE_FAILED";
  let message = mapError(code);
  if (result.field && FIELD_LABELS[result.field as TournamentField]) {
    message += ` (${FIELD_LABELS[result.field as TournamentField]})`;
  }
  throw new CodedError(code, message);
}

async function saveRefereeScheduling(tournamentId: number, enabled: boolean): Promise<void> {
  const response = await fetch(`/api/admin/tournaments/${tournamentId}/referee-scheduling`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (response.ok) return;
  const result = (await response.json().catch(() => ({}))) as { error?: string };
  const code = result.error ?? "UNKNOWN";
  throw new CodedError(code, refereeSchedulingErrorMessage(code));
}

export default function EditTournamentPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { showError, showSuccess } = useToast();
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

    (async () => {
      const me = await fetch("/api/auth/me", { cache: "no-store" })
        .then(async (r) =>
          r.ok ? ((await r.json()) as { user?: { isAdmin?: boolean; roles?: PlatformRole[] } }) : null,
        )
        .catch(() => null);
      if (!can(me?.user, "tournaments")) {
        showError("Modification de tournoi réservée aux arbitres et administrateurs.");
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
        let message = mapError(errorPayload.error ?? "TOURNAMENT_NOT_FOUND");
        if (errorPayload.field && FIELD_LABELS[errorPayload.field as TournamentField]) {
          message += ` (${FIELD_LABELS[errorPayload.field as TournamentField]})`;
        }
        showError(message);
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
    })();

    return () => {
      cancelled = true;
    };
  }, [tournamentId, router, showError]);

  if (!loaded) {
    return (
      <section className="fade-in container">
        <p style={{ color: "var(--ink-mute)" }}>Chargement du tournoi...</p>
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
        <Link href={`/tournois/${tournamentId}`} style={{ fontSize: 13, color: "var(--ink-mute)" }}>
          ← Retour au tournoi
        </Link>
        <p style={{ color: "var(--amber)", marginTop: 16 }}>{FINISHED_EDIT_NOTICE}</p>
      </section>
    );
  }

  const editableFields: ReadonlySet<TournamentField> = editableFieldsForWindow(loaded.window);
  // Tournoi lancé : la fenêtre est fermée, seule la planification reste —
  // le formulaire est rendu entier mais grisé, sauf cette case.
  const notice = editLockNotice(lockReasonFor(loaded.window), loaded.startVisibilityAt);
  const explanationId = notice ? "tournament-lock-notice" : undefined;

  return (
    <section className="fade-in container">
      <div style={{ marginBottom: 28 }}>
        <Link href={`/tournois/${tournamentId}`} style={{ fontSize: 13, color: "var(--ink-mute)" }}>
          ← Retour au tournoi
        </Link>
        <h1 className="display" style={{ fontSize: "clamp(30px, 6vw, 48px)", margin: "12px 0 8px" }}>
          Modifier le tournoi
        </h1>
        {notice && <p id={explanationId} style={{ color: "var(--amber)", margin: 0, fontSize: 14 }}>{notice}</p>}
      </div>

      <TournamentForm
        mode="edit"
        initialValues={loaded.values}
        editableFields={editableFields}
        submitLabel="Enregistrer les modifications"
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
          if (Object.keys(body).length > 0) await saveEditableFields(tournamentId, body);

          // La planification a sa route : bascule tenue sous verrou du
          // tournoi, qui défait les lancements à défaire. Envoyée seulement si
          // la case a changé — et après l'édition, qu'un refus n'emporte pas.
          if (values.refereeScheduling !== loaded.refereeScheduling) {
            await saveRefereeScheduling(tournamentId, values.refereeScheduling);
          }

          showSuccess("Tournoi modifié.");
          router.push(`/tournois/${tournamentId}`);
          router.refresh();
        }}
      />
    </section>
  );
}
