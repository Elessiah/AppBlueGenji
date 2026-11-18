"use client";

import { useEffect, useRef } from "react";
import { Eye } from "lucide-react";
import { useLocaleRouter } from "@/components/i18n/locale-navigation";
import { useShellText } from "@/components/i18n/shell-text";
import { InfoHint } from "@/components/ui/info-hint";
import { takePlayerViewFocus, usePlayerViewToggle } from "@/components/player-view-toggle";
import { PLAYER_VIEW_MAX_HOURS, playerViewExpiryDelayMs } from "@/lib/shared/player-view";
import s from "./player-view.module.css";

/**
 * Bannière de la vue joueur, sur toutes les pages tant qu'elle dure (mise en
 * page racine) : elle dit l'état et rend les droits d'un clic. À l'échéance
 * (`until`), les droits reviennent d'eux-mêmes : la page est relue, et la
 * bannière s'efface au lieu de dire une vue joueur qui n'est plus.
 */
export function PlayerViewBanner({ until }: Readonly<{ until: string | null }>) {
  const { t } = useShellText();
  const router = useLocaleRouter();
  const { pending, toggle } = usePlayerViewToggle();
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const delay = playerViewExpiryDelayMs(until, Date.now());
    if (delay === null) return;
    const timer = setTimeout(() => router.refresh(), delay);
    return () => clearTimeout(timer);
  }, [until, router]);
  // Arrivée par le menu du compte : le focus passe au retour, qui dit l'état.
  useEffect(() => {
    if (takePlayerViewFocus("banner")) backRef.current?.focus();
  }, []);
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
        ref={backRef}
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
