"use client";

import { useEffect, useRef, useState } from "react";
import { formatLocalDateTime } from "@/lib/shared/dates";
import { useToast } from "@/components/ui/toast";
import { Pill } from "@/components/cyber";
import {
  isSeedOrderEffective,
  moveInOrder,
  seedingLockReason,
  SEEDING_SOURCE_LABELS,
  type SeedingLockReason,
} from "@/lib/shared/seeding";
import { fromBracketMatch } from "@/lib/shared/match-lock";
import type { TournamentDetail } from "@/lib/shared/types";
import { EntrantLink, useParticipantWording } from "../_lib/entrant-link";
import { mapError } from "../_lib/error-map";
import styles from "./RegistrationsPanel.module.css";

interface RegistrationsPanelProps {
  detail: TournamentDetail;
  /** Le staff peut-il agir ? Faux quand le suivi du tournoi est en échec. */
  canReorder: boolean;
  /** Rafraîchit le détail après réordonnancement (le plateau est régénéré). */
  onReordered: () => void;
}

const LOCK_MESSAGES: Record<NonNullable<SeedingLockReason>, string> = {
  FINISHED: "Tournoi terminé : l'ordre n'a plus d'effet.",
  SCORES_ENTERED: "Un score a été saisi : l'ordre est désormais figé.",
};

/**
 * Liste des inscrites, et — pour le staff — l'endroit où l'on en règle l'ordre.
 *
 * Cette liste **est** le seeding : son rang décide des appariements de la
 * première manche. Les flèches vivent donc ici, sur les lignes elles-mêmes, et
 * non dans un second tableau des mêmes équipes ailleurs dans la page : deux
 * listes identiques dont une seule se manipule, c'est celle qu'on ne trouve pas.
 *
 * La fenêtre d'édition (jusqu'à la première saisie de score) est **déduite du
 * détail déjà reçu** — même règle pure que le serveur, `lib/shared/seeding.ts` —
 * plutôt que d'une requête à part : les flèches apparaissent avec la page, et le
 * serveur reste le juge, qui refuse en 409 une écriture devenue interdite.
 */
