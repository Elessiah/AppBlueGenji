"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatLocalDateTime } from "@/lib/shared/dates";
import { Pill } from "@/components/cyber";
import {
  moveInOrder,
  registrationsFollowFrozenDraw,
  registrationsFollowRanking,
  seedingLockReason,
  seedingReorderNeedsConfirmation,
  seedingWindowState,
  type SeedingLockReason,
} from "@/lib/shared/seeding";
import { fromBracketMatch } from "@/lib/shared/match-lock";
import { entrantRemovalBlockReason } from "@/lib/shared/entrant-removal";
import type { TournamentDetail } from "@/lib/shared/types";
import { toParticipantType } from "@/lib/shared/participants";
import { EntrantName } from "./EntrantName";
import { useMapError } from "../_lib/error-map";
import { useActionsText } from "../_lib/actions-text";
import { useTournamentNow } from "@/lib/shared/hooks/useTournamentNow";
import { RemoveEntrantDialog } from "./RemoveEntrantDialog";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import {
  hiddenRegistrationCount,
  mustExpandToShow,
  registrationActionsColumn,
  removalNotice,
  visibleRegistrationCount,
} from "../_lib/registrations-list";
import { PodiumTiersOffWhen } from "@/components/podium-tiers";
import styles from "./RegistrationsPanel.module.css";
import { useTournamentPageText } from "@/components/i18n/tournament-page-text";
import { useToast } from "@/components/ui/toast";
import { pageDateTime, participantText } from "@/lib/shared/tournament-page-text";

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

/** Clé du verrou de l'ordre (`registrations.lock.*`). */
const LOCK_KEYS = {
  FINISHED: "registrations.lock.FINISHED",
  SCORES_ENTERED: "registrations.lock.SCORES_ENTERED",
  STARTED: "registrations.lock.STARTED",
} as const satisfies Record<NonNullable<SeedingLockReason>, string>;

/** Intitulé de la colonne d'actions (`registrationActionsColumn`) → sa clé. */
const COLUMN_KEYS = {
  Actions: "registrations.column.actions",
  Ordre: "registrations.column.order",
  Retrait: "registrations.column.removal",
} as const;

