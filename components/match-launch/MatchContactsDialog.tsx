"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { ScrollArea } from "@/components/cyber/ScrollArea";
import { useToast } from "@/components/ui/toast";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import { MATCH_LAUNCH_REFRESH_EVENT, type MatchLaunchInfo } from "@/lib/shared/match-launch";
import { CasterCard, SideCard } from "./LaunchContactCards";
import { useLaunchText, type LaunchText } from "./launch-text";
import launchStyles from "./MatchLaunchCenter.module.css";
import styles from "./MatchContactsDialog.module.css";

/** Refus de `GET /api/matches/[id]/contacts`, dans la langue de la page. */
export function contactsErrorText(text: LaunchText, code: string | null | undefined): string {
  if (code === "MATCH_CONTACTS_UNAVAILABLE") return text.t("contacts.unavailable");
  return text.t("contacts.failed");
}

type LoadState = { kind: "loading" } | { kind: "ready"; launch: MatchLaunchInfo } | { kind: "failed" };

/**
 * Modale « Contacts » d'une carte de match (`docs/features/MATCH_LAUNCH.md`
 * § Contacts hors lancement) : les fiches de la modale de lancement — équipes,
 * hôte, contacts, caster —, lues pour **ce** match par
 * `GET /api/matches/[id]/contacts`. Le serveur seul décide qui les reçoit (les
 * parties du match, comme au lancement) ; la carte n'offre le bouton qu'à
 * elles, et un refus se dit par une notification.
 *
 * Portée dans `document.body`, `useDialogBehavior` (piège de focus, Échap),
 * voile fermé par `useBackdropDismiss` ; le focus d'ouverture va à « Fermer ».
 */
export function MatchContactsDialog({
  matchId,
  matchLabel,
  onClose,
}: Readonly<{ matchId: number; matchLabel: string; onClose: () => void }>) {
  const text = useLaunchText();
  const { t } = text;
  const { showError, showSuccess } = useToast();
  const titleId = useId();
  // À la fermeture, la modale de lancement relit ses matchs : une ouverture
  // d'office retenue pendant que « Contacts » était ouverte part alors.
  const close = () => {
    onClose();
    window.dispatchEvent(new Event(MATCH_LAUNCH_REFRESH_EVENT));
  };
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  useEffect(() => setMounted(true), []);
  const dialogRef = useDialogBehavior({ open: mounted, onClose: close });
  const backdrop = useBackdropDismiss(close);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const response = await fetch(`/api/matches/${matchId}/contacts`, { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as { launch?: MatchLaunchInfo; error?: string };
        if (!alive) return;
        if (!response.ok || !payload.launch) {
          setState({ kind: "failed" });
          showError(contactsErrorText(text, payload.error));
          return;
        }
        setState({ kind: "ready", launch: payload.launch });
      } catch {
        if (!alive) return;
        setState({ kind: "failed" });
        showError(contactsErrorText(text, null));
      }
    })();
    return () => {
      alive = false;
    };
    // Une lecture par ouverture : la langue ou la notification ne relancent rien.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      showSuccess(t("copied", { label }));
    } catch {
      showError(t("copyFailed"));
    }
  };

  if (!mounted) return null;

  const launch = state.kind === "ready" ? state.launch : null;
  return createPortal(
    <div /* NOSONAR S6819 — voile de modale, sans équivalent natif */ role="presentation" className={styles.backdrop} {...backdrop}>
      <div /* NOSONAR S6819 — modale portée dans body (useDialogBehavior) : `<dialog>` changerait couche, Échap et ::backdrop */
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={state.kind === "loading"}
        tabIndex={-1}
        className={styles.dialog}
      >
        <h2 id={titleId} className={styles.title}>
          {t("contacts.title", { match: matchLabel })}
        </h2>
        <p className={styles.subtitle}>{t("contacts.lead")}</p>
        <ScrollArea orientation="y" className={styles.scroll} ariaLabel={t("contacts.scrollAria")}>
          <div className={styles.content}>
            {state.kind === "loading" && <p className={styles.note}>{t("contacts.loading")}</p>}
            {/* Le refus part en notification (jamais en ligne) ; le corps reste
                neutre — « aucun contact » laisserait croire que les adversaires
                n'en ont pas. */}
            {state.kind === "failed" && <p className={styles.note}>{t("contacts.notShown")}</p>}
            {launch && (
              <>
                <div className={launchStyles.sides}>
                  <SideCard
                    side={launch.team1}
                    isHost={launch.hostTeamId === launch.team1.teamId}
                    phase={launch.phase}
                    onCopy={copy}
                    contactsShown
                    linkNames
                  />
                  <div className={launchStyles.divider} aria-hidden="true">
                    {t("vs")}
                  </div>
                  <SideCard
                    side={launch.team2}
                    isHost={launch.hostTeamId === launch.team2.teamId}
                    phase={launch.phase}
                    onCopy={copy}
                    contactsShown
                    linkNames
                  />
                </div>
                <CasterCard
                  caster={launch.caster}
                  phase={launch.phase}
                  onCopy={copy}
                  contactsShown
                  noCasterText={t("contacts.noCaster")}
                  linkNames
                />
              </>
            )}
          </div>
        </ScrollArea>
        <div className={styles.actions}>
          <button type="button" className="btn ghost" onClick={close} data-autofocus>
            {t("close")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
