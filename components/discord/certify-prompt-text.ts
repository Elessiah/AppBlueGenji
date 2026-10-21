import type frCertifyPrompt from "@/messages/fr/certifyPrompt.json";
import type { Leaves, ScopedText } from "@/lib/shared/scoped-text";

/**
 * Textes de la fenêtre « Certifier ton tag Discord ? » (espace `certifyPrompt`).
 *
 * Hors de la coquille : celle-ci voyage avec **chaque** page (français dans le
 * paquet, anglais sérialisé sous `/en`), visiteur anonyme compris, pour une
 * fenêtre qui ne s'ouvre qu'une fois par connexion. Chaque langue est chargée
 * avec la fenêtre, à part (`DiscordCertifyPromptLazy`) ; ce module n'en garde
 * que le type.
 */
export type CertifyPromptMessages = typeof frCertifyPrompt;
export type CertifyPromptKey = Leaves<CertifyPromptMessages>;
export type CertifyPromptText = ScopedText<CertifyPromptKey>;
