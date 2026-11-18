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
  syncModeBatchNote,
  syncModeOtherKey,
  syncModeTextKey,
  syncModeTierNote,
  type SyncMode,
  type SyncModeInput,
  type SyncModeOtherKey,
  type SyncModeTextKey,
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

/**
 * Clés des textes, écrites en toutes lettres : le compilateur vérifie que
 * chacune existe (`TournamentPageKey`). Chaque mode a son texte `now` / `other` ;
 * les variantes n'existent que là où `syncModeTextKey` / `syncModeOtherKey` les
 * choisissent (`sync-mode-badge.test.tsx` balaie toutes les combinaisons).
 */
type ModeKeys<K extends string> = { [M in SyncMode]: Partial<Record<K, TournamentPageKey>> };

export const SYNC_MODE_NOW_KEYS = {
  PRIORITY: { now: "live.sync.modes.PRIORITY.now" },
  STANDARD: { now: "live.sync.modes.STANDARD.now", nowPoll: "live.sync.modes.STANDARD.nowPoll" },
  MATCH: {
    now: "live.sync.modes.MATCH.now",
    nowElsewhere: "live.sync.modes.MATCH.nowElsewhere",
  },
  ECO: { now: "live.sync.modes.ECO.now" },
  SLEEP: { now: "live.sync.modes.SLEEP.now", nowPoll: "live.sync.modes.SLEEP.nowPoll" },
  POLLING: { now: "live.sync.modes.POLLING.now" },
} as const satisfies ModeKeys<SyncModeTextKey>;

export const SYNC_MODE_OTHER_KEYS = {
  PRIORITY: { other: "live.sync.modes.PRIORITY.other" },
  STANDARD: { other: "live.sync.modes.STANDARD.other", otherPoll: "live.sync.modes.STANDARD.otherPoll" },
  MATCH: { other: "live.sync.modes.MATCH.other" },
  ECO: { other: "live.sync.modes.ECO.other" },
  SLEEP: { other: "live.sync.modes.SLEEP.other", otherPoll: "live.sync.modes.SLEEP.otherPoll" },
  POLLING: { other: "live.sync.modes.POLLING.other" },
} as const satisfies ModeKeys<SyncModeOtherKey>;

/** Clé du texte « mode courant » ; le texte `now` du mode si la variante manquait. */
export function syncModeNowTextKey(mode: SyncMode, variant: SyncModeTextKey): TournamentPageKey {
  const keys: Partial<Record<SyncModeTextKey, TournamentPageKey>> = SYNC_MODE_NOW_KEYS[mode];
  return keys[variant] ?? SYNC_MODE_NOW_KEYS[mode].now;
}

/** Clé du texte d'un autre mode, dans la liste de l'aide. */
export function syncModeOtherTextKey(mode: SyncMode, variant: SyncModeOtherKey): TournamentPageKey {
  const keys: Partial<Record<SyncModeOtherKey, TournamentPageKey>> = SYNC_MODE_OTHER_KEYS[mode];
  return keys[variant] ?? SYNC_MODE_OTHER_KEYS[mode].other;
}

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
  const now = t(syncModeNowTextKey(mode, syncModeTextKey(mode, input)), values);
  const otherValues = { ...values, cadence: cadenceLabel(text, REFRESH_CADENCE.PRIORITY.pushCoalesceMs) };
  return (
    <>
      <p>
        {now}
        {syncModeBatchNote(mode, input.source) && ` ${t("live.sync.matchBatched", values)}`}
        {kept !== null && " "}
        {kept !== null && t(`live.sync.tierKept.${kept}`)}
      </p>
      <p>{t("live.sync.others")}</p>
      <ul>
        {otherSyncModes(mode, input).map((other) => (
          <li key={other}>
            <strong>{t(`live.sync.modes.${other}.label`)}</strong> —{" "}
            {t(syncModeOtherTextKey(other, syncModeOtherKey(other, input.source)), otherValues)}
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
