"use client";

import dynamic from "next/dynamic";
import { useEffect, useId, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { InfoHint } from "@/components/ui/info-hint";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { MATCH_LAUNCH_REFRESH_EVENT } from "@/lib/shared/match-launch";
import { resolveMatchMaps, roundMapsOf, type ResolvedMapSlot } from "@/lib/shared/round-maps";
import type { BracketMatch, TournamentDetail } from "@/lib/shared/types";
import { launchErrorText, useActionsText } from "../_lib/actions-text";
import { useRoundMapsText } from "../_lib/round-maps-text";
import { useErrorsText } from "../_lib/error-map";
import styles from "./MatchPage.module.css";

const RoundMapsDialog = dynamic(() => import("./RoundMapsDialog").then((m) => m.RoundMapsDialog), { ssr: false });

/**
 * Choix d'une carte dans un pool, par le staff ou une équipe en autogestion.
 * Valeur **optimiste** : la liste garde le choix envoyé (au lieu de revenir à
 * l'ancienne carte jusqu'à l'instantané suivant, d'où un second envoi possible
 * sur un flux lent) ; elle la relâche à l'arrivée de l'instantané ou sur refus.
 */
function MapPickSelect({ match, slot }: Readonly<{ match: Pick<BracketMatch, "id">; slot: ResolvedMapSlot }>) {
  const { t } = useRoundMapsText();
  const actionText = useActionsText();
  const errorsText = useErrorsText();
  const { showError, showSuccess } = useToast();
  const selectId = useId();
  const [busy, setBusy] = useState(false);
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const stored = slot.map ?? "";
  // L'instantané fait foi dès qu'il change : la valeur locale s'efface.
  useEffect(() => setOptimistic(null), [stored]);
  const shown = optimistic ?? stored;

  const pick = async (map: string) => {
    if (busy || map === shown) return;
    setBusy(true);
    setOptimistic(map);
    try {
      const response = await fetch(`/api/matches/${match.id}/map-pick`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slot: slot.number, map: map === "" ? null : map }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "UNKNOWN");
      showSuccess(t(map === "" ? "page.pickCleared" : "page.picked"));
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
}: Readonly<{ match: Pick<BracketMatch, "id">; slot: ResolvedMapSlot; canPick: boolean }>) {
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
        {slot.kind === "POOL" && canPick && <MapPickSelect match={match} slot={slot} />}
        {slot.kind === "POOL" && !canPick && slot.map !== null && <strong>{slot.map}</strong>}
        {slot.kind === "POOL" && !canPick && slot.map === null && (
          <span className={styles.muted}>{t("page.toChoose", { maps: slot.candidates.join(", ") })}</span>
        )}
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
  const slots = round ? resolveMatchMaps(round.slots, match.firstMap, match.mapPicks) : [];
  const titleId = useId();
  if (slots.length === 0 && !staff) return null;
  const reset = async (): Promise<boolean> => {
    try {
      const response = await fetch(`/api/admin/tournaments/${detail.card.id}/round-maps`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phaseId: match.phaseId, bracket: match.bracket, roundNumber: match.roundNumber, slots: [] }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "UNKNOWN");
      showSuccess(t("dialog.roundCleared"));
      window.dispatchEvent(new Event(MATCH_LAUNCH_REFRESH_EVENT));
      return true;
    } catch (error) {
      showError(launchErrorText(actionText, errorsText, (error as Error).message));
      return false;
    }
  };
  return (
    <div className={styles.roundMaps}>
      {slots.length > 0 && (
        <>
          <h3 id={titleId} className={styles.subTitle}>
            {t("page.mapsTitle")}
          </h3>
          <ol className={styles.mapSlots} aria-labelledby={titleId}>
            {slots.map((slot) => (
              <MapSlotLine key={slot.number} match={match} slot={slot} canPick={canPick} />
            ))}
          </ol>
        </>
      )}
      {staff && (
        <div className={styles.roundMapsActions}>
          <button type="button" className="btn ghost" onClick={() => setOpen(true)}>
            {t("page.configureMaps")}
          </button>
          {slots.length > 0 && (
            <>
              <button type="button" className="btn ghost" onClick={() => setResetting(true)}>
                {t("page.resetRound")}
              </button>
              <InfoHint id={`${titleId}-scale`} subject={t("page.resetRound")}>
                {t("page.scaleHint")}
              </InfoHint>
            </>
          )}
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
