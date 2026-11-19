"use client";

import { useState } from "react";
import { useLocaleRouter } from "@/components/i18n/locale-navigation";
import { useShellText } from "@/components/i18n/shell-text";
import { useToast } from "@/components/ui/toast";
import type { PlatformRole } from "@/lib/shared/permissions";

/**
 * Pose (rôles à incarner, vides : vue joueur) ou retire l'incarnation de
 * **cette session** (`docs/features/ADMIN_ROLE_IMPERSONATION.md`).
 * Rend `false` si la requête échoue ou est refusée : l'appelant le dit (toast).
 */
export async function requestPlayerView(
  active: boolean,
  roles: readonly PlatformRole[] = [],
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetchImpl("/api/auth/player-view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(active ? { active, roles } : { active }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Le focus à rendre après la relecture de la page : le geste démonte l'élément
 * cliqué (entrée du menu, bannière) et le focus tomberait sur `<body>`. Le
 * geste note où le poser, l'élément qui apparaît le réclame (une seule fois).
 */
type FocusTarget = "banner" | "account";
let pendingFocus: FocusTarget | null = null;

/** Un seul geste à la fois : la bannière et le menu du compte partagent ce verrou. */
let inFlight = false;

/** `true` une seule fois si le geste attend ce focus. */
export function takePlayerViewFocus(target: FocusTarget): boolean {
  if (pendingFocus !== target) return false;
  pendingFocus = null;
  return true;
}

/**
 * Le geste, commun à la modale « Incarner un rôle » et à la bannière : un second clic
 * n'envoie rien de plus, un échec se dit en notification, une réussite relit
 * la page (`router.refresh()`) — la barre, les menus et les écrans de gestion
 * changent avec les droits de la session.
 */
export function usePlayerViewToggle(onDone?: () => void): {
  pending: boolean;
  toggle: (active: boolean, roles?: readonly PlatformRole[]) => Promise<boolean>;
} {
  const router = useLocaleRouter();
  const { showError } = useToast();
  const { t } = useShellText();
  const [pending, setPending] = useState(false);
  const toggle = async (active: boolean, roles: readonly PlatformRole[] = []) => {
    if (inFlight) return false;
    inFlight = true;
    setPending(true);
    const done = await requestPlayerView(active, roles);
    inFlight = false;
    setPending(false);
    if (!done) {
      showError(t(active ? "account.impersonateFailed" : "playerView.backFailed"));
      return false;
    }
    pendingFocus = active ? "banner" : "account";
    onDone?.();
    router.refresh();
    return true;
  };
  return { pending, toggle };
}
