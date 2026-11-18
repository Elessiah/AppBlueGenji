"use client";

import { Pill, type PillVariant } from "@/components/cyber/Pill";
import { InfoHint } from "@/components/ui/info-hint";
import { useClientPower } from "@/lib/shared/hooks/useClientPower";
import { REFRESH_CADENCE } from "@/lib/shared/refresh-tiers";
import { otherSyncModes, resolveSyncMode, type SyncMode } from "@/lib/shared/sync-mode";
import { useTournamentPageText } from "@/components/i18n/tournament-page-text";
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
 * Mode de synchronisation du lecteur, lu à la source : palier du flux, régime
 * de charge (`useClientPower`), état du flux. Seuls les composants qui
 * l'appellent se redessinent à un alt-tab, jamais la fiche entière.
 */
export function useSyncMode({ isLive, tier, fatal = null }: Readonly<LiveIndicatorProps>): SyncMode | null {
  const power = useClientPower().mode;
  return resolveSyncMode({ tier, power, isLive, fatal: fatal !== null });
}

/**
 * Pastille du mode de synchronisation. Distincte du témoin de flux
 * (`LiveIndicator` : « À jour » / « Reconnexion… » / « Hors ligne »), qui dit si
 * la connexion tient ; celle-ci dit **comment** la page se tient à jour. Pas
 * de `aria-live` : le mode bascule à chaque alt-tab, ce serait du bruit. Le
 * texte porte le sens, la couleur ne fait que l'accompagner.
 */
export function SyncModeBadge(props: Readonly<LiveIndicatorProps>) {
  const mode = useSyncMode(props);
  const { t } = useTournamentPageText();
  if (mode === null) return null;
  return (
    <Pill variant={SYNC_MODE_VARIANT[mode]} data-sync-mode={mode.toLowerCase()}>
      {t(`live.sync.modes.${mode}.label`)}
    </Pill>
  );
}

/** Explication du mode courant puis, en liste, des autres. Rien après un échec définitif. */
export function SyncModeExplanation(props: Readonly<LiveIndicatorProps>) {
  const mode = useSyncMode(props);
  const text = useTournamentPageText();
  if (mode === null) return null;
  const { t } = text;
  const { tier, cadenceMs } = props;
  const base = mode === "POLLING" ? REFRESH_CADENCE[tier].detailFallbackMs : REFRESH_CADENCE[tier].pushCoalesceMs;
  const cadence = cadenceLabel(text, cadenceMs ?? base);
  return (
    <>
      <p>{t(`live.sync.modes.${mode}.now`, { cadence })}</p>
      <p>{t("live.sync.others")}</p>
      <ul>
        {otherSyncModes(mode).map((other) => (
          <li key={other}>
            <strong>{t(`live.sync.modes.${other}.label`)}</strong> — {t(`live.sync.modes.${other}.other`)}
          </li>
        ))}
      </ul>
    </>
  );
}

/** Le « i » de la pastille, pour la page avec compte (la page sans compte a le sien, `SpectatorHint`). */
export function SyncModeHint(props: Readonly<LiveIndicatorProps>) {
  const mode = useSyncMode(props);
  const { t } = useTournamentPageText();
  if (mode === null) return null;
  return (
    <InfoHint id="tournament-sync-hint" subject={t("live.sync.title")}>
      <SyncModeExplanation {...props} />
    </InfoHint>
  );
}
