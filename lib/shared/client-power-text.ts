/**
 * Textes du témoin de charge (`ClientPowerBadge`) : libellés des régimes, causes
 * et sonde, passés par les textes de la coque (`shell.clientPower`). Séparés de
 * `client-power.ts`, que la mise en page racine, le fond et le flux importent
 * pour ses seules constantes et fonctions pures : ils n'embarquent pas le JSON
 * de la coque pour un libellé qu'ils n'affichent jamais.
 */
import {
  MATCH_BACKGROUND_RENDER_DELAY_MS,
  type ClientPowerMode,
  type PerformanceLimit,
  type PerformanceProbe,
  type PowerReason,
} from "./client-power";
import { shellText, type ShellTranslate } from "./shell-text";

/** Le français, hors fournisseur de textes (tests). */
const FRENCH: ShellTranslate = shellText("fr").t;

/** « Mode éco », « Eco mode »… (`shell.clientPower.modes`). */
export function powerModeLabel(mode: ClientPowerMode, t: ShellTranslate = FRENCH): string {
  return t(`clientPower.modes.${mode}.label`);
}

/** Ce que le régime retire, en une phrase lisible par un joueur. */
export function powerModeDescription(mode: ClientPowerMode, t: ShellTranslate = FRENCH): string {
  return t(`clientPower.modes.${mode}.description`, {
    seconds: String(Math.round(MATCH_BACKGROUND_RENDER_DELAY_MS / 1000)),
  });
}

/** Limites constatées en une liste, au séparateur de la langue (`clientPower.listSeparator`). */
export function powerLimitsList(
  limits: readonly PerformanceLimit[],
  probe: PerformanceProbe,
  t: ShellTranslate = FRENCH,
): string {
  return limits.map((limit) => powerReasonLabel(limit, probe, t)).join(t("clientPower.listSeparator"));
}

/** « 2 cœurs » / « 1 cœur » — accordé, comme partout où le nombre s'affiche. */
function coresLabel(cores: number | null, t: ShellTranslate): string {
  return cores === null ? t("clientPower.probe.coresUnknown") : t("clientPower.probe.cores", { count: cores });
}

/** Images par seconde d'un intervalle mesuré. */
function framesPerSecond(intervalMs: number): string {
  return String(Math.round(1000 / intervalMs));
}

/**
 * Ligne de mesures du témoin : cadence mesurée, cœurs et mémoire déclarés. Ce
 * que le navigateur ne dit pas n'est pas affiché (la cadence, seule mesurée,
 * dit qu'elle ne l'est pas encore).
 */
export function powerProbeSummary(probe: PerformanceProbe, t: ShellTranslate = FRENCH): string {
  return [
    probe.frameIntervalMs
      ? t("clientPower.probe.fps", { fps: framesPerSecond(probe.frameIntervalMs) })
      : t("clientPower.probe.fpsUnmeasured"),
    probe.cores ? coresLabel(probe.cores, t) : null,
    probe.memoryGb ? t("clientPower.probe.memory", { memory: String(probe.memoryGb) }) : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

export function powerReasonLabel(reason: PowerReason, probe: PerformanceProbe, t: ShellTranslate = FRENCH): string {
  switch (reason) {
    case "LOW_CORES":
      return t("clientPower.reasons.LOW_CORES", { cores: coresLabel(probe.cores, t) });
    case "LOW_MEMORY":
      return t("clientPower.reasons.LOW_MEMORY", { memory: probe.memoryGb === null ? "?" : String(probe.memoryGb) });
    case "SLOW_FRAMES":
      return probe.frameIntervalMs
        ? t("clientPower.reasons.SLOW_FRAMES", { fps: framesPerSecond(probe.frameIntervalMs) })
        : t("clientPower.reasons.SLOW_FRAMES_UNMEASURED");
    default:
      return t(`clientPower.reasons.${reason}`);
  }
}

