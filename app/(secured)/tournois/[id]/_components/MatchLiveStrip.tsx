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
import type { MatchLaunchPhase } from "@/lib/shared/match-launch";
import { formatMatchStartAt, formatMatchStartAtFull } from "@/lib/shared/match-schedule";
import type { BracketMatch } from "@/lib/shared/types";
import { useLiveControls } from "../_lib/live-context";
import { mapError } from "../_lib/error-map";

const BORDER = "var(--border, #444)";

type LiveState = ReturnType<typeof useMatchLiveState>;

/** Fond du bandeau : rouge à l'antenne, bleu glacier pour un direct annoncé. */
function stripBackground(state: LiveState): string | undefined {
  if (state === "LIVE") return "rgba(255,74,92,0.1)";
  if (state === "SCHEDULED") return "rgba(89,212,255,0.06)";
  return undefined;
}

/** Horaire annoncé, à chiffres à chasse fixe pour que la colonne s'aligne. */
function StartAtFact({ startAt }: Readonly<{ startAt: BracketMatch["startAt"] }>) {
  const label = formatMatchStartAt(startAt);
  if (label === null) return null;
  return (
    <span
      title={formatMatchStartAtFull(startAt) ?? undefined}
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
      <span className="num">{label}</span>
    </span>
  );
}

