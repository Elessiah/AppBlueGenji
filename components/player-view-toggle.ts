"use client";

import { useState } from "react";
import { useLocaleRouter } from "@/components/i18n/locale-navigation";
import { useShellText } from "@/components/i18n/shell-text";
import { useToast } from "@/components/ui/toast";
import type { PlatformRole } from "@/lib/shared/permissions";

/**
 * Issue d'une bascule : faite, refusée parce que la session incarne déjà
 * d'autres rôles (`409`, posés depuis un autre onglet), freinée (`429` : trop
 * de bascules dans la minute, il suffit d'attendre), ou échouée.
 */
export type PlayerViewOutcome = "done" | "conflict" | "throttled" | "failed";

/**
 * Pose (rôles à incarner, vides : vue joueur) ou retire l'incarnation de
 * **cette session** (`docs/features/ADMIN_ROLE_IMPERSONATION.md`).
 * Rend `"failed"` si la requête échoue ou est refusée, `"conflict"` si une
 * autre incarnation tient déjà la session, `"throttled"` sur un `429` :
 * l'appelant le dit (toast).
 */
export async function requestPlayerView(
  active: boolean,
  roles: readonly PlatformRole[] = [],
  fetchImpl: typeof fetch = fetch,
): Promise<PlayerViewOutcome> {
  try {
    const res = await fetchImpl("/api/auth/player-view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(active ? { active, roles } : { active }),
    });
    if (res.ok) return "done";
    if (res.status === 429) return "throttled";
    return active && res.status === 409 ? "conflict" : "failed";
  } catch {
    return "failed";
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
 * changent avec les droits de la session. Une entrée refusée parce qu'une
 * autre incarnation tient déjà la session (autre onglet) le dit, et relit
 * aussi la page : la bannière montre les rôles réellement incarnés.
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
    const outcome = await requestPlayerView(active, roles);
    inFlight = false;
    setPending(false);
    if (outcome === "throttled") {
      showError(t("playerView.throttled"));
      return false;
    }
    if (outcome === "failed") {
      showError(t(active ? "account.impersonateFailed" : "playerView.backFailed"));
      return false;
    }
    if (outcome === "conflict") showError(t("account.impersonateConflict"));
    pendingFocus = active ? "banner" : "account";
    onDone?.();
    router.refresh();
    return true;
  };
  return { pending, toggle };
}
