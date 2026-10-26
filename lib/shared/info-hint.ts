/**
 * Règles pures du bouton « i » (`components/ui/info-hint.tsx`,
 * `docs/features/INFO_HINTS.md`) : son nom accessible et ce qui le referme.
 *
 * Séparées du composant pour être testées sans DOM : Jest tourne sous Node.
 */
import frCommon from "@/messages/fr/common.json";
import enCommon from "@/messages/en/common.json";
import type { Locale } from "@/lib/shared/locales";

/**
 * Le gabarit du nom accessible, par langue (`common.infoHint.label`).
 *
 * Lu ici plutôt que par un fournisseur de messages : le bouton sert sous
 * plusieurs espaces (profil, connexion, fiche joueur) qui n'ont pas le même
 * fournisseur. Les deux gabarits pèsent une quarantaine d'octets.
 */
const LABEL_TEMPLATES: Record<Locale, string> = {
  fr: frCommon.infoHint.label,
  en: enCommon.infoHint.label,
};

/** « Plus d'infos : {subject} » dans la langue de la page. */
export function infoHintLabel(locale: Locale, subject: string): string {
  return LABEL_TEMPLATES[locale].replace("{subject}", subject);
}

/** Un geste reçu pendant que l'explication est ouverte. */
export type InfoHintGesture =
  | { kind: "key"; key: string }
  | { kind: "outsideClick" }
  | { kind: "insideClick" };

/**
 * Ce que le geste fait de l'explication ouverte : `closeAndFocus` (Échap — le
 * focus revient au bouton), `close` (clic ailleurs), `keep` sinon.
 *
 * Le clic ailleurs referme au **clic** et non à l'appui : l'explication est
 * dans le flux de la page, et la replier à l'appui ferait remonter le contrôle
 * visé sous le pointeur — le relâchement tomberait à côté et le clic serait
 * perdu.
 */
export function infoHintReaction(gesture: InfoHintGesture): "closeAndFocus" | "close" | "keep" {
  if (gesture.kind === "key") return gesture.key === "Escape" ? "closeAndFocus" : "keep";
  return gesture.kind === "outsideClick" ? "close" : "keep";
}

/**
 * Après un clic dans l'explication ouverte, faut-il rendre le focus au « i » ?
 * Seulement quand il est parti à un conteneur qui porte le composant (la
 * modale, `tabIndex={-1}`) : Échap y fermerait la modale au lieu de replier le
 * « i ». Sur une page ordinaire il va à `body` — rien à rendre, la lecture
 * reste où elle est.
 */
export function infoHintFocusLeftToContainer(
  root: Node | null,
  active: Node | null,
  body: Node | null,
): boolean {
  if (!root || !active || active === body) return false;
  return !root.contains(active) && active.contains(root);
}
