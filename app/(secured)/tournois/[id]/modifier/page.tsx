"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { can, type PlatformRole } from "@/lib/shared/permissions";
import {
  editableFieldsForWindow,
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
import { editLockNotice } from "../_lib/edit-entry";
import { mapError } from "../_lib/error-map";

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
  survivalRoundsBeforeFirstCut: "Rounds avant la première coupe",
  survivalRoundsPerCut: "Rounds entre les coupes",
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
  phases: "Phases du tournoi",
};

export default function EditTournamentPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { showError, showSuccess } = useToast();
  const tournamentId = Number(params.id);

  const [loaded, setLoaded] = useState<{
    window: EditWindow;
    values: TournamentFormValues;
    startVisibilityAt: string;
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
        | { window: EditWindow; values: TournamentApiValues }
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
      const successPayload = payload as { window: EditWindow; values: TournamentApiValues };
      setLoaded({
        window: successPayload.window,
        values: toFormValues(successPayload.values),
        startVisibilityAt: successPayload.values.startVisibilityAt,
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

  // Le bouton « Modifier » n'apparaît pas sur un tournoi lancé, mais l'URL
  // reste atteignable à la main : on explique plutôt que de rendre un
  // formulaire entièrement grisé.
  if (loaded.window === "LOCKED") {
    return (
      <section className="fade-in container">
        <Link href={`/tournois/${tournamentId}`} style={{ fontSize: 13, color: "var(--ink-mute)" }}>
          ← Retour au tournoi
        </Link>
        <p style={{ color: "var(--amber)", marginTop: 16 }}>
          {editLockNotice("STARTED", loaded.startVisibilityAt)}
        </p>
      </section>
    );
  }

  const editableFields: ReadonlySet<TournamentField> = editableFieldsForWindow(loaded.window);
  const notice = editLockNotice(
    loaded.window === "FULL" ? null : "VISIBLE",
    loaded.startVisibilityAt,
  );
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
        onSubmit={async (values) => {
          const payload = toApiPayload(values);
          const body: Record<string, unknown> = {};
          for (const field of editableFields) {
            if (field === "matchFormat") {
              // `toApiPayload` aplatit le format de match en deux clés
              // (`matchFormatType` / `matchFormatValue`) alors que la route
              // d'édition n'en connaît qu'une, `matchFormat` : on les
              // recompose ici plutôt que de recopier `payload.matchFormat`,
              // qui n'existe pas.
              body.matchFormat =
                payload.matchFormatType === null
                  ? null
                  : { type: payload.matchFormatType, value: payload.matchFormatValue };
              continue;
            }
            body[field] = payload[field];
          }

          const response = await fetch(`/api/tournaments/${tournamentId}/edit`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          const result = (await response.json().catch(() => ({}))) as { error?: string; field?: string };
          if (!response.ok) {
            let message = mapError(result.error ?? "TOURNAMENT_UPDATE_FAILED");
            if (result.field && FIELD_LABELS[result.field as TournamentField]) {
              message += ` (${FIELD_LABELS[result.field as TournamentField]})`;
            }
            throw new Error(message);
          }

          showSuccess("Tournoi modifié.");
          router.push(`/tournois/${tournamentId}`);
          router.refresh();
        }}
      />
    </section>
  );
}
