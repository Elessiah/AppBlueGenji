"use client";

import Image from "next/image";
import Link from "next/link";
import {
  REPORT_TARGET_LABELS,
  reportTargetHref,
  type ReportCategory,
  type ReportTargetView,
} from "@/lib/shared/content-reports";
import { formatQuarantineDate, type LogoQuarantineView } from "@/lib/shared/logo-quarantine";
import { ArmedButton } from "./ArmedButton";
import styles from "../reports.module.css";

interface ReportTargetCardProps {
  target: ReportTargetView;
  category: ReportCategory;
  /** Logos masqués au titre du signalement, pour cette équipe. */
  quarantines: LogoQuarantineView[];
  busy: boolean;
  onHideLogo: (teamId: number) => void;
  onDeleteLogo: (teamId: number) => void;
  onRestore: (quarantineId: number) => void;
  onPurge: (quarantineId: number) => void;
}

/**
 * Une cible d'un signalement, avec ce qu'on peut faire d'elle **sans quitter le
 * panneau** : ouvrir sa fiche (nouvel onglet, pour garder le dossier sous les
 * yeux), et pour une équipe, masquer son logo en attendant une contestation,
 * le supprimer tout de suite, ou — une fois masqué — le rétablir ou le
 * supprimer avant l'échéance.
 */
export function ReportTargetCard({
  target,
  category,
  quarantines,
  busy,
  onHideLogo,
  onDeleteLogo,
  onRestore,
  onPurge,
}: ReportTargetCardProps) {
  const hidden = quarantines.find((quarantine) => quarantine.status === "HIDDEN") ?? null;
  const closed = quarantines.filter((quarantine) => quarantine.status !== "HIDDEN");
  const canActOnLogo = target.type === "TEAM" && target.exists && category !== "BUG";

  return (
    <li className={styles.target}>
      <div className={styles.targetHead}>
        {target.imageUrl ? (
          <Image src={target.imageUrl} alt="" width={44} height={44} className={styles.targetImage} />
        ) : (
          <span className={styles.targetImage} aria-hidden="true">
            {Array.from(target.label.trim())[0]?.toUpperCase() ?? "?"}
          </span>
        )}
        <div className={styles.targetText}>
          <span className={styles.targetType}>{REPORT_TARGET_LABELS[target.type].one}</span>
          {target.exists ? (
            <Link href={reportTargetHref(target)} target="_blank" rel="noreferrer" className={styles.inlineLink}>
              <span className={styles.targetName}>{target.label}</span>
              <span className="sr-only"> (nouvel onglet)</span>
            </Link>
          ) : (
            <span className={styles.targetName}>{target.label} — supprimé</span>
          )}
          {target.detail && <span className={styles.targetDetail}>{target.detail}</span>}
        </div>
      </div>

      {hidden && (
        <div className={styles.quarantine}>
          <div className={styles.quarantineHead}>
            {/* Un `<img>` brut, et c'est voulu : l'aperçu vient d'une route
                réservée à la modération (le fichier n'est plus en ligne), que
                l'optimiseur de `next/image` — public, avec cache — ne doit pas
                relayer. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/admin/logo-quarantines/${hidden.id}/image`}
              alt={`Logo masqué de ${target.label}`}
              width={44}
              height={44}
              className={styles.targetImage}
            />
            <span>
              <strong>Logo masqué</strong> le {formatQuarantineDate(new Date(hidden.hiddenAt))}. Suppression
              définitive le {formatQuarantineDate(new Date(hidden.purgeAfter))} sans contestation.
            </span>
          </div>
          <div className={styles.targetActions}>
            <button
              type="button"
              className={`${styles.actionButton} ${styles.actionPrimary}`}
              disabled={busy}
              onClick={() => onRestore(hidden.id)}
            >
              Rétablir le logo
            </button>
            <ArmedButton
              label="Supprimer maintenant"
              confirmLabel="Confirmer la suppression ?"
              className={styles.actionDanger}
              disabled={busy}
              onConfirm={() => onPurge(hidden.id)}
            />
          </div>
        </div>
      )}

      {closed.map((quarantine) => (
        <p key={quarantine.id} className={styles.muted}>
          Logo masqué le {formatQuarantineDate(new Date(quarantine.hiddenAt))} —{" "}
          {quarantine.status === "RESTORED" ? "rétabli" : "supprimé définitivement"}
          {quarantine.closedAt ? ` le ${formatQuarantineDate(new Date(quarantine.closedAt))}` : ""}.
        </p>
      ))}

      {canActOnLogo && !hidden && target.imageUrl && (
        <div className={styles.targetActions}>
          <button
            type="button"
            className={`${styles.actionButton} ${styles.actionWarn}`}
            disabled={busy}
            onClick={() => onHideLogo(target.id)}
          >
            Masquer le logo
          </button>
          <ArmedButton
            label="Supprimer le logo"
            confirmLabel="Supprimer sans délai ?"
            className={styles.actionDanger}
            disabled={busy}
            onConfirm={() => onDeleteLogo(target.id)}
          />
        </div>
      )}
    </li>
  );
}
