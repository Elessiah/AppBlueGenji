"use client";

import { useRef, useState } from "react";
import { Eye } from "lucide-react";
import { useLocaleRouter } from "@/components/i18n/locale-navigation";
import { useShellText } from "@/components/i18n/shell-text";
import { useToast } from "@/components/ui/toast";
import { InfoHint } from "@/components/ui/info-hint";
import { PLAYER_VIEW_MAX_HOURS } from "@/lib/shared/player-view";
import s from "./player-view.module.css";

/**
 * Bascule la vue joueur de **cette session** (`docs/features/ADMIN_PLAYER_VIEW.md`).
 * Rend `false` si la requête échoue ou est refusée : l'appelant le dit (toast).
 */
export async function requestPlayerView(active: boolean, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl("/api/auth/player-view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Le geste, commun au menu du compte et à la bannière : un second clic
 * n'envoie rien de plus, un échec se dit en notification, une réussite relit
 * la page (`router.refresh()`) — la barre, les menus et les écrans de gestion
 * changent avec les droits de la session.
 */
export function usePlayerViewToggle(onDone?: () => void): {
  pending: boolean;
  toggle: (active: boolean) => Promise<void>;
} {
  const router = useLocaleRouter();
  const { showError } = useToast();
  const { t } = useShellText();
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const toggle = async (active: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    const done = await requestPlayerView(active);
    inFlight.current = false;
    setPending(false);
    if (!done) {
      showError(t(active ? "account.playerViewFailed" : "playerView.backFailed"));
      return;
    }
    onDone?.();
    router.refresh();
  };
  return { pending, toggle };
}

/**
 * Bannière de la vue joueur, sur toutes les pages tant qu'elle dure (mise en
 * page racine) : elle dit l'état et rend les droits d'un clic.
 */
export function PlayerViewBanner() {
  const { t } = useShellText();
  const { pending, toggle } = usePlayerViewToggle();
  return (
    <section className={s.banner} aria-label={t("playerView.label")}>
      <div className={s.state}>
        <Eye className={s.icon} size={16} aria-hidden="true" />
        <span>{t("playerView.active")}</span>
        <InfoHint id="player-view-hint" subject={t("playerView.label")}>
          {t("playerView.hint", { hours: PLAYER_VIEW_MAX_HOURS })}
        </InfoHint>
      </div>
      <button
        type="button"
        className={s.back}
        onClick={() => !pending && toggle(false)}
        aria-disabled={pending || undefined}
        aria-busy={pending || undefined}
      >
        {pending ? t("playerView.backPending") : t("playerView.back")}
      </button>
    </section>
  );
}
