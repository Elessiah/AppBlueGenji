"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import {
  entrantRemovalBlockMessage,
  entrantRemovalBlockReason,
} from "@/lib/shared/entrant-removal";
import type { TournamentDetail } from "@/lib/shared/types";
import { EntrantLink, useParticipantWording } from "../_lib/entrant-link";
import { mapError } from "../_lib/error-map";
import { useSeedingDrag } from "../_hooks/useSeedingDrag";
import { RemoveEntrantDialog } from "./RemoveEntrantDialog";
import styles from "./RegistrationsPanel.module.css";

interface RegistrationsPanelProps {
  detail: TournamentDetail;
  /** Le staff peut-il agir ? Faux quand le suivi du tournoi est en échec. */
  canAct: boolean;
  /**
   * Rafraîchit le détail après une écriture du staff — réordonnancement (le
   * plateau est régénéré) ou retrait d'un engagé.
   */
  onChanged: () => void;
}

const LOCK_MESSAGES: Record<NonNullable<SeedingLockReason>, string> = {
  FINISHED: "Tournoi terminé : l'ordre n'a plus d'effet.",
  SCORES_ENTERED: "Un score a été saisi : l'ordre est désormais figé.",
};

/**
 * Liste des inscrites, et — pour le staff — l'endroit où l'on en règle l'ordre.
 *
 * Cette liste **est** le seeding : son rang décide des appariements de la
 * première manche. Les commandes vivent donc ici, sur les lignes elles-mêmes, et
 * non dans un second tableau des mêmes équipes ailleurs dans la page : deux
 * listes identiques dont une seule se manipule, c'est celle qu'on ne trouve pas.
 *
 * **Deux gestes pour un même ordre.** La poignée de gauche se glisse : c'est le
 * chemin rapide, un seul geste amenant le trentième rang en tête. Les flèches de
 * droite restent le chemin du clavier — un glisser-déposer n'a pas d'équivalent
 * au clavier, et les retirer priverait de l'ordre de départ qui ne tient pas une
 * souris. Les deux écrivent par la même route, avec le même aperçu optimiste.
 *
 * La fenêtre d'édition (jusqu'à la première saisie de score) est **déduite du
 * détail déjà reçu** — même règle pure que le serveur, `lib/shared/seeding.ts` —
 * plutôt que d'une requête à part : les commandes apparaissent avec la page, et
 * le serveur reste le juge, qui refuse en 409 une écriture devenue interdite.
 */
