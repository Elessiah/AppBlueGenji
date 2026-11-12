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
  | { kind: "outsidePointerUp"; interactive: boolean; moved?: boolean };

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
 * `click`, et un glissé (`moved`, au-delà de `POINTER_TAP_SLOP`) n'est pas un
 * tap : un trait de stylet ou un glissé court ne replie pas le panneau.
 */
export function infoHintReaction(gesture: InfoHintGesture): "closeAndFocus" | "close" | "keep" {
  switch (gesture.kind) {
    case "key":
      return gesture.key === "Escape" ? "closeAndFocus" : "keep";
    case "outsideClick":
      return "close";
    case "outsidePointerUp":
      return gesture.interactive || gesture.moved ? "keep" : "close";
    default:
      return "keep";
  }
}

/** Ce que la recherche d'une cible interactive lit de l'élément touché. */
export interface PointerTarget {
  closest?(selector: string): unknown;
}

/**
 * Contrôles qui reçoivent un `click` sur iOS : le geste leur revient. Rôles
 * ARIA des widgets compris (onglet, interrupteur, option, liste déroulante…)
 * et tout élément atteignable au clavier (`tabindex` ≥ 0) ; un conteneur de
 * modale (`tabindex="-1"`) n'en est pas un — toucher son texte referme —, ni
 * une zone défilante (`<ScrollArea>` qui déborde : `tabindex="0"` pour le
 * clavier, `role="region"`), dont le texte n'est pas un contrôle.
 */
const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "label",
  "summary",
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"]):not(.scroll-area):not([role="region"])',
  ...[
    "button",
    "link",
    "checkbox",
    "radio",
    "switch",
    "tab",
    "option",
    "combobox",
    "slider",
    "spinbutton",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "treeitem",
  ].map((role) => `[role="${role}"]`),
].join(", ");

/** Déplacement (px) au-delà duquel un appui-relâchement est un glissé, pas un tap. */
export const POINTER_TAP_SLOP = 10;

/** Le pointeur a-t-il glissé entre l'appui et le relâchement ? Sans appui connu, non. */
export function pointerMoved(
  start: Readonly<{ x: number; y: number }> | null | undefined,
  end: Readonly<{ x: number; y: number }>,
): boolean {
  if (!start) return false;
  return Math.hypot(end.x - start.x, end.y - start.y) > POINTER_TAP_SLOP;
}

/**
 * Contrôles qui se servent eux-mêmes d'Échap : liste d'un `combobox` ouverte,
 * champ de recherche (Échap le vide), menu ou liste d'options ouverts.
 */
const ESCAPE_CONSUMER_SELECTOR =
  '[role="combobox"][aria-expanded="true"], input[type="search"], [role="menu"], [role="listbox"]';

/** Le focus est-il sur un contrôle qui consomme Échap lui-même ? */
export function isEscapeConsumer(target: PointerTarget | null | undefined): boolean {
  return Boolean(target?.closest?.(ESCAPE_CONSUMER_SELECTOR));
}

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
 * Le « i » ouvert écoute Échap sur `document`. La touche est la sienne quand le
 * focus (`active`) est **dans** le « i », quelle que soit la modale relevée en
 * dernier dans le DOM. Elle revient à un contrôle focalisé qui s'en sert lui-même
 * (`isEscapeConsumer` : liste ouverte, recherche, menu) : le « i » ne l'avale
 * pas. Sinon, il ne la prend pas à une modale ouverte **au-dessus** de lui
 * (`topModal`, la dernière ouverte) ; sans modale, ou une modale qui le porte,
 * elle est la sienne — un champ voisin atteint par Tab compris.
 */
export function infoHintOwnsEscape(
  root: Node | null,
  topModal: Node | null,
  active?: (Node & PointerTarget) | null,
): boolean {
  if (root && active && root.contains(active)) return true;
  if (isEscapeConsumer(active)) return false;
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
