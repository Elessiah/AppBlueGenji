"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatLocalDateTime } from "@/lib/shared/dates";
import { useToast } from "@/components/ui/toast";
import { Pill } from "@/components/cyber";
import {
  isSeedOrderEffective,
  moveInOrder,
  registrationsFollowRanking,
  seedingLockReason,
  seedingReorderNeedsConfirmation,
  seedingWindowState,
  SEEDING_SOURCE_LABELS,
  type SeedingLockReason,
} from "@/lib/shared/seeding";
import { fromBracketMatch } from "@/lib/shared/match-lock";
import {
  entrantRemovalBlockMessage,
  entrantRemovalBlockReason,
} from "@/lib/shared/entrant-removal";
import type { TournamentDetail } from "@/lib/shared/types";
import { useParticipantWording } from "../_lib/entrant-link";
import { EntrantName } from "./EntrantName";
import { mapError } from "../_lib/error-map";
import { useTournamentNow } from "@/lib/shared/hooks/useTournamentNow";
import { RemoveEntrantDialog } from "./RemoveEntrantDialog";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import {
  hiddenRegistrationCount,
  mustExpandToShow,
  registrationActionsColumn,
  removalNotice,
  visibleRegistrationCount,
} from "../_lib/registrations-list";
import styles from "./RegistrationsPanel.module.css";

interface RegistrationsPanelProps {
  detail: TournamentDetail;
  /** Le staff peut-il agir ? Faux quand le suivi du tournoi est en échec. */
  canAct: boolean;
  /**
   * Rafraîchit le détail après une écriture du staff — réordonnancement (l'aperçu
   * du plateau suit le nouvel ordre) ou retrait d'un engagé.
   */
  onChanged: () => void;
}

const LOCK_MESSAGES: Record<NonNullable<SeedingLockReason>, string> = {
  FINISHED: "Tournoi terminé : l'ordre n'a plus d'effet.",
  SCORES_ENTERED: "Un score a été saisi : l'ordre est désormais figé.",
  STARTED: "Le tournoi a commencé : l'ordre de départ est désormais figé.",
};

/**
 * Liste des inscrites, et — pour le staff — l'endroit où l'on en règle l'ordre.
 *
 * Cette liste **est** le seeding : son rang décide des appariements de la
 * première manche. Les commandes vivent donc ici, sur les lignes elles-mêmes, et
 * non dans un second tableau des mêmes équipes ailleurs dans la page : deux
 * listes identiques dont une seule se manipule, c'est celle qu'on ne trouve pas.
 *
 * **Des flèches, pas de glisser-déposer.** Sur téléphone, la poignée de
 * glissement se déclenchait en voulant faire défiler la liste : autant de
 * réordonnancements involontaires. Les flèches ↑ / ↓ ne réagissent qu'à un
 * appui franc (un `click`, que le navigateur n'émet pas pour un défilement) et
 * servent aussi le clavier.
 *
 * La fenêtre d'édition (jusqu'au coup d'envoi) est **déduite du
 * détail déjà reçu** — même règle pure que le serveur, `lib/shared/seeding.ts` —
 * plutôt que d'une requête à part : les commandes apparaissent avec la page, et
 * le serveur reste le juge, qui refuse en 409 une écriture devenue interdite.
 */
