"use client";

import { FormEvent, useState, type ReactNode } from "react";
import { useToast } from "@/components/ui/toast";
import { richNodes } from "@/components/i18n/shell-text";
import { isDeletionConfirmed } from "@/lib/shared/tournament-deletion";
import { useMapError } from "../_lib/error-map";
import { useDialogsText } from "../_lib/dialogs-text";
import { TournamentDialogFrame } from "./TournamentDialogFrame";

interface DeleteTournamentDialogProps {
  tournamentId: number;
  tournamentName: string;
  onClose: () => void;
  onDeleted: (tournamentName: string) => void;
}

/**
 * Confirmation de la suppression définitive d'un tournoi.
 *
 * Le bouton ne s'arme qu'une fois le nom du tournoi recopié à l'identique
 * (`lib/shared/tournament-deletion.ts`) : l'action détruit les matchs, les
 * inscriptions et les classements, elle ne doit pas pouvoir se déclencher d'un
 * clic distrait. Le dialogue liste explicitement ce qui part et ce qui reste.
 *
 * Voile, cadre, portail et comportement modal : `TournamentDialogFrame`, monté
 * après le premier rendu (`deferMount`) pour que la saisie ait le curseur à
 * l'ouverture. `busy` verrouille Échap pendant l'envoi : une modale en train
 * d'écrire ne se referme pas — la suppression, elle, partirait quand même.
 */
export function DeleteTournamentDialog({
  tournamentId,
  tournamentName,
  onClose,
  onDeleted,
}: Readonly<DeleteTournamentDialogProps>) {
  const { showError } = useToast();
  const mapError = useMapError();
  const text = useDialogsText();
  const { t } = text;
  const strong = (children: ReadonlyArray<ReactNode>) => <strong style={{ color: "var(--ink)" }}>{richNodes(children)}</strong>;
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);

  const armed = isDeletionConfirmed(tournamentName, confirmation);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!armed || busy) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/admin/tournaments/${tournamentId}`, { method: "DELETE" });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error || "TOURNAMENT_DELETE_FAILED");
      onDeleted(tournamentName);
    } catch (e) {
      showError(mapError((e as Error).message));
      setBusy(false);
    }
  };

  return (
    <TournamentDialogFrame
      titleId="delete-tournament-title"
      maxWidth={480}
      border="1px solid var(--red-live, #ff4d4d)"
      zIndex={90}
      deferMount
      busy={busy}
      onClose={onClose}
    >
      <h3
        id="delete-tournament-title"
        style={{ margin: 0, fontSize: 18, color: "var(--red-live, #ff4d4d)" }}
      >
        {t("delete.title")}
      </h3>

      <p style={{ marginTop: 10, fontSize: 13, color: "var(--ink-quiet, #9aa4b2)", lineHeight: 1.55 }}>
        {richNodes(text.rich("delete.body", { name: tournamentName }, { strong }))}
      </p>
      <p style={{ marginTop: 8, fontSize: 13, color: "var(--ink-quiet, #9aa4b2)", lineHeight: 1.55 }}>
        {t("delete.kept")}
      </p>

      <form onSubmit={submit}>
        <div className="field" style={{ marginTop: 18 }}>
          <label htmlFor="delete-tournament-confirmation">
            {t("delete.label")}
          </label>
          <input
            id="delete-tournament-confirmation"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder={tournamentName}
            autoComplete="off"
            disabled={busy}
            aria-describedby="delete-tournament-hint"
          />
          <p
            id="delete-tournament-hint"
            aria-live="polite"
            style={{ marginTop: 6, fontSize: 12, color: "var(--ink-dim, #6b7480)" }}
          >
            {armed ? t("delete.armed") : t("delete.blocked")}
          </p>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
          <button
            type="button"
            className="btn ghost"
            onClick={onClose}
            disabled={busy}
            style={{ padding: "8px 18px", fontSize: 13 }}
          >
            {t("score.cancel")}
          </button>
          <button
            type="submit"
            className="btn"
            disabled={!armed || busy}
            style={{
              padding: "8px 20px",
              fontSize: 13,
              borderColor: "var(--red-live, #ff4d4d)",
              color: armed && !busy ? "var(--red-live, #ff4d4d)" : undefined,
            }}
          >
            {busy ? t("delete.pending") : t("delete.confirm")}
          </button>
        </div>
      </form>
    </TournamentDialogFrame>
  );
}
