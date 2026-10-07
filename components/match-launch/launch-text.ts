import frLaunchModal from "@/messages/fr/launchModal.json";
import enLaunchModal from "@/messages/en/launchModal.json";
import { useShellText } from "@/components/i18n/shell-text";
import { scopedText, type Leaves, type ScopedText } from "@/lib/shared/scoped-text";

/**
 * Textes de la fenêtre de lancement d'un match (espace `launchModal`).
 *
 * La fenêtre est montée par la mise en page racine pour tout compte connecté,
 * mais chargée à la demande (`MatchLaunchCenterLazy`) : ses **deux** langues
 * voyagent avec son morceau, importées ici. Rangées dans la coquille, elles
 * pesaient sur le premier chargement de **chaque** page (français dans le
 * paquet, anglais sérialisé sous `/en`), visiteur anonyme compris.
 */
export type LaunchMessages = typeof frLaunchModal;
export type LaunchKey = Leaves<LaunchMessages>;
export type LaunchText = ScopedText<LaunchKey>;

export const FR_LAUNCH_TEXT: LaunchText = scopedText("fr", frLaunchModal);
const EN_LAUNCH_TEXT: LaunchText = scopedText("en", enLaunchModal);

/** Textes de la fenêtre, dans la langue de la page (celle de la coquille). */
export function useLaunchText(): LaunchText {
  return useShellText().locale === "en" ? EN_LAUNCH_TEXT : FR_LAUNCH_TEXT;
}
