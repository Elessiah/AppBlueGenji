"use client";

import type { ComponentType } from "react";
import { onceLoader, preloadMissing } from "@/lib/shared/lazy-component";
import type { ImpersonateRoleDialogProps } from "./impersonate-role-dialog";

/**
 * La modale « Incarner un rôle » (et ses textes, `impersonate-role-text.ts`),
 * chargée à la demande par le menu du compte : elle ne sert qu'aux
 * administrateurs, son code reste hors du morceau commun de la barre. Module
 * sans texte : le menu l'importe sans rien ajouter au premier chargement.
 *
 * Pas de `next/dynamic` : un fichier manquant (hors ligne, déploiement entre
 * deux) y lèverait au rendu et remplacerait toute la page par l'écran
 * d'erreur ; ici l'échec revient au menu, qui le dit en notification et
 * retente au geste suivant (`onceLoader` ne garde pas un échec).
 */
export type ImpersonateRoleDialogComponent = ComponentType<ImpersonateRoleDialogProps>;

const dialogLoader = onceLoader<ImpersonateRoleDialogComponent>(() =>
  import("./impersonate-role-dialog").then((module) => module.ImpersonateRoleDialog),
);

/** La modale, une fois ; un échec se retente. */
export function loadImpersonateRoleDialog(): Promise<ImpersonateRoleDialogComponent> {
  return dialogLoader.load();
}

/** La modale déjà là ; `null` sinon. */
export function loadedImpersonateRoleDialog(): ImpersonateRoleDialogComponent | null {
  return dialogLoader.loaded();
}

/** Précharge à l'ouverture du menu ; rien si elle est déjà là, silence après un échec. */
export const preloadImpersonateRoleDialog = preloadMissing([dialogLoader]);
