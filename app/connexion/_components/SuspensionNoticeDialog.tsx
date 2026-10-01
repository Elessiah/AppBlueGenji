"use client";

import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import {
  SUSPENSION_GROUND_DEFINITIONS,
  suspensionContestText,
  suspensionSpan,
  type SuspensionNotice,
} from "@/lib/shared/account-suspension";
import { TERMS_PATH } from "@/lib/shared/terms-of-use";

/**
 * Exposé d'une suspension, à la connexion refusée d'un compte suspendu
 * (`lib/shared/account-suspension.ts`) : la décision et sa durée, les faits
 * retenus, la clause invoquée, et le moyen de la contester. C'est le seul canal
 * qui joigne un compte sans Discord rattaché — d'où une modale qu'on lit à son
 * rythme, plutôt qu'une notification qui s'efface.
 */
export function SuspensionNoticeDialog({ notice, onClose }: Readonly<{ notice: SuspensionNotice; onClose: () => void }>) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dialogRef = useDialogBehavior({ open: mounted, onClose });
  const backdrop = useBackdropDismiss(onClose);

  if (!mounted) return null;
  const ground = SUSPENSION_GROUND_DEFINITIONS[notice.ground];

  return createPortal(
    <div /* NOSONAR S6819 — voile de modale, sans équivalent natif */
      role="presentation"
      {...backdrop}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "grid",
        placeItems: "center",
        padding: 16,
        background: "rgba(4, 8, 14, 0.78)",
        backdropFilter: "blur(4px)",
      }}
    >
      <div /* NOSONAR S6819 — modale portée dans body (useDialogBehavior) : `<dialog>` changerait couche, Échap et ::backdrop */
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="suspension-notice-title"
        aria-describedby="suspension-notice-span"
        tabIndex={-1}
        style={{
          width: "min(480px, calc(100vw - 32px))",
          background: "var(--cyber-bg-1)",
          border: "1px solid var(--line-strong-cy)",
          borderRadius: "var(--r-cy-lg)",
          padding: 24,
        }}
      >
        <h2 id="suspension-notice-title" className="display" style={{ fontSize: 18, margin: "0 0 10px" }}>
          Compte suspendu
        </h2>
        <p id="suspension-notice-span" style={{ color: "var(--ink)", fontSize: 14, lineHeight: 1.7, margin: "0 0 12px" }}>
          Ce compte est suspendu {suspensionSpan(notice.endsAt)} (décision {notice.reference}) : aucune connexion
          n&apos;est possible tant que la suspension court.
        </p>
        <dl style={{ fontSize: 13.5, lineHeight: 1.7, color: "var(--ink-mute)", margin: "0 0 12px" }}>
          <dt style={{ color: "var(--ink)", fontWeight: 600 }}>Faits retenus</dt>
          <dd style={{ margin: "0 0 8px" }}>{notice.reason}</dd>
          <dt style={{ color: "var(--ink)", fontWeight: 600 }}>Fondement</dt>
          <dd style={{ margin: "0 0 8px" }}>
            Conditions d&apos;utilisation,{" "}
            <Link href={`${TERMS_PATH}#${ground.anchor}`}>« {ground.clause} »</Link>. Décision prise par un membre
            de la modération, sans traitement automatisé.
          </dd>
          <dt style={{ color: "var(--ink)", fontWeight: 600 }}>Recours</dt>
          <dd style={{ margin: 0 }}>
            {suspensionContestText(notice.reference)}. Tu peux ensuite porter la décision devant le juge compétent.
          </dd>
        </dl>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          {/* Focus sur la sortie : l'exposé se lit par la description du dialogue,
              et le premier arrêt ne doit pas être le lien vers les conditions. */}
          <button type="button" className="btn ghost" onClick={onClose} data-autofocus>
            Fermer
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
