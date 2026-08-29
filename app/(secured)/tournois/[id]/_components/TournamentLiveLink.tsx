"use client";

import { FormEvent, useState } from "react";
import { CyberButton } from "@/components/cyber";
import { useToast } from "@/components/ui/toast";
import {
  isValidStreamUrl,
  LIVE_PLATFORMS,
  MAX_STREAM_URL_LENGTH,
  PLATFORM_LABELS,
  streamPlatform,
} from "@/lib/shared/live-streams";
import { mapError } from "../_lib/error-map";

interface TournamentLiveLinkProps {
  tournamentId: number;
  liveUrl: string | null;
  /** Permission `tournaments` : la chaîne officielle engage l'organisation. */
  canEdit: boolean;
  onSaved: () => void;
}

/**
 * Chaîne officielle du tournoi, en tête de page.
 *
 * Elle est affichée dès qu'elle est renseignée, indépendamment de l'état des
 * matchs : c'est l'antenne permanente de l'organisation. Ce sont les matchs, et
 * eux seuls, qui portent un état « en direct » (`lib/shared/live-streams.ts`).
 */
export function TournamentLiveLink({
  tournamentId,
  liveUrl,
  canEdit,
  onSaved,
}: TournamentLiveLinkProps) {
  const { showError, showSuccess } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(liveUrl ?? "");
  const [busy, setBusy] = useState(false);

  /**
   * Ouvre l'éditeur sur la valeur **courante**.
   *
   * Le brouillon ne peut pas se contenter de son initialisation au montage : la
   * page se recharge par SSE, et un lien changé entre-temps par un autre membre
   * du staff — ou simplement normalisé par le serveur après notre propre
   * enregistrement — laisserait un brouillon périmé prêt à réécraser la valeur
   * en base au prochain envoi.
   */
  const openEditor = () => {
    setDraft(liveUrl ?? "");
    setEditing(true);
  };

  const platform = streamPlatform(liveUrl);
  const draftTouched = draft.trim().length > 0;
  const draftInvalid = draftTouched && !isValidStreamUrl(draft);

  if (!liveUrl && !canEdit) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (draftInvalid) return;

    setBusy(true);
    try {
      const response = await fetch(`/api/admin/tournaments/${tournamentId}/live`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ liveUrl: draft.trim() || null }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "TOURNAMENT_LIVE_UPDATE_FAILED");
      showSuccess(draft.trim() ? "Chaîne officielle enregistrée." : "Chaîne officielle retirée.");
      setEditing(false);
      onSaved();
    } catch (error) {
      showError(mapError((error as Error).message));
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <form
        onSubmit={submit}
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "flex-start",
          marginTop: 14,
        }}
      >
        <div style={{ minWidth: 240, flex: "1 1 240px" }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={MAX_STREAM_URL_LENGTH}
            placeholder="https://twitch.tv/…"
            aria-label="Chaîne officielle du tournoi"
            aria-invalid={draftInvalid}
            aria-describedby="tournament-live-hint"
            autoFocus
            style={{ width: "100%" }}
          />
          <p
            id="tournament-live-hint"
            style={{
              margin: "6px 0 0",
              fontSize: 12,
              color: draftInvalid ? "rgba(255,74,92,0.95)" : "var(--text-2, #9aa4b2)",
            }}
          >
            {draftInvalid
              ? `Lien non reconnu. Plateformes acceptées : ${LIVE_PLATFORMS.join(", ")}.`
              : `Vider le champ retire la chaîne. Plateformes acceptées : ${LIVE_PLATFORMS.join(", ")}.`}
          </p>
        </div>
        <button
          type="submit"
          className="btn"
          disabled={busy || draftInvalid}
          style={{ padding: "6px 14px", fontSize: 13 }}
        >
          {busy ? "…" : "Enregistrer"}
        </button>
        <button
          type="button"
          className="btn ghost"
          disabled={busy}
          onClick={() => {
            setDraft(liveUrl ?? "");
            setEditing(false);
          }}
          style={{ padding: "6px 14px", fontSize: 13 }}
        >
          Annuler
        </button>
      </form>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        flexWrap: "wrap",
        marginTop: 14,
      }}
    >
      {liveUrl && (
        <CyberButton variant="ghost" asChild>
          <a
            href={liveUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 13, padding: "6px 16px" }}
          >
            <span aria-hidden="true">▶</span>
            {platform ? `Chaîne officielle · ${PLATFORM_LABELS[platform]}` : "Chaîne officielle"}
          </a>
        </CyberButton>
      )}
      {canEdit && (
        <button
          type="button"
          className="btn ghost"
          onClick={openEditor}
          style={{ padding: "6px 14px", fontSize: 12 }}
        >
          {liveUrl ? "⚙ Modifier la chaîne" : "＋ Chaîne officielle"}
        </button>
      )}
    </div>
  );
}