export function RegistrationsPanel({ detail, canAct, onChanged }: Readonly<RegistrationsPanelProps>) {
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

  // L'heure vient d'un minuteur posé sur la prochaine bascule d'état du tournoi,
  // et non d'un `Date.now()` au rendu : les deux fenêtres (ordre et retrait) se
  // ferment au coup d'envoi, une seconde connue d'avance qu'aucune écriture
  // n'annonce — le flux ne pousse un instantané que si quelqu'un a écrit. Sans
  // cela les commandes resteraient offertes après l'heure, pour un 409 au clic.
  const now = useTournamentNow(detail.card);
  const lockReason = seedingLockReason(
    seedingWindowState(detail.card, now),
    detail.matches.map(fromBracketMatch),
  );
  const staff = detail.isAdmin && canAct;
  const reorderable = staff && lockReason === null && detail.registrations.length > 1;

  // Le retrait a sa fonction (`lib/shared/entrant-removal.ts`), mais la même
  // borne que l'ordre de départ : le coup d'envoi, lu sur la même paire état
  // stocké / heure. Le réordonnancement exige en plus deux engagés.
  const removalBlock = entrantRemovalBlockReason(detail.card, now);
  const removable = staff && removalBlock === null;
  const showActions = reorderable || removable;

  // Deux refus, une seule cause : sur un tournoi terminé, « l'ordre n'a plus
  // d'effet » et « la liste est un palmarès » disent le même fait, et trois
  // paragraphes empilés au-dessus d'une liste ne se lisent plus. Le verrou de
  // l'ordre parle le premier, il garde la parole ; la phrase du retrait ne
  // s'affiche que lorsqu'elle apprend quelque chose qu'il ne dit pas.
  const removalNoticeReason = removalNotice(removalBlock, lockReason);

  // Engagé dont on confirme le retrait. La ligne est gardée en entier plutôt
  // que son seul identifiant : le dialogue reste monté pendant que le flux
  // redessine la page, et c'est le nom vu au moment du clic qu'il doit annoncer.
  const [removing, setRemoving] = useState<{ teamId: number; teamName: string } | null>(null);
  // Liste repliée aux premières lignes (`_lib/registrations-list.ts`).
  const [expanded, setExpanded] = useState(false);

  /** Écrit un ordre complet, avec aperçu optimiste et annonce vocale. */
  const applyOrder = useCallback(
    async (next: number[], teamId: number): Promise<boolean> => {
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
        return true;
      } catch (e) {
        // L'ordre du serveur fait foi : on lâche l'affichage optimiste plutôt que
        // de laisser croire à une écriture qui n'a pas eu lieu.
        setPending(null);
        showError(mapError((e as Error).message));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [detail.card.id, detail.registrations, onChanged, serverKey, showError, showSuccess],
  );

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
    const opposite = refocus.direction === "up" ? "down" : "up";
    const target = preferred && !preferred.disabled ? preferred : buttons.current.get(key(opposite));
    target?.focus();
    setRefocus(null);
  }, [refocus]);

  // Premier réordonnancement d'un tournoi seedé par le classement : il passe
  // l'ordre en manuel, sans retour — on le fait confirmer, une seule fois
  // (`seedingReorderNeedsConfirmation`). Le geste attend ici, pas encore joué.
  const [confirmingMove, setConfirmingMove] = useState<{ teamId: number; direction: "up" | "down" } | null>(null);
  const [manualConfirmed, setManualConfirmed] = useState(false);
  // La liste a bougé pendant la lecture (inscription, retrait, autre arbitre) :
  // le geste en attente visait un ordre qui n'existe plus — on le lâche plutôt
  // que d'écrire un déplacement que personne n'a vu.
  useEffect(() => {
    setConfirmingMove(null);
  }, [serverKey]);

  const performMove = async (teamId: number, direction: "up" | "down"): Promise<boolean> => {
    const next = moveInOrder(order, teamId, direction);
    if (mustExpandToShow(next.indexOf(teamId), expanded)) setExpanded(true);
    const done = await applyOrder(next, teamId);
    // Sur un refus, la modale de confirmation reste ouverte : le focus ne doit
    // pas repartir vers une flèche derrière elle.
    if (done) setRefocus({ teamId, direction });
    return done;
  };

  const source = detail.seedingSource;

  const move = async (teamId: number, direction: "up" | "down") => {
    // `manualConfirmed` couvre l'aller-retour : la source ne passe à `MANUAL`
    // qu'au rafraîchissement du détail, et un second clic ne doit pas redemander.
    if (!manualConfirmed && seedingReorderNeedsConfirmation(source)) {
      setConfirmingMove({ teamId, direction });
      return;
    }
    await performMove(teamId, direction);
  };
  const showsRealDraw = isSeedOrderEffective(source);
  // Avant le coup d'envoi, le serveur range déjà la liste selon le classement
  // du site : elle n'est plus l'ordre d'arrivée, mais le tirage prévu.
  const followsRanking = registrationsFollowRanking(source, detail.card.state);

  // Une seule cellule d'actions, présente dès que l'une des deux commandes est là.
  const actionsColumn = registrationActionsColumn(reorderable, removable);
  const gridClass = actionsColumn.grid ? styles[actionsColumn.grid] : "";
  // L'intitulé nomme ce que la colonne contient réellement : « Retrait » seul
  // sur un plateau d'un unique engagé, « Actions » sinon.
  const actionsLabel = actionsColumn.label;
  const seedingHint = reorderable
    ? "Ce rang décide des appariements de la première manche. Utilisez les flèches ci-contre pour le régler — jusqu'au coup d'envoi."
    : `Ce rang décidera des appariements de la première manche. Il se règlera ici dès qu'il y aura deux ${wording.manyEngaged}.`;

  const hiddenCount = hiddenRegistrationCount(rows.length);
  const visibleRows = rows.slice(0, visibleRegistrationCount(rows.length, expanded));

  return (
    <div className="ds-block">
      <div className="ds-section-title green" style={{ alignItems: "center" }}>
        <h2>Inscriptions · ordre de départ</h2>
        {staff && <Pill variant="blue">{SEEDING_SOURCE_LABELS[source]}</Pill>}
      </div>

      {staff && (
        <>
          <p className={styles.hint}>
            {lockReason !== null ? LOCK_MESSAGES[lockReason] : seedingHint}
          </p>
          {removalNoticeReason !== null && rows.length > 0 && (
            /* Le bouton « Retirer » a disparu, et rien sur la ligne ne dit
               pourquoi : la phrase vient du module pur, celle-là même que le
               serveur renverrait sur une écriture tardive. */
            <p className={styles.hint}>{entrantRemovalBlockMessage(removalNoticeReason)}</p>
          )}
          {followsRanking && rows.length > 0 && (
            <p className={styles.hint}>
              Rangées selon le classement du site : chaque nouvelle inscription prend sa
              place de cote. L&apos;ordre peut encore bouger d&apos;ici le lancement si des
              cotes changent ; réordonnez la liste pour le figer — votre ordre fera alors
              autorité.
            </p>
          )}
          {!showsRealDraw && !followsRanking && rows.length > 0 && (
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
        <div className={styles.table}>
          <div className={`${styles.row} ${styles.header} ${gridClass}`}>
            <span>Rang</span>
            <span>{wording.oneCapitalized}</span>
            <span>Inscription</span>
            <span>Classement final</span>
            {showActions && <span className={styles.actionsHead}>{actionsLabel}</span>}
          </div>
          {visibleRows.map((reg, index) => (
            <div key={reg.teamId} className={`${styles.row} ${gridClass}`}>
              <span className={styles.seed}>#{index + 1}</span>
              <EntrantName
                teamId={reg.teamId}
                name={reg.teamName}
                textClassName={styles.name}
              />
              <span className={styles.muted} data-label="Inscription">
                {formatLocalDateTime(reg.registeredAt)}
              </span>
              <span className={styles.muted} data-label="Classement final">
                {reg.finalRank ?? "-"}
              </span>
              {showActions && (
                <span className={styles.actions} data-tap-zone>
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

      {hiddenCount > 0 && (
        /* Un seul bouton dont le libellé change : deux boutons alternés
           perdraient le focus clavier à chaque bascule. */
        <div className={styles.showMoreRow}>
          <button
            type="button"
            className={styles.showMore}
            aria-expanded={expanded}
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? "Réduire la liste" : `Voir toute la liste (${hiddenCount} de plus)`}
          </button>
        </div>
      )}

      {/* `sr-only` global (`app/globals.css`) : la ligne qui bouge est le seul
          retour visuel d'un réordonnancement, il faut le dire à l'oreille. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {confirmingMove !== null && (
        <ConfirmActionDialog
          title="Fixer l'ordre de départ à la main ?"
          confirmLabel="Fixer l'ordre"
          pendingLabel="Enregistrement…"
          tone="primary"
          onClose={() => setConfirmingMove(null)}
          onConfirm={async () => {
            const done = await performMove(confirmingMove.teamId, confirmingMove.direction);
            if (done) setManualConfirmed(true);
            return done;
          }}
        >
          <p>
            L&apos;ordre de départ suit aujourd&apos;hui le classement du site. Le modifier le remplace,
            définitivement, par un ordre fixé par le staff : le classement ne réordonnera plus la liste, et
            les prochaines inscriptions s&apos;ajouteront en fin de liste.
          </p>
          <p>
            Aucun match n&apos;existe encore : les appariements du premier tour seront tirés de cet ordre au
            coup d&apos;envoi.
          </p>
        </ConfirmActionDialog>
      )}

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
