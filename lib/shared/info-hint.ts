/**
 * Règles pures du bouton « i » (`components/ui/info-hint.tsx`,
 * `docs/features/INFO_HINTS.md`) : son nom accessible et ce qui le referme.
 *
 * Séparées du composant pour être testées sans DOM : Jest tourne sous Node.
 */
import frCommon from "@/messages/fr/common.json";
import enCommon from "@/messages/en/common.json";
import { LOCALES, type Locale } from "@/lib/shared/locales";

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
  | { kind: "insideClick" }
  | { kind: "outsidePointerUp"; interactive: boolean };

/**
 * Ce que le geste fait de l'explication ouverte : `closeAndFocus` (Échap — le
 * focus revient au bouton), `close` (clic ailleurs), `keep` sinon.
 *
 * Le clic ailleurs referme au **clic** et non à l'appui : l'explication est
 * dans le flux de la page, et la replier à l'appui ferait remonter le contrôle
 * visé sous le pointeur — le relâchement tomberait à côté et le clic serait
 * perdu. Une cible **non interactive** (du texte, un fond) ne risque pas cela,
 * et Safari iOS n'envoie aucun `click` au `document` pour elle : elle referme
 * donc au relâchement (`outsidePointerUp`). Une cible interactive attend son
 * `click`.
 */
export function infoHintReaction(gesture: InfoHintGesture): "closeAndFocus" | "close" | "keep" {
  switch (gesture.kind) {
    case "key":
      return gesture.key === "Escape" ? "closeAndFocus" : "keep";
    case "outsideClick":
      return "close";
    case "outsidePointerUp":
      return gesture.interactive ? "keep" : "close";
    default:
      return "keep";
  }
}

/** Ce que la recherche d'une cible interactive lit de l'élément touché. */
export interface PointerTarget {
  closest?(selector: string): unknown;
}

/** Contrôles qui reçoivent un `click` sur iOS : le geste leur revient. */
const INTERACTIVE_SELECTOR =
  'a[href], button, input, select, textarea, label, summary, [role="button"], [role="link"], [role="checkbox"], [role="menuitem"]';

/** La cible d'un relâchement est-elle un contrôle (qui fermera au `click`) ? */
export function isInteractivePointerTarget(target: PointerTarget | null | undefined): boolean {
  return Boolean(target?.closest?.(INTERACTIVE_SELECTOR));
}

/**
 * Après Échap, faut-il rendre le focus au « i » ? Quand il est sur `body`, sur
 * le conteneur d'une modale qui porte le composant (`tabIndex={-1}`, focus donné
 * par un clic sur le texte) ou dans le « i » lui-même ; jamais quand il est sur
 * un champ voisin (Tab depuis l'explication) : l'arracher à la saisie serait
 * une rupture.
 */
export function infoHintRefocusAfterEscape(
  root: Node | null,
  active: Node | null,
  body: Node | null,
): boolean {
  if (!root || !active || active === body) return true;
  return root.contains(active) || active.contains(root);
}

/** Ce que la recherche de la modale du dessus lit du document. */
export interface ModalSearchRoot {
  querySelectorAll(selector: string): { length: number; item(index: number): Node | null };
}

/** La modale ouverte en dernier (la plus haute : les modales se portent dans `body` dans l'ordre d'ouverture). */
export function topOpenModal(root: ModalSearchRoot): Node | null {
  const modals = root.querySelectorAll('[aria-modal="true"]');
  return modals.item(modals.length - 1);
}

/**
 * Le « i » ouvert écoute Échap sur `document` : il ne doit pas le prendre à une
 * modale ouverte **au-dessus** de lui (`topModal`, la dernière ouverte). Sans
 * modale, ou une modale qui le porte, la touche est la sienne.
 */
export function infoHintOwnsEscape(root: Node | null, topModal: Node | null): boolean {
  return !topModal || (root !== null && topModal.contains(root));
}

/**
 * La langue du nom du bouton : celle de l'élément ambiant le plus proche qui
 * en déclare une (`lang`) quand elle est connue, sinon celle de la page. Une
 * modale de personnel `lang="fr"` ouverte sous `/en` garde « Plus d'infos »,
 * prononcé en français comme le reste du texte qui l'entoure.
 */
export function infoHintLocale(ambientLang: string | null | undefined, pageLocale: Locale): Locale {
  const primary = ambientLang?.trim().toLowerCase().split("-")[0];
  return LOCALES.find((candidate) => candidate === primary) ?? pageLocale;
}