/** État de diffusion (programmé / en direct) et lien vers la chaîne. */
function LiveStateFact({
  state,
  liveUrl,
  matchLabel,
}: Readonly<{ state: LiveState; liveUrl: string | null; matchLabel: string }>) {
  if (state === "OFF") return null;
  const platform = streamPlatform(liveUrl);
  const live = state === "LIVE";
  const where = platform ? ` sur ${PLATFORM_LABELS[platform]}` : "";
  return (
    <>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: live ? "var(--red-live, #ff4a5c)" : "rgba(89,212,255,0.9)",
        }}
      >
        <span aria-hidden="true">{live ? "●" : "○"}</span>
        {live ? "En direct" : "Programmé"}
      </span>
      {liveUrl && (
        <a
          href={liveUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Regarder ${matchLabel}${where} (nouvel onglet)`}
          style={{ color: "var(--accent-blue, #59d4ff)", textDecoration: "underline" }}
        >
          {platform ? PLATFORM_LABELS[platform] : "Chaîne"}
        </a>
      )}
    </>
  );
}

const SMALL_BUTTON = { whiteSpace: "nowrap", padding: "2px 8px", fontSize: 11 } as const;

/** Bouton d'antenne (mode `MANUAL`) : ouvre ou coupe le direct. */
function OnAirToggle({ match, state, matchLabel }: Readonly<{ match: BracketMatch; state: LiveState; matchLabel: string }>) {
  const { showError, showSuccess } = useToast();
  const [busy, setBusy] = useState(false);
  const live = state === "LIVE";

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

  let label = live ? "■ Couper" : "▶ Antenne";
  if (busy) label = "…";
  return (
    <button
      type="button"
      className="btn tap-target"
      disabled={busy}
      onClick={() => void toggleOnAir(!live)}
      aria-label={live ? `Couper le direct de ${matchLabel}` : `Lancer le direct de ${matchLabel}`}
      style={{
        padding: "2px 8px",
        fontSize: 11,
        background: live ? "rgba(255,74,92,0.16)" : "rgba(79,224,162,0.14)",
        borderColor: live ? "rgba(255,74,92,0.45)" : "rgba(79,224,162,0.4)",
      }}
    >
      {label}
    </button>
  );
}

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
export function MatchLiveStrip({
  match,
  launchPhase,
}: Readonly<{
  match: BracketMatch;
  /** Phase de lancement, calculée par la carte (`MatchRow`). */
  launchPhase: MatchLaunchPhase;
}>) {
  const { canManage, canSchedule, openConfig, openSchedule } = useLiveControls();

  // État recalculé à l'horaire du match en mode `START_TIME` : le flux ne peut
  // pas pousser une bascule que seule l'horloge provoque.
  const state = useMatchLiveState(match);
  const hasStartAt = formatMatchStartAt(match.startAt) !== null;
  // Impasse à signaler à ceux qui peuvent la défaire : casté « à la date de
  // début », mais sans date, le match ne passera jamais à l'antenne.
  //
  // Borné aux matchs encore castables : sur un match déjà noté, le bandeau reste
  // ouvert pour qu'on puisse effacer une diffusion posée par erreur, mais
  // l'horaire n'y est plus pour rien — le direct est terminé, pas en attente.
  const missingStartAt =
    requiresMatchStartAt(match.liveTrigger) &&
    !hasStartAt &&
    isMatchCastable(match) &&
    (canManage || canSchedule);
  const showToggle = canManage && canToggleOnAir(match);
  // Un match **à planifier** porte déjà son bouton « Planifier », mis en avant
  // dans le bandeau de lancement : « ＋ Date » en serait le doublon, sur une
  // carte de 210 px. Il revient dès que la date est posée (« 🗓 Date »).
  const showScheduleButton = canSchedule && launchPhase !== "TO_PLAN";
  // Les libellés visibles sont ultra-courts (la carte fait 210 px) : sortis de
  // leur contexte visuel, « ⚙ Live » ou « Twitch » ne disent pas de quel match
  // il s'agit. Chaque contrôle porte donc le nom du match.
  const matchLabel = `${match.team1Name ?? "TBD"} contre ${match.team2Name ?? "TBD"}`;

  // Un bye, un match fantôme ou un match déjà noté dérivera `OFF` quoi qu'on
  // configure : la règle vit dans le module pur, partagée et testée seule.
  const showConfig = canManage && canConfigureLive(match);
  const configured = match.liveTrigger !== null;

  // Rien à montrer : ni horaire, ni état de diffusion, ni contrôle à offrir.
  if (state === "OFF" && !showConfig && !showScheduleButton && !hasStartAt) return null;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 6,
        padding: "5px 6px",
        borderTop: `1px solid ${BORDER}`,
        background: stripBackground(state),
        fontSize: 11,
      }}
    >
      <StartAtFact startAt={match.startAt} />

      {missingStartAt && (
        <span
          title="Ce match passe à l'antenne à sa date de début, mais aucune date n'est fixée."
          style={{ color: "rgba(255,157,46,0.95)", whiteSpace: "nowrap" }}
        >
          <span aria-hidden="true">⚠</span>
          <span className="sr-only">Attention : </span> sans date
        </span>
      )}

      <LiveStateFact state={state} liveUrl={match.liveUrl} matchLabel={matchLabel} />

      {/* Les contrôles se regroupent à droite derrière un unique `marginLeft`.
          Les répartir bouton par bouton obligeait chacun à savoir lesquels de
          ses voisins étaient rendus — trois conditions à retenir d'accord entre
          elles pour un seul effet visuel. */}
      {(showToggle || showScheduleButton || showConfig) && (
        <span
          style={{
            display: "inline-flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 6,
            marginLeft: "auto",
          }}
        >
          {showToggle && <OnAirToggle match={match} state={state} matchLabel={matchLabel} />}

          {showScheduleButton && (
            <button
              type="button"
              className="btn ghost tap-target"
              onClick={() => openSchedule(match)}
              aria-label={hasStartAt ? `Modifier la date de début de ${matchLabel}` : `Programmer ${matchLabel}`}
              style={SMALL_BUTTON}
            >
              {hasStartAt ? "🗓 Date" : "＋ Date"}
            </button>
          )}

          {showConfig && (
            <button
              type="button"
              className="btn ghost tap-target"
              onClick={() => openConfig(match)}
              // « Diffuser » et non « Caster » : s'inscrire comme caster est un
              // autre geste, celui du bandeau de lancement (`MatchLaunchStrip`).
              aria-label={configured ? `Configurer la diffusion de ${matchLabel}` : `Diffuser ${matchLabel}`}
              style={SMALL_BUTTON}
            >
              {configured ? "⚙ Live" : "＋ Live"}
            </button>
          )}
        </span>
      )}
    </div>
  );
}