/** Rang figé au coup d'envoi ; « — » pour une engagée absente du tirage. */
function frozenSeedLabel(seed: number | null): string {
  return seed === null ? "—" : `#${seed}`;
}

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
  const mapError = useMapError();
  const text = useTournamentPageText();
  const { t } = text;
  // Ordre de départ et retraits (outils du staff posés sur la fiche) : lot 8b.
  const a = useActionsText().t;
  const registeredAt = (iso: string) =>
    text.locale === "fr"
      ? formatLocalDateTime(iso)
      : pageDateTime(iso, text.locale, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
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
        showSuccess(a("registrations.reordered"));
        // Tournure neutre : le genre de « équipe » et de « joueur » diverge.
        setAnnouncement(
          a("registrations.newRank", { name, rank: String(next.indexOf(teamId) + 1), total: String(next.length) }),
        );
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
    [a, detail.card.id, detail.registrations, mapError, onChanged, serverKey, showError, showSuccess],
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
  // Réordonnancement retiré entre-temps : la confirmation en attente est
  // oubliée, pour ne pas se rouvrir seule à son retour.
  if (confirmingMove !== null && !reorderable) setConfirmingMove(null);
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
  // Une fois lancé, le serveur range la liste par les têtes de série figées au
  // coup d'envoi (`orderByFrozenSeeds`) : le rang montré est ce `seed`, que des
  // retraits peuvent laisser troué, et « — » pour une engagée sans rang figé.
  const followsFrozenDraw = registrationsFollowFrozenDraw(source, detail.card.state);
  // Avant le coup d'envoi, le serveur range déjà la liste selon le classement
  // du site : elle n'est plus l'ordre d'arrivée, mais le tirage prévu.
  const followsRanking = registrationsFollowRanking(source, detail.card.state);

  // Une seule cellule d'actions, présente dès que l'une des deux commandes est là.
  const actionsColumn = registrationActionsColumn(reorderable, removable);
  const gridClass = actionsColumn.grid ? styles[actionsColumn.grid] : "";
  // L'intitulé nomme ce que la colonne contient réellement : « Retrait » seul
  // sur un plateau d'un unique engagé, « Actions » sinon.
  const actionsLabel = a(COLUMN_KEYS[actionsColumn.label]);
  const seedingHint = reorderable
    ? a("registrations.seedingHint")
    : a(`registrations.seedingHintWaiting.${toParticipantType(detail.card.participantType)}`);

  const hiddenCount = hiddenRegistrationCount(rows.length);
  const visibleRows = rows.slice(0, visibleRegistrationCount(rows.length, expanded));

  return (
    <div className="ds-block">
      <div className="ds-section-title green" style={{ alignItems: "center" }}>
        <h2>{t("registrations.title")}</h2>
        {staff && <Pill variant="accent">{a(`registrations.seedingSource.${source}`)}</Pill>}
      </div>

      {staff && (
        <>
          <p className={styles.hint}>
            {lockReason !== null ? a(LOCK_KEYS[lockReason]) : seedingHint}
          </p>
          {removalNoticeReason !== null && rows.length > 0 && (
            /* Le bouton « Retirer » a disparu, et rien sur la ligne ne dit
               pourquoi : la phrase est celle-là même que le serveur renverrait
               sur une écriture tardive (code du module pur). */
            <p className={styles.hint}>{mapError(removalNoticeReason)}</p>
          )}
          {followsRanking && rows.length > 0 && (
            <p className={styles.hint}>{a("registrations.followsRanking")}</p>
          )}
          {followsFrozenDraw && rows.length > 0 && (
            <p className={styles.hint}>{a("registrations.followsFrozenDraw")}</p>
          )}
        </>
      )}

      {/* Mode staff (têtes de série, retraits) : un outil, noms sans marche. */}
      {rows.length === 0 ? (
        <p className={styles.empty}>{t("registrations.empty")}</p>
      ) : (
        <PodiumTiersOffWhen off={showActions}>
        <div className={styles.table}>
          <div className={`${styles.row} ${styles.header} ${gridClass}`}>
            <span>{t("registrations.rank")}</span>
            <span>{participantText(text, detail.card.participantType, "oneCapitalized")}</span>
            <span>{t("registrations.registeredAt")}</span>
            <span>{t("registrations.finalRank")}</span>
            {showActions && <span className={styles.actionsHead}>{actionsLabel}</span>}
          </div>
          {visibleRows.map((reg, index) => (
            <div key={reg.teamId} className={`${styles.row} ${gridClass}`}>
              <span className={styles.seed}>
                {followsFrozenDraw ? frozenSeedLabel(reg.seed) : `#${index + 1}`}
              </span>
              <EntrantName
                teamId={reg.teamId}
                name={reg.teamName}
                textClassName={styles.name}
              />
              <span className={styles.muted} data-label={t("registrations.registeredAt")}>
                {registeredAt(reg.registeredAt)}
              </span>
              <span className={styles.muted} data-label={t("registrations.finalRank")}>
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
                        aria-label={a("registrations.moveUpAria", { name: reg.teamName })}
                        title={a("registrations.moveUpTitle")}
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
                        aria-label={a("registrations.moveDownAria", { name: reg.teamName })}
                        title={a("registrations.moveDownTitle")}
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
                      aria-label={a("registrations.removeAria", { name: reg.teamName })}
                      title={a("registrations.removeTitle")}
                      disabled={busy}
                      onClick={() => setRemoving({ teamId: reg.teamId, teamName: reg.teamName })}
                    >
                      {a("registrations.remove")}
                    </button>
                  )}
                </span>
              )}
            </div>
          ))}
        </div>
        </PodiumTiersOffWhen>
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
            {expanded ? t("registrations.collapse") : t("registrations.showAll", { count: String(hiddenCount) })}
          </button>
        </div>
      )}

      {/* `sr-only` global (`app/globals.css`) : la ligne qui bouge est le seul
          retour visuel d'un réordonnancement, il faut le dire à l'oreille. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {/* `reorderable` : passé le coup d'envoi (ou sans droit), la modale
          disparaît avec les flèches au lieu d'offrir un 409 en boucle. */}
      {confirmingMove !== null && reorderable && (
        <ConfirmActionDialog
          title={a("registrations.manualConfirm.title")}
          confirmLabel={a("registrations.manualConfirm.confirm")}
          pendingLabel={a("registrations.manualConfirm.pending")}
          tone="primary"
          onClose={() => setConfirmingMove(null)}
          onConfirm={async () => {
            const done = await performMove(confirmingMove.teamId, confirmingMove.direction);
            if (done) setManualConfirmed(true);
            return done;
          }}
        >
          <p>{a("registrations.manualConfirm.body")}</p>
          <p>{a("registrations.manualConfirm.draw")}</p>
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
            setAnnouncement(a("registrations.removed", { name: removing.teamName }));
            onChanged();
          }}
        />
      )}
    </div>
  );
}
