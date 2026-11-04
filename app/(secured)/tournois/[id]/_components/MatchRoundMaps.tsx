"use client";

import dynamic from "next/dynamic";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { InfoHint } from "@/components/ui/info-hint";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { MATCH_LAUNCH_REFRESH_EVENT } from "@/lib/shared/match-launch";
import { resolveMatchMaps, roundMapsOf, roundTiebreakOf, type ResolvedMapSlot } from "@/lib/shared/round-maps";
import type { BracketMatch, TournamentDetail } from "@/lib/shared/types";
import { launchErrorText, useActionsText } from "../_lib/actions-text";
import { useRoundMapsText } from "../_lib/round-maps-text";
import { useErrorsText } from "../_lib/error-map";
import styles from "./MatchPage.module.css";

const RoundMapsDialog = dynamic(() => import("./RoundMapsDialog").then((m) => m.RoundMapsDialog), { ssr: false });

/**
 * Délai après lequel un choix optimiste est relâché même si aucun instantané
 * ne l'a remplacé : l'instantané ne part que quand le contenu change (même
 * version = rien d'envoyé), donc une carte revenue entre-temps à l'ancienne
 * valeur ne ferait jamais relâcher la valeur locale.
 */
const OPTIMISTIC_PICK_MS = 6000;

/**
 * Choix d'une carte dans un pool, par le staff ou une équipe en autogestion.
 * Valeur **optimiste** : la liste garde le choix envoyé (au lieu de revenir à
 * l'ancienne carte jusqu'à l'instantané suivant, d'où un second envoi possible
 * sur un flux lent) ; elle la relâche à l'arrivée d'un instantané (la carte
 * change, ou la version du détail change une fois l'envoi fini), après
 * {@link OPTIMISTIC_PICK_MS}, ou sur refus.
 */