export function RegistrationsPanel({ detail, canReorder, onReordered }: RegistrationsPanelProps) {
  const { showError, showSuccess } = useToast();
  const wording = useParticipantWording();
  const [busy, setBusy] = useState(false);

  // Ordre affiché en attendant que le flux rapporte l'écriture : sans lui, la
  // ligne resterait en place le temps d'un aller-retour et le clic semblerait
  // sans effet. Il est abandonné dès que le serveur dit autre chose.
  const [pending, setPending] = useState<number[] | null>(null);
  const baseline = useRef<string>("");

  // Le clavier ne doit pas perdre sa place : la ligne bouge, et le bouton qu'on
  // vient d'actionner se désactive dès qu'elle atteint une extrémité — le
  // navigateur retire alors le focus, qui retombe sur le corps de la page.
  const buttons = useRef(new Map<string, HTMLButtonElement | null>());
  const [refocus, setRefocus] = useState<{ teamId: number; direction: "up" | "down" } | null>(null);
  // Le lecteur d'écran a besoin qu'on lui dise ce qui a bougé : le seul retour
  // visuel est le déplacement de la ligne.
  const [announcement, setAnnouncement] = useState("");

  const serverOrder = detail.registrations.map((reg) => reg.teamId);
  const serverKey = serverOrder.join(",");

  useEffect(() => {
    if (pending !== null && serverKey !== baseline.current) setPending(null);
  }, [pending, serverKey]);

  const order = pending ?? serverOrder;
  const byId = new Map(detail.registrations.map((reg) => [reg.teamId, reg]));
  const rows = order.flatMap((teamId) => {
    const reg = byId.get(teamId);
    return reg ? [reg] : [];
  });

  useEffect(() => {
    if (!refocus) return;
    const key = (direction: "up" | "down") => `${refocus.teamId}:${direction}`;
    const preferred = buttons.current.get(key(refocus.direction));
    // Arrivé en tête ou en queue, le bouton actionné n'existe plus comme cible :
    // on rend la main à celui qui ramène la ligne d'où elle vient.
    const target =
      preferred && !preferred.disabled
        ? preferred
        : buttons.current.get(key(refocus.direction === "up" ? "down" : "up"));
    target?.focus();
    setRefocus(null);
  }, [refocus]);

  const lockReason = seedingLockReason(detail.card.state, detail.matches.map(fromBracketMatch));
  const staff = detail.isAdmin && canReorder;
  const reorderable = staff && lockReason === null && rows.length > 1;

  const move = async (teamId: number, direction: "up" | "down") => {
    const next = moveInOrder(order, teamId, direction);
    const name = byId.get(teamId)?.teamName ?? "";
    baseline.current = serverKey;
    setPending(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/tournaments/${detail.card.id}/seeding`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ teamIds: next }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error || "SEEDING_REORDER_FAILED");
      showSuccess("Ordre mis à jour.");
      // Tournure neutre : le genre de « équipe » et de « joueur » diverge.
      setAnnouncement(`Nouveau rang de ${name} : ${next.indexOf(teamId) + 1} sur ${next.length}.`);
      onReordered();
    } catch (e) {
      // L'ordre du serveur fait foi : on lâche l'affichage optimiste plutôt que
      // de laisser croire à une écriture qui n'a pas eu lieu.
      setPending(null);
      showError(mapError((e as Error).message));
    } finally {
      setBusy(false);
      setRefocus({ teamId, direction });
    }
  };

  const source = detail.seedingSource;
  const showsRealDraw = isSeedOrderEffective(source);

  return (
    <div className="ds-block">
      <div className="ds-section-title green" style={{ alignItems: "center" }}>
        <h2>Inscriptions · ordre de départ</h2>
        {staff && <Pill variant="blue">{SEEDING_SOURCE_LABELS[source]}</Pill>}
      </div>

      {staff && (
        <>
          <p className={styles.hint}>
            {lockReason !== null
              ? LOCK_MESSAGES[lockReason]
              : reorderable
                ? "Ce rang décide des appariements de la première manche. Réordonnez les lignes avec les flèches ci-contre, jusqu'à la première saisie de score."
                : `Ce rang décidera des appariements de la première manche. Il se règlera ici dès qu'il y aura deux ${wording.manyEngaged}.`}
          </p>
          {!showsRealDraw && rows.length > 0 && (
            <p className={styles.warning}>
              Ce format seede depuis le classement du site : les rangs ci-dessous ne sont
              que l&apos;ordre d&apos;arrivée des inscriptions et ne seront pas ceux du
              tirage. Utilisez les flèches pour imposer votre propre ordre — il fera alors
              autorité.
            </p>
          )}
        </>
      )}

      {rows.length === 0 ? (
        <p className={styles.empty}>Aucune inscription pour le moment.</p>
      ) : (
        <div className={styles.table}>
          <div className={`${styles.row} ${styles.header} ${reorderable ? styles.reorderable : ""}`}>
            <span>Rang</span>
            <span>{wording.oneCapitalized}</span>
            <span>Inscription</span>
            <span>Classement final</span>
            {reorderable && <span className={styles.actionsHead}>Ordre</span>}
          </div>
          {rows.map((reg, index) => (
            <div
              key={reg.teamId}
              className={`${styles.row} ${reorderable ? styles.reorderable : ""}`}
            >
              <span className={styles.seed}>#{index + 1}</span>
              <EntrantLink className={styles.name} teamId={reg.teamId}>
                {reg.teamName}
              </EntrantLink>
              <span className={styles.muted}>{formatLocalDateTime(reg.registeredAt)}</span>
              <span className={styles.muted}>{reg.finalRank ?? "-"}</span>
              {reorderable && (
                <span className={styles.actions}>
                  <button
                    type="button"
                    ref={(node) => {
                      buttons.current.set(`${reg.teamId}:up`, node);
                    }}
                    className={styles.arrow}
                    aria-label={`Monter ${reg.teamName} d'un rang`}
                    title="Monter d'un rang"
                    disabled={busy || index === 0}
                    onClick={() => move(reg.teamId, "up")}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    ref={(node) => {
                      buttons.current.set(`${reg.teamId}:down`, node);
                    }}
                    className={styles.arrow}
                    aria-label={`Descendre ${reg.teamName} d'un rang`}
                    title="Descendre d'un rang"
                    disabled={busy || index === rows.length - 1}
                    onClick={() => move(reg.teamId, "down")}
                  >
                    ↓
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* `sr-only` global (`app/globals.css`) : la ligne qui bouge est le seul
          retour visuel d'un réordonnancement, il faut le dire à l'oreille. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
