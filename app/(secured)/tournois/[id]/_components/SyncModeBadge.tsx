"use client";

import { Pill, type PillVariant } from "@/components/cyber/Pill";
import { InfoHint } from "@/components/ui/info-hint";
import { useSpectatorView } from "@/components/spectator-view";
import { useClientPower } from "@/lib/shared/hooks/useClientPower";
import { MATCH_BACKGROUND_RENDER_DELAY_MS, QUIET_STREAM_AFTER_MS } from "@/lib/shared/client-power";
import { REFRESH_CADENCE } from "@/lib/shared/refresh-tiers";
import {
  otherSyncModes,
  resolveSyncMode,
  syncModeOtherKey,
  syncModeTextKey,
  syncModeTierNote,
  type SyncMode,
  type SyncModeInput,
} from "@/lib/shared/sync-mode";
import { useTournamentPageText } from "@/components/i18n/tournament-page-text";
import type { TournamentPageKey } from "@/lib/shared/tournament-page-text";
import { cadenceLabel, type LiveIndicatorProps } from "./LiveIndicator";

/**
 * Variante sémantique par mode. Jamais le rouge (`pill-live`, réservé à ce qui
 * est à l'antenne) ; l'ambre seulement pour le mode dégradé (flux coupé).
 */
const SYNC_MODE_VARIANT: Record<SyncMode, PillVariant> = {
  PRIORITY: "blue",
  STANDARD: "info",
  MATCH: "accent",
  ECO: "success",
  SLEEP: "neutral",
  POLLING: "warning",
};

export type SyncModeProps = LiveIndicatorProps & {
  /**
   * Le lecteur a une rencontre en cours ou imminente dans ce tournoi
   * (`useTournamentLive`). Absent : page sans compte, jamais.
   */
  viewerMatch?: boolean;
};

/** Ce que le mode courant a besoin de savoir, lu à la source. */
export type SyncModeState = { mode: SyncMode; input: SyncModeInput };

/**
 * Mode de synchronisation du lecteur, lu à la source : palier du flux, régime
 * de charge (`useClientPower`), état du flux, page avec ou sans compte. Seuls
 * les composants qui l'appellent se redessinent à un alt-tab, jamais la fiche
 * entière.
 */
export function useSyncMode({ isLive, tier, fatal = null, viewerMatch = false }: Readonly<SyncModeProps>): SyncModeState | null {
  const power = useClientPower().mode;
  const spectator = useSpectatorView();
  const input: SyncModeInput = {
    tier,
    power,
    isLive,
    fatal: fatal !== null,
    source: spectator ? "POLL" : "STREAM",
    viewerMatch,
  };
  const mode = resolveSyncMode(input);
  return mode === null ? null : { mode, input };
}

/**
 * Pastille du mode de synchronisation. Distincte du témoin de flux
 * (`LiveIndicator` : « À jour » / « Reconnexion… » / « Hors ligne »), qui dit si
 * la connexion tient ; celle-ci dit **comment** la page se tient à jour. Pas
 * de `aria-live` : le mode bascule à chaque alt-tab, ce serait du bruit. Le
 * texte porte le sens, la couleur ne fait que l'accompagner.
 */
export function SyncModeBadge(props: Readonly<SyncModeProps>) {
  const state = useSyncMode(props);
  const { t } = useTournamentPageText();
  if (state === null) return null;
  const { mode } = state;
  return (
    <Pill variant={SYNC_MODE_VARIANT[mode]} data-sync-mode={mode.toLowerCase()}>
      {t(`live.sync.modes.${mode}.label`)}
    </Pill>
  );
}

/**
 * Explication du mode courant (avec sa cadence, et le palier conservé sous un
 * régime de peinture) puis, en liste, des autres modes que ce lecteur peut
 * rencontrer sur cette page. Les durées viennent des constantes qui les
 * décident, jamais écrites dans le texte.
 */
export function SyncModeExplanation({ state, cadenceMs }: Readonly<{ state: SyncModeState; cadenceMs?: number | null }>) {
  const text = useTournamentPageText();
  const { t } = text;
  const { mode, input } = state;
  const base = mode === "POLLING" ? REFRESH_CADENCE[input.tier].detailFallbackMs : REFRESH_CADENCE[input.tier].pushCoalesceMs;
  const values = {
    cadence: cadenceLabel(text, cadenceMs ?? base),
    delay: cadenceLabel(text, MATCH_BACKGROUND_RENDER_DELAY_MS),
    minutes: Math.round(QUIET_STREAM_AFTER_MS / 60_000),
  };
  const kept = syncModeTierNote(mode, input);
  const now = t(`live.sync.modes.${mode}.${syncModeTextKey(mode, input)}` as TournamentPageKey, values);
  const otherValues = { ...values, cadence: cadenceLabel(text, REFRESH_CADENCE.PRIORITY.pushCoalesceMs) };
  return (
    <>
      <p>
        {now}
        {kept !== null && " "}
        {kept !== null && t(`live.sync.tierKept.${kept}`)}
      </p>
      <p>{t("live.sync.others")}</p>
      <ul>
        {otherSyncModes(mode, input).map((other) => (
          <li key={other}>
            <strong>{t(`live.sync.modes.${other}.label`)}</strong> —{" "}
            {t(`live.sync.modes.${other}.${syncModeOtherKey(other, input.source)}` as TournamentPageKey, otherValues)}
          </li>
        ))}
      </ul>
    </>
  );
}

/** Le « i » de la pastille, pour la page avec compte (la page sans compte a le sien, `SpectatorHint`). */
export function SyncModeHint(props: Readonly<SyncModeProps>) {
  const state = useSyncMode(props);
  const { t } = useTournamentPageText();
  if (state === null) return null;
  return (
    <InfoHint id="tournament-sync-hint" subject={t("live.sync.title")}>
      <SyncModeExplanation state={state} cadenceMs={props.cadenceMs} />
    </InfoHint>
  );
}
