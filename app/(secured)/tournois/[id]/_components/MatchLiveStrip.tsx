"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import {
  canToggleOnAir,
  PLATFORM_LABELS,
  resolveMatchLiveState,
  streamPlatform,
} from "@/lib/shared/live-streams";
import type { BracketMatch } from "@/lib/shared/types";
import { useLiveControls } from "../_lib/live-context";
import { mapError } from "../_lib/error-map";

const BORDER = "var(--border, #444)";

/**
 * Bandeau de diffusion d'un match, sous la feuille de score.
 *
 * Trois publics dans un même bloc, du plus large au plus restreint :
 * tout le monde voit l'état (annoncé / en direct) et le lien s'il existe ; la
 * permission `live` y ajoute le bouton d'antenne (mode `MANUAL` seulement) et
 * l'accès à la configuration.
 */
export function MatchLiveStrip({ match }: { match: BracketMatch }) {
  const { canManage, openConfig } = useLiveControls();
  const { showError, showSuccess } = useToast();
  const [busy, setBusy] = useState(false);

  const state = resolveMatchLiveState(match);
  const platform = streamPlatform(match.liveUrl);
  const showToggle = canManage && canToggleOnAir(match);

  // Rien à montrer : match non casté et viewer sans droit de diffusion.
  if (state === "OFF" && !canManage) return null;

  const toggleOnAir = async (onAir: boolean) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/matches/${match.id}/live`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ onAir }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "MATCH_LIVE_UPDATE_FAILED");
      showSuccess(onAir ? "Antenne ouverte." : "Antenne fermée.");
    } catch (error) {
      showError(mapError((error as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 6,
        padding: "5px 6px",
        borderTop: `1px solid ${BORDER}`,
        background:
          state === "LIVE"
            ? "rgba(255,74,92,0.1)"
            : state === "SCHEDULED"
              ? "rgba(89,212,255,0.06)"
              : undefined,
        fontSize: 11,
      }}
    >
      {state !== "OFF" && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: state === "LIVE" ? "var(--red-live, #ff4a5c)" : "rgba(89,212,255,0.9)",
          }}
        >
          <span aria-hidden="true">{state === "LIVE" ? "●" : "○"}</span>
          {state === "LIVE" ? "En direct" : "Programmé"}
        </span>
      )}

      {state !== "OFF" && match.liveUrl && (
        <a
          href={match.liveUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--accent-blue, #59d4ff)", textDecoration: "underline" }}
        >
          {platform ? PLATFORM_LABELS[platform] : "Chaîne"}
        </a>
      )}

      {showToggle && (
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void toggleOnAir(state !== "LIVE")}
          style={{
            marginLeft: "auto",
            padding: "2px 8px",
            fontSize: 11,
            background: state === "LIVE" ? "rgba(255,74,92,0.16)" : "rgba(79,224,162,0.14)",
            borderColor: state === "LIVE" ? "rgba(255,74,92,0.45)" : "rgba(79,224,162,0.4)",
          }}
        >
          {state === "LIVE" ? "■ Couper" : "▶ Antenne"}
        </button>
      )}

      {canManage && (
        <button
          type="button"
          className="btn ghost"
          onClick={() => openConfig(match)}
          style={{
            marginLeft: showToggle ? undefined : "auto",
            padding: "2px 8px",
            fontSize: 11,
          }}
        >
          {match.liveTrigger === null ? "＋ Caster" : "⚙ Live"}
        </button>
      )}
    </div>
  );
}
