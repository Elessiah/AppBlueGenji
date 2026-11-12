/**
 * Nom affiché d'une équipe ou d'un joueur dont le nom enregistré ne se **voit**
 * pas : un nom ancien fait seulement de caractères invisibles, que
 * `cleanStoredNames` a laissé tel quel (le vider aurait violé la contrainte du
 * nom). Lu tel quel, il rendait un lien, un titre ou une ligne d'effectif sans
 * aucun texte. Il s'affiche « Équipe #id » / « Joueur #id » dans la langue de
 * la page (`common.entityFallback`).
 *
 * Lu ici plutôt que par un fournisseur de messages : les liens d'entité servent
 * sous tous les espaces de noms, et dans les tests sans fournisseur (même
 * raison que `lib/shared/info-hint.ts`).
 */
import frCommon from "@/messages/fr/common.json";
import enCommon from "@/messages/en/common.json";
import type { Locale } from "@/lib/shared/locales";
import { visibleText } from "@/lib/shared/visible-text";

export type FallbackEntityKind = "team" | "player";

const TEMPLATES: Record<Locale, Record<FallbackEntityKind, string>> = {
  fr: frCommon.entityFallback,
  en: enCommon.entityFallback,
};

/** Vrai si le nom a au moins un caractère visible. */
export function hasVisibleName(name: string | null | undefined): boolean {
  return typeof name === "string" && visibleText(name) !== "";
}

/**
 * Le nom tel quel s'il se voit, sinon « Équipe #id » / « Joueur #id » dans la
 * langue de la page.
 */
export function shownEntityName(name: string, kind: FallbackEntityKind, id: number, locale: Locale): string {
  return hasVisibleName(name) ? name : TEMPLATES[locale][kind].replace("{id}", String(id));
}
