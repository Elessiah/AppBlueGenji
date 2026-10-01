"use client";

import Image from "next/image";
import Link from "next/link";
import {
  REPORT_TARGET_LABELS,
  reportTargetHref,
  type ReportCategory,
  type ReportTargetRef,
  type ReportTargetView,
} from "@/lib/shared/content-reports";
import { formatQuarantineDate, isImmediateLogoRemoval, type LogoQuarantineView } from "@/lib/shared/logo-quarantine";
import { ArmedButton } from "./ArmedButton";
import styles from "../reports.module.css";

interface ReportTargetCardProps {
  target: ReportTargetView;
  category: ReportCategory;
  /** Images masquées au titre du signalement, pour cette cible. */
  quarantines: LogoQuarantineView[];
  busy: boolean;
  onHideLogo: (target: ReportTargetRef) => void;
  onDeleteLogo: (target: ReportTargetRef) => void;
  onRestore: (quarantineId: number) => void;
  onPurge: (quarantineId: number) => void;
}

/**
 * « Logo » pour une équipe, « avatar » pour un joueur : les deux seules cibles
 * qui portent une image. `withArticle` porte l'élision (« l'avatar », jamais
 * « le avatar ») une fois pour toutes les phrases qui le répètent ci-dessous.
 */
const IMAGE_NOUN: Partial<Record<ReportTargetView["type"], { nounCap: string; withArticle: string }>> = {
  TEAM: { nounCap: "Logo", withArticle: "le logo" },
  USER: { nounCap: "Avatar", withArticle: "l'avatar" },
};
const DEFAULT_IMAGE_NOUN = IMAGE_NOUN.TEAM as { nounCap: string; withArticle: string };

/**
 * Une cible d'un signalement, avec ce qu'on peut faire d'elle **sans quitter le
 * panneau** : ouvrir sa fiche (nouvel onglet, pour garder le dossier sous les
 * yeux), et pour une équipe ou un joueur, masquer son image en attendant une
 * contestation, la supprimer tout de suite, ou — une fois masquée — la
 * rétablir ou la supprimer avant l'échéance.
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
}: Readonly<ReportTargetCardProps>) {
  const hidden = quarantines.find((quarantine) => quarantine.status === "HIDDEN") ?? null;
  const closed = quarantines.filter((quarantine) => quarantine.status !== "HIDDEN");
  const image = IMAGE_NOUN[target.type];
  const { nounCap, withArticle } = image ?? DEFAULT_IMAGE_NOUN;
  const canActOnLogo = image !== undefined && target.exists && category !== "BUG";

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
              alt={`${nounCap} masqué de ${target.label}`}
              width={44}
              height={44}
              className={styles.targetImage}
            />
            <span>
              <strong>{nounCap} masqué</strong> le {formatQuarantineDate(new Date(hidden.hiddenAt))}. Suppression
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
              Rétablir {withArticle}
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

      {closed.map((quarantine) =>
        isImmediateLogoRemoval(quarantine) ? (
          <p key={quarantine.id} className={styles.muted}>
            {nounCap} supprimé sans délai le {formatQuarantineDate(new Date(quarantine.hiddenAt))}.
          </p>
        ) : (
          <p key={quarantine.id} className={styles.muted}>
            {nounCap} masqué le {formatQuarantineDate(new Date(quarantine.hiddenAt))} —{" "}
            {quarantine.status === "RESTORED" ? "rétabli" : "supprimé définitivement"}
            {quarantine.closedAt ? ` le ${formatQuarantineDate(new Date(quarantine.closedAt))}` : ""}.
          </p>
        ),
      )}

      {canActOnLogo && !hidden && target.imageUrl && (
        <div className={styles.targetActions}>
          <button
            type="button"
            className={`${styles.actionButton} ${styles.actionWarn}`}
            disabled={busy}
            onClick={() => onHideLogo({ type: target.type, id: target.id })}
          >
            Masquer {withArticle}
          </button>
          <ArmedButton
            label={`Supprimer ${withArticle}`}
            confirmLabel="Supprimer sans délai ?"
            className={styles.actionDanger}
            disabled={busy}
            onConfirm={() => onDeleteLogo({ type: target.type, id: target.id })}
          />
        </div>
      )}
    </li>
  );
}
