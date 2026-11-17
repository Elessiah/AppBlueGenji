"use client";

import { FormEvent, useState } from "react";
import { CyberButton } from "@/components/cyber";
import { useToast } from "@/components/ui/toast";
import { BusyButton } from "@/components/ui/busy-button";
import { BusyLabel } from "@/components/ui/busy-label";
import { useBusyGuard } from "@/lib/shared/hooks/useBusyGuard";
import { focusOnMount } from "@/lib/shared/focus-on-mount";
import {
  isValidStreamUrl,
  LIVE_PLATFORMS,
  MAX_STREAM_URL_LENGTH,
  PLATFORM_LABELS,
  streamPlatform,
} from "@/lib/shared/live-streams";
import { useMapError } from "../_lib/error-map";
import { useActionsText } from "../_lib/actions-text";
import { useTournamentPageText } from "@/components/i18n/tournament-page-text";

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
}: Readonly<TournamentLiveLinkProps>) {
  const { showError, showSuccess } = useToast();
  const text = useTournamentPageText();
  // L'éditeur de la chaîne, outil du staff posé sur la fiche (lot 8b).
  const { t: a } = useActionsText();
  const mapError = useMapError();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(liveUrl ?? "");
  // Boutons focalisables pendant l'envoi (`BusyButton`), garde synchrone
  // (Entrée répétée dans le champ) : `docs/features/BUSY_BUTTONS.md`.
  const { busy, isBusy, run } = useBusyGuard();

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

    await run(async () => {
      try {
        const response = await fetch(`/api/admin/tournaments/${tournamentId}/live`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ liveUrl: draft.trim() || null }),
        });
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(payload.error || "TOURNAMENT_LIVE_UPDATE_FAILED");
        showSuccess(draft.trim() ? a("liveLink.saved") : a("liveLink.removed"));
        setEditing(false);
        onSaved();
      } catch (error) {
        showError(mapError((error as Error).message));
      }
    });
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
          // Prend toute la rangée d'actions de l'en-tête : un champ d'URL
          // coincé entre deux boutons n'est plus saisissable.
          flex: "1 1 100%",
        }}
      >
        <div style={{ minWidth: 240, flex: "1 1 240px" }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            // Entrée y lance l'envoi : en lecture seule (pas `disabled`), le
            // champ garde le focus et le lien affiché est celui qui part.
            readOnly={busy}
            maxLength={MAX_STREAM_URL_LENGTH}
            placeholder="https://twitch.tv/…"
            aria-label={a("liveLink.inputAria")}
            aria-invalid={draftInvalid}
            aria-describedby="tournament-live-hint"
            ref={focusOnMount}
            style={{ width: "100%" }}
          />
          <p
            id="tournament-live-hint"
            style={{
              margin: "6px 0 0",
              fontSize: 12,
              color: draftInvalid ? "rgba(255,74,92,0.95)" : "var(--ink-quiet, #9aa4b2)",
            }}
          >
            {draftInvalid
              ? a("liveLink.invalid", { platforms: LIVE_PLATFORMS.join(", ") })
              : a("liveLink.hint", { platforms: LIVE_PLATFORMS.join(", ") })}
          </p>
        </div>
        <BusyButton
          busy={busy}
          blocked={draftInvalid}
          type="submit"
          className="btn"
          style={{ padding: "6px 14px", fontSize: 13 }}
        >
          <BusyLabel busy={busy} idle={a("common.save")} pending={`${a("common.save")}…`} />
        </BusyButton>
        <BusyButton
          busy={busy}
          className="btn ghost"
          onClick={() => {
            if (isBusy()) return;
            setDraft(liveUrl ?? "");
            setEditing(false);
          }}
          style={{ padding: "6px 14px", fontSize: 13 }}
        >
          {a("common.cancel")}
        </BusyButton>
      </form>
    );
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {liveUrl && (
        <CyberButton variant="ghost" asChild>
          <a
            href={liveUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 13, padding: "8px 18px" }}
          >
            <span aria-hidden="true">▶</span>
            {platform
              ? text.t("header.officialChannelOn", { platform: PLATFORM_LABELS[platform] })
              : text.t("header.officialChannel")}
          </a>
        </CyberButton>
      )}
      {canEdit && (
        <CyberButton
          variant="ghost"
          onClick={openEditor}
          style={{ fontSize: 13, padding: "8px 18px" }}
        >
          {liveUrl ? `⚙ ${a("liveLink.edit")}` : `＋ ${a("liveLink.add")}`}
        </CyberButton>
      )}
    </div>
  );
}
