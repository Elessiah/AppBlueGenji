"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import {
  canConfigureLive,
  canToggleOnAir,
  isMatchCastable,
  PLATFORM_LABELS,
  requiresMatchStartAt,
  streamPlatform,
} from "@/lib/shared/live-streams";
import { useMatchLiveState } from "@/lib/shared/hooks/useMatchLiveState";
import { formatMatchStartAt, formatMatchStartAtFull } from "@/lib/shared/match-schedule";
import type { BracketMatch } from "@/lib/shared/types";
import { useLiveControls } from "../_lib/live-context";
import { mapError } from "../_lib/error-map";

const BORDER = "var(--border, #444)";

/**
 * Bandeau d'horaire et de diffusion d'un match, sous la feuille de score.
 *
 * Les deux vivent ensemble parce qu'ils se répondent : la date de début annonce
 * la manche, et c'est elle qui ouvre l'antenne des matchs castés en mode
 * `START_TIME`. Les séparer en deux bandeaux ajouterait une ligne à une carte
 * de 210 px pour montrer deux moitiés de la même information.
 *
 * Trois publics dans un même bloc, du plus large au plus restreint : tout le
 * monde voit l'horaire, l'état (annoncé / en direct) et le lien s'il existe ; la
 * permission `live` y ajoute le bouton d'antenne (mode `MANUAL` seulement) et
 * l'accès à la configuration ; la permission `tournaments` y ajoute l'édition de
 * l'horaire.
 */
export function MatchLiveStrip({ match }: { match: BracketMatch }) {
  const { canManage, canSchedule, openConfig, openSchedule } = useLiveControls();
  const { showError, showSuccess } = useToast();
  const [busy, setBusy] = useState(false);

  // État recalculé à l'horaire du match en mode `START_TIME` : le flux ne peut
  // pas pousser une bascule que seule l'horloge provoque.
  const state = useMatchLiveState(match);
  const platform = streamPlatform(match.liveUrl);
  const startAtLabel = formatMatchStartAt(match.startAt);
  const startAtTitle = formatMatchStartAtFull(match.startAt);
  // Impasse à signaler à ceux qui peuvent la défaire : casté « à la date de
  // début », mais sans date, le match ne passera jamais à l'antenne.
  //
  // Borné aux matchs encore castables : sur un match déjà noté, le bandeau reste
  // ouvert pour qu'on puisse effacer une diffusion posée par erreur, mais
  // l'horaire n'y est plus pour rien — le direct est terminé, pas en attente.
  const missingStartAt =
    requiresMatchStartAt(match.liveTrigger) &&
    startAtLabel === null &&
    isMatchCastable(match) &&
    (canManage || canSchedule);
  const showToggle = canManage && canToggleOnAir(match);
  // Les libellés visibles sont ultra-courts (la carte fait 210 px) : sortis de
  // leur contexte visuel, « ⚙ Live » ou « Twitch » ne disent pas de quel match
  // il s'agit. Chaque contrôle porte donc le nom du match.
  const matchLabel = `${match.team1Name ?? "TBD"} contre ${match.team2Name ?? "TBD"}`;

  // Un bye, un match fantôme ou un match déjà noté dérivera `OFF` quoi qu'on
  // configure : la règle vit dans le module pur, partagée et testée seule.
  const showConfig = canManage && canConfigureLive(match);

  // Rien à montrer : ni horaire, ni état de diffusion, ni contrôle à offrir.
  if (state === "OFF" && !showConfig && !canSchedule && startAtLabel === null) return null;

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
      {startAtLabel && (
        <span
          title={startAtTitle ?? undefined}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            color: "var(--text-2, #9aa4b2)",
            whiteSpace: "nowrap",
          }}
        >
          <span aria-hidden="true">🕑</span>
          <span className="sr-only">Début programmé : </span>
          {/* Chiffres à chasse fixe : les horaires d'une même colonne
              s'alignent, et la carte ne se réajuste pas à chaque minute. */}
          <span className="num">{startAtLabel}</span>
        </span>
      )}

      {missingStartAt && (
        <span
          title="Ce match passe à l'antenne à sa date de début, mais aucune date n'est fixée."
          style={{ color: "rgba(255,157,46,0.95)", whiteSpace: "nowrap" }}
        >
          <span aria-hidden="true">⚠</span>
          <span className="sr-only">Attention : </span> sans date
        </span>
      )}

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
          aria-label={`Regarder ${matchLabel}${
            platform ? ` sur ${PLATFORM_LABELS[platform]}` : ""
          } (nouvel onglet)`}
          style={{ color: "var(--accent-blue, #59d4ff)", textDecoration: "underline" }}
        >
          {platform ? PLATFORM_LABELS[platform] : "Chaîne"}
        </a>
      )}

      {/* Les contrôles se regroupent à droite derrière un unique `marginLeft`.
          Les répartir bouton par bouton obligeait chacun à savoir lesquels de
          ses voisins étaient rendus — trois conditions à retenir d'accord entre
          elles pour un seul effet visuel. */}
      {(showToggle || canSchedule || showConfig) && (
        <span
          style={{
            display: "inline-flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 6,
            marginLeft: "auto",
          }}
        >
        {showToggle && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void toggleOnAir(state !== "LIVE")}
            aria-label={
              state === "LIVE"
                ? `Couper le direct de ${matchLabel}`
                : `Lancer le direct de ${matchLabel}`
            }
            style={{
              padding: "2px 8px",
              fontSize: 11,
              background: state === "LIVE" ? "rgba(255,74,92,0.16)" : "rgba(79,224,162,0.14)",
              borderColor: state === "LIVE" ? "rgba(255,74,92,0.45)" : "rgba(79,224,162,0.4)",
            }}
          >
            {busy ? "…" : state === "LIVE" ? "■ Couper" : "▶ Antenne"}
          </button>
        )}

        {canSchedule && (
          <button
            type="button"
            className="btn ghost"
            onClick={() => openSchedule(match)}
            aria-label={
              startAtLabel === null
                ? `Programmer ${matchLabel}`
                : `Modifier la date de début de ${matchLabel}`
            }
            style={{ whiteSpace: "nowrap", padding: "2px 8px", fontSize: 11 }}
          >
            {startAtLabel === null ? "＋ Date" : "🗓 Date"}
          </button>
        )}

        {showConfig && (
          <button
            type="button"
            className="btn ghost"
            onClick={() => openConfig(match)}
            aria-label={
              match.liveTrigger === null
                ? `Caster ${matchLabel}`
                : `Configurer la diffusion de ${matchLabel}`
            }
            style={{ whiteSpace: "nowrap", padding: "2px 8px", fontSize: 11 }}
          >
            {match.liveTrigger === null ? "＋ Caster" : "⚙ Live"}
          </button>
        )}
        </span>
      )}
    </div>
  );
}