export function RegistrationsPanel({ detail, canAct, onChanged }: RegistrationsPanelProps) {
  const { showError, showSuccess } = useToast();
  const wording = useParticipantWording();
  const [busy, setBusy] = useState(false);

  // Ordre affiché en attendant que le flux rapporte l'écriture : sans lui, la
  // ligne resterait en place le temps d'un aller-retour et le geste semblerait
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

  const lockReason = seedingLockReason(detail.card.state, detail.matches.map(fromBracketMatch));
  const staff = detail.isAdmin && canAct;
  const reorderable = staff && lockReason === null && detail.registrations.length > 1;

  // Le retrait a sa **propre** fenêtre, plus courte que celle de l'ordre de
  // départ : celui-ci reste réglable jusqu'à la première saisie de score, donc
  // encore après le coup d'envoi, alors qu'un engagé ne se retire que tant que
  // le tirage n'est pas fait (`lib/shared/entrant-removal.ts`). Les deux
  // commandes partagent une cellule mais pas une condition.
  const removalBlock = entrantRemovalBlockReason(detail.card);
  const removable = staff && removalBlock === null;
  const showActions = reorderable || removable;

  // Deux refus, une seule cause : sur un tournoi terminé, « l'ordre n'a plus
  // d'effet » et « la liste est un palmarès » disent le même fait, et trois
  // paragraphes empilés au-dessus d'une liste ne se lisent plus. Le verrou de
  // l'ordre parle le premier, il garde la parole ; la phrase du retrait ne
  // s'affiche que lorsqu'elle apprend quelque chose — typiquement sur un
  // tournoi lancé, où l'ordre reste réglable mais où le retrait, lui, est clos.
  const removalNotice =
    removalBlock !== null
    && !(lockReason === "FINISHED" && removalBlock === "ENTRANT_REMOVAL_TOURNAMENT_FINISHED")
      ? removalBlock
      : null;

  // Engagé dont on confirme le retrait. La ligne est gardée en entier plutôt
  // que son seul identifiant : le dialogue reste monté pendant que le flux
  // redessine la page, et c'est le nom vu au moment du clic qu'il doit annoncer.
  const [removing, setRemoving] = useState<{ teamId: number; teamName: string } | null>(null);

  /** Écrit un ordre complet, avec aperçu optimiste et annonce vocale. */
  const applyOrder = useCallback(
    async (next: number[], teamId: number) => {
      const name = detail.registrations.find((reg) => reg.teamId === teamId)?.teamName ?? "";
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
        onChanged();
      } catch (e) {
        // L'ordre du serveur fait foi : on lâche l'affichage optimiste plutôt que
        // de laisser croire à une écriture qui n'a pas eu lieu.
        setPending(null);
        showError(mapError((e as Error).message));
      } finally {
        setBusy(false);
      }
    },
    [detail.card.id, detail.registrations, onChanged, serverKey, showError, showSuccess],
  );

  const onDrop = useCallback(
    (next: number[], teamId: number) => {
      void applyOrder(next, teamId);
    },
    [applyOrder],
  );

  const drag = useSeedingDrag({ order, enabled: reorderable && !busy, onDrop });

  // L'aperçu du geste prime sur l'aperçu de l'écriture : tant qu'on tire une
  // ligne, c'est la position sous le pointeur qui doit s'afficher.
  const displayOrder = drag.previewOrder ?? order;
  const rows = displayOrder.flatMap((teamId) => {
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

  const move = async (teamId: number, direction: "up" | "down") => {
    await applyOrder(moveInOrder(order, teamId, direction), teamId);
    setRefocus({ teamId, direction });
  };

  const source = detail.seedingSource;
  const showsRealDraw = isSeedOrderEffective(source);

  // Une seule cellule d'actions, trois gabarits de grille : la poignée n'existe
  // qu'avec le réordonnancement, la cellule d'actions dès que l'une des deux
  // commandes est là. Les gabarits sont exclusifs — deux classes de même poids
  // sur la même propriété se départageraient par l'ordre de la feuille, ce qui
  // n'est pas une règle qu'on veut avoir à relire.
  const gridClass = reorderable ? styles.reorderable : removable ? styles.withActions : "";
  // L'intitulé nomme ce que la colonne contient réellement, et il n'y a pas
  // toujours les deux : « Ordre » seul sur un tournoi lancé sans score,
  // « Retrait » seul sur un plateau d'un unique engagé.
  const actionsLabel = reorderable && removable ? "Actions" : reorderable ? "Ordre" : "Retrait";

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
                ? "Ce rang décide des appariements de la première manche. Glissez une ligne par sa poignée pour la déplacer d'un bloc, ou utilisez les flèches ci-contre — jusqu'à la première saisie de score."
                : `Ce rang décidera des appariements de la première manche. Il se règlera ici dès qu'il y aura deux ${wording.manyEngaged}.`}
          </p>
          {removalNotice !== null && rows.length > 0 && (
            /* Le bouton « Retirer » a disparu, et rien sur la ligne ne dit
               pourquoi : la phrase vient du module pur, celle-là même que le
               serveur renverrait sur une écriture tardive. */
            <p className={styles.hint}>{entrantRemovalBlockMessage(removalNotice)}</p>
          )}
          {!showsRealDraw && rows.length > 0 && (
            <p className={styles.warning}>
              Ce format seede depuis le classement du site : les rangs ci-dessous ne sont
              que l&apos;ordre d&apos;arrivée des inscriptions et ne seront pas ceux du
              tirage. Réordonnez la liste pour imposer votre propre ordre — il fera alors
              autorité.
            </p>
          )}
        </>
      )}

      {rows.length === 0 ? (
        <p className={styles.empty}>Aucune inscription pour le moment.</p>
      ) : (
        <div className={`${styles.table} ${drag.draggingTeamId !== null ? styles.dragging : ""}`}>
          <div className={`${styles.row} ${styles.header} ${gridClass}`}>
            {reorderable && <span aria-hidden="true" />}
            <span>Rang</span>
            <span>{wording.oneCapitalized}</span>
            <span>Inscription</span>
            <span>Classement final</span>
            {showActions && <span className={styles.actionsHead}>{actionsLabel}</span>}
          </div>
          {rows.map((reg, index) => (
            <div
              key={reg.teamId}
              ref={drag.setRowRef(reg.teamId)}
              className={[
                styles.row,
                gridClass,
                drag.draggingTeamId === reg.teamId ? styles.dragged : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {reorderable && (
                /* Poignée purement pointeur : le clavier a les flèches, et un
                   bouton qui ne répondrait pas à la barre d'espace serait un
                   piège. D'où un `<span>` décoratif plutôt qu'un contrôle. */
                <span
                  aria-hidden="true"
                  className={styles.grip}
                  title="Glisser pour réordonner"
                  {...drag.handleProps(reg.teamId)}
                >
                  ⠿
                </span>
              )}
              <span className={styles.seed}>#{index + 1}</span>
              <EntrantLink className={styles.name} teamId={reg.teamId}>
                {reg.teamName}
              </EntrantLink>
              <span className={styles.muted}>{formatLocalDateTime(reg.registeredAt)}</span>
              <span className={styles.muted}>{reg.finalRank ?? "-"}</span>
              {showActions && (
                <span className={styles.actions}>
                  {reorderable && (
                    <>
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
                    </>
                  )}
                  {removable && (
                    /* Le nom est dans le libellé accessible, pas seulement dans
                       la ligne : trente boutons « Retirer » identiques ne se
                       distinguent pas à la voix ni au lecteur d'écran. */
                    <button
                      type="button"
                      className={styles.remove}
                      aria-label={`Retirer ${reg.teamName} du tournoi`}
                      title="Retirer du tournoi"
                      disabled={busy}
                      onClick={() => setRemoving({ teamId: reg.teamId, teamName: reg.teamName })}
                    >
                      Retirer
                    </button>
                  )}
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

      {removing !== null && (
        <RemoveEntrantDialog
          card={detail.card}
          teamId={removing.teamId}
          entrantName={removing.teamName}
          onClose={() => setRemoving(null)}
          onRemoved={() => {
            setRemoving(null);
            setAnnouncement(`${removing.teamName} ne figure plus parmi les engagés.`);
            onChanged();
          }}
        />
      )}
    </div>
  );
}