function MapPickSelect({
  match,
  slot,
  snapshotVersion,
}: Readonly<{ match: Pick<BracketMatch, "id">; slot: ResolvedMapSlot; snapshotVersion: string }>) {
  const { t } = useRoundMapsText();
  const actionText = useActionsText();
  const errorsText = useErrorsText();
  const { showError, showSuccess } = useToast();
  const selectId = useId();
  const [busy, setBusy] = useState(false);
  // `since` : version du détail à la fin de l'envoi (`null` tant qu'il est en vol).
  const [optimistic, setOptimistic] = useState<{ map: string; since: string | null } | null>(null);
  const stored = slot.map ?? "";
  const versionRef = useRef(snapshotVersion);
  versionRef.current = snapshotVersion;
  // L'instantané fait foi dès qu'il change : la valeur locale s'efface.
  useEffect(() => setOptimistic(null), [stored]);
  // Un instantané arrivé depuis la fin de l'envoi (même si la carte est revenue
  // à l'ancienne valeur) : la valeur locale n'a plus de raison d'être.
  useEffect(() => {
    if (optimistic !== null && optimistic.since !== null && optimistic.since !== snapshotVersion) setOptimistic(null);
  }, [optimistic, snapshotVersion]);
  // Et sans instantané du tout (même version), elle expire.
  const settled = optimistic !== null && optimistic.since !== null;
  useEffect(() => {
    if (!settled) return;
    const timer = setTimeout(() => setOptimistic(null), OPTIMISTIC_PICK_MS);
    return () => clearTimeout(timer);
  }, [settled]);
  const shown = optimistic?.map ?? stored;

  const pick = async (map: string) => {
    if (busy || map === shown) return;
    setBusy(true);
    setOptimistic({ map, since: null });
    try {
      const response = await fetch(`/api/matches/${match.id}/map-pick`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slot: slot.number, map: map === "" ? null : map }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "UNKNOWN");
      showSuccess(t(map === "" ? "page.pickCleared" : "page.picked"));
      setOptimistic({ map, since: versionRef.current });
      window.dispatchEvent(new Event(MATCH_LAUNCH_REFRESH_EVENT));
    } catch (error) {
      setOptimistic(null);
      showError(launchErrorText(actionText, errorsText, (error as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className={`field ${styles.mapPick}`}>
      <label htmlFor={selectId} className="sr-only">
        {t("page.pickLabel", { number: slot.number })}
      </label>
      <select
        id={selectId}
        value={shown}
        aria-busy={busy || undefined}
        aria-disabled={busy || undefined}
        onChange={(event) => void pick(event.target.value)}
      >
        <option value="">{t("page.pickNone")}</option>
        {/* Un choix sorti du pool depuis reste lisible plutôt que perdu en silence. */}
        {slot.map !== null && !slot.candidates.includes(slot.map) && <option value={slot.map}>{slot.map}</option>}
        {slot.candidates.map((candidate) => (
          <option key={candidate} value={candidate}>
            {candidate}
          </option>
        ))}
      </select>
    </span>
  );
}

/**
 * Une carte du tour : imposée, choisie, ou « à choisir parmi … » — ce dernier
 * seulement sans liste de choix (la liste montre déjà le pool).
 */
function MapSlotLine({
  match,
  slot,
  canPick,
  snapshotVersion,
}: Readonly<{ match: Pick<BracketMatch, "id">; slot: ResolvedMapSlot; canPick: boolean; snapshotVersion: string }>) {
  const { t } = useRoundMapsText();
  return (
    <li className={styles.mapSlot}>
      <span className={styles.mapNumber}>{t("page.mapN", { number: slot.number })}</span>
      <span className={styles.mapValue}>
        {slot.kind === "IMPOSED" && (
          <>
            <strong>{slot.map}</strong> <span className="pill pill-neutral">{t("page.imposed")}</span>
          </>
        )}
        {slot.kind === "POOL" && canPick && <MapPickSelect match={match} slot={slot} snapshotVersion={snapshotVersion} />}
        {slot.kind === "POOL" && !canPick && slot.map !== null && <strong>{slot.map}</strong>}
        {slot.kind === "POOL" && !canPick && slot.map === null && (
          <span className={styles.muted}>{t("page.toChoose", { maps: slot.candidates.join(", ") })}</span>
        )}
      </span>
    </li>
  );
}

/** Map de départage du tour : la dernière ligne de la liste des cartes, lue avec elle. */
function TiebreakLine({ id, map }: Readonly<{ id: string; map: string }>) {
  const { t } = useRoundMapsText();
  return (
    <li className={`${styles.mapSlot} ${styles.tiebreakLine}`}>
      <span className={styles.mapNumber}>{t("page.tiebreak")}</span>
      <span className={styles.mapValue}>
        <strong>{map}</strong>{" "}
        <InfoHint id={id} subject={t("page.tiebreak")}>
          {t("page.tiebreakHint")}
        </InfoHint>
      </span>
    </li>
  );
}

/**
 * Cartes du tour d'un match (`docs/features/ROUND_MAPS.md`) : la liste
 * ordonnée des créneaux réglés pour son tour du tournoi, le choix dans un pool
 * pour qui le peut, et pour le staff « Paramétrer les cartes du tour » et
 * « Réinitialiser le tour » (rend la saisie de la carte match par match). Sans
 * réglage, seule l'entrée du staff paraît.
 */
export function MatchRoundMaps({
  detail,
  match,
  canPick,
  staff,
}: Readonly<{ detail: TournamentDetail; match: BracketMatch; canPick: boolean; staff: boolean }>) {
  const { t } = useRoundMapsText();
  const actionText = useActionsText();
  const errorsText = useErrorsText();
  const { showError, showSuccess } = useToast();
  const [open, setOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const rules = detail.mapRules;
  const round = roundMapsOf(rules.rounds, match);
  // Recalculé quand le réglage ou les choix du match changent, pas à chaque rendu de la page.
  const slots = useMemo(
    () => (round ? resolveMatchMaps(round.slots, match.firstMap, match.mapPicks) : []),
    [round, match.firstMap, match.mapPicks],
  );
  // Map de départage du tour (play-offs en vrai best of 3) : l'instantané ne
  // porte que celles des tours éligibles.
  const tiebreak = roundTiebreakOf(rules.tiebreaks, match);
  const titleId = useId();
  if (slots.length === 0 && tiebreak === null && !staff) return null;
  const reset = async (): Promise<boolean> => {
    try {
      const response = await fetch(`/api/admin/tournaments/${detail.card.id}/round-maps`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phaseId: match.phaseId, bracket: match.bracket, roundNumber: match.roundNumber, slots: [] }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "UNKNOWN");
      // La map de départage reste : le toast le dit, il ne promet pas un tour entièrement vidé.
      showSuccess(t(tiebreak === null ? "dialog.roundCleared" : "dialog.roundClearedTiebreakKept"));
      window.dispatchEvent(new Event(MATCH_LAUNCH_REFRESH_EVENT));
      return true;
    } catch (error) {
      showError(launchErrorText(actionText, errorsText, (error as Error).message));
      return false;
    }
  };
  return (
    <div className={styles.roundMaps}>
      {(slots.length > 0 || tiebreak !== null) && (
        <h3 id={titleId} className={styles.subTitle}>
          {t("page.mapsTitle")}
        </h3>
      )}
      {slots.length > 0 && (
        <ol className={styles.mapSlots} aria-labelledby={titleId}>
          {slots.map((slot) => (
            <MapSlotLine key={slot.number} match={match} slot={slot} canPick={canPick} snapshotVersion={detail.version} />
          ))}
          {tiebreak !== null && <TiebreakLine id={`${titleId}-tiebreak`} map={tiebreak} />}
        </ol>
      )}
      {slots.length === 0 && tiebreak !== null && (
        <ol className={styles.mapSlots} aria-labelledby={titleId}>
          <TiebreakLine id={`${titleId}-tiebreak`} map={tiebreak} />
        </ol>
      )}
      {staff && (
        <div className={styles.roundMapsActions}>
          <button type="button" className="btn ghost" onClick={() => setOpen(true)}>
            {t("page.configureMaps")}
          </button>
          {/* Toujours monté : après une réinitialisation réussie il n'y a plus rien à
              réinitialiser, mais un bouton démonté laisserait tomber le focus sur le <body>. */}
          <button
            type="button"
            className="btn ghost"
            aria-disabled={slots.length === 0 || undefined}
            onClick={() => {
              if (slots.length > 0) setResetting(true);
            }}
          >
            {t("page.resetRound")}
          </button>
          <InfoHint id={`${titleId}-scale`} subject={t("page.resetRound")}>
            {t("page.scaleHint")}
          </InfoHint>
        </div>
      )}
      {resetting && (
        <ConfirmActionDialog
          title={t("dialog.resetConfirm.title")}
          confirmLabel={t("dialog.resetConfirm.confirm")}
          pendingLabel={t("dialog.pending")}
          tone="danger"
          onClose={() => setResetting(false)}
          onConfirm={reset}
        >
          <p>{t("page.resetConfirmBody")}</p>
        </ConfirmActionDialog>
      )}
      {open && (
        <RoundMapsDialog
          detail={detail}
          initialRound={{ phaseId: match.phaseId, bracket: match.bracket, roundNumber: match.roundNumber }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * Bloc « Cartes et bans » de la fiche, pour le staff (permission
 * `tournaments`) : ouvre la fenêtre de réglage sur le premier tour du tournoi.
 */
export function RoundMapsPanel({ detail }: Readonly<{ detail: TournamentDetail }>) {
  const { t } = useRoundMapsText();
  const [open, setOpen] = useState(false);
  const titleId = useId();
  return (
    <section className={`ds-block ${styles.block}`} aria-labelledby={titleId}>
      <div className="ds-section-title blue">
        <h2 id={titleId}>{t("sheet.title")}</h2>
        <InfoHint id={`${titleId}-hint`} subject={t("sheet.title")}>
          {t("sheet.lead")}
        </InfoHint>
      </div>
      <div>
        <button type="button" className="btn ghost" onClick={() => setOpen(true)}>
          {t("sheet.open")}
        </button>
      </div>
      {open && <RoundMapsDialog detail={detail} onClose={() => setOpen(false)} />}
    </section>
  );
}
