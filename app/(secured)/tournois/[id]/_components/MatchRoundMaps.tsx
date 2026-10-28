"use client";

import dynamic from "next/dynamic";
import { useId, useState } from "react";
import { useTournamentPageText } from "@/components/i18n/tournament-page-text";
import { useToast } from "@/components/ui/toast";
import { InfoHint } from "@/components/ui/info-hint";
import { MATCH_LAUNCH_REFRESH_EVENT } from "@/lib/shared/match-launch";
import { resolveMatchMaps, roundMapsOf, type ResolvedMapSlot, type TournamentMapRules } from "@/lib/shared/round-maps";
import type { BracketMatch, TournamentDetail } from "@/lib/shared/types";
import { launchErrorText, useActionsText } from "../_lib/actions-text";
import { useErrorsText } from "../_lib/error-map";
import styles from "./MatchPage.module.css";

const RoundMapsDialog = dynamic(() => import("./RoundMapsDialog").then((m) => m.RoundMapsDialog), { ssr: false });

/** Choix d'une carte dans un pool, par le staff ou une équipe en autogestion. */
function MapPickSelect({ match, slot }: Readonly<{ match: Pick<BracketMatch, "id">; slot: ResolvedMapSlot }>) {
  const { t } = useTournamentPageText();
  const actionText = useActionsText();
  const errorsText = useErrorsText();
  const { showError, showSuccess } = useToast();
  const selectId = useId();
  const [busy, setBusy] = useState(false);

  const pick = async (map: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/matches/${match.id}/map-pick`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slot: slot.number, map: map === "" ? null : map }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "UNKNOWN");
      showSuccess(t(map === "" ? "matchPage.pickCleared" : "matchPage.picked"));
      window.dispatchEvent(new Event(MATCH_LAUNCH_REFRESH_EVENT));
    } catch (error) {
      showError(launchErrorText(actionText, errorsText, (error as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className={`field ${styles.mapPick}`}>
      <label htmlFor={selectId} className="sr-only">
        {t("matchPage.pickLabel", { number: slot.number })}
      </label>
      <select
        id={selectId}
        value={slot.map ?? ""}
        aria-busy={busy || undefined}
        aria-disabled={busy || undefined}
        onChange={(event) => void pick(event.target.value)}
      >
        <option value="">{t("matchPage.pickNone")}</option>
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

/** Une carte du round : imposée, choisie, ou « à choisir parmi … ». */
function MapSlotLine({
  match,
  slot,
  rules,
  canPick,
}: Readonly<{ match: Pick<BracketMatch, "id">; slot: ResolvedMapSlot; rules: TournamentMapRules; canPick: boolean }>) {
  const { t } = useTournamentPageText();
  const loserPick = slot.kind === "POOL" && slot.number > 1 && rules.nextPick === "LOSER";
  return (
    <li className={styles.mapSlot}>
      <span className={styles.mapNumber}>{t("matchPage.mapN", { number: slot.number })}</span>
      <span className={styles.mapValue}>
        {slot.kind === "IMPOSED" && (
          <>
            <strong>{slot.map}</strong> <span className="pill pill-neutral">{t("matchPage.imposed")}</span>
          </>
        )}
        {slot.kind === "POOL" && canPick && <MapPickSelect match={match} slot={slot} />}
        {slot.kind === "POOL" && !canPick && slot.map !== null && <strong>{slot.map}</strong>}
        {slot.kind === "POOL" && (canPick || slot.map === null) && (
          <span className={styles.muted}>{t("matchPage.toChoose", { maps: slot.candidates.join(", ") })}</span>
        )}
        {loserPick && <span className={styles.muted}>{t("matchPage.loserPick")}</span>}
      </span>
    </li>
  );
}

/**
 * Cartes du round d'un match (`docs/features/ROUND_MAPS.md`) : la liste
 * ordonnée des créneaux réglés pour sa manche, le choix dans un pool pour qui
 * le peut, et l'entrée « Paramétrer les cartes du round » du staff. Sans
 * réglage, seule l'entrée du staff paraît.
 */
export function MatchRoundMaps({
  detail,
  match,
  canPick,
  staff,
}: Readonly<{ detail: TournamentDetail; match: BracketMatch; canPick: boolean; staff: boolean }>) {
  const { t } = useTournamentPageText();
  const [open, setOpen] = useState(false);
  const rules = detail.mapRules;
  const round = roundMapsOf(rules.rounds, match);
  const slots = round ? resolveMatchMaps(round.slots, match.firstMap, match.mapPicks) : [];
  const titleId = useId();
  if (slots.length === 0 && !staff) return null;
  return (
    <div className={styles.roundMaps}>
      {slots.length > 0 && (
        <>
          <h3 id={titleId} className={styles.subTitle}>
            {t("matchPage.mapsTitle")}
          </h3>
          <ol className={styles.mapSlots} aria-labelledby={titleId}>
            {slots.map((slot) => (
              <MapSlotLine key={slot.number} match={match} slot={slot} rules={rules} canPick={canPick} />
            ))}
          </ol>
        </>
      )}
      {staff && (
        <div>
          <button type="button" className="btn ghost" onClick={() => setOpen(true)}>
            {t("matchPage.configureMaps")}
          </button>
        </div>
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
 * `tournaments`) : ouvre la fenêtre de réglage sur la première manche.
 */
export function RoundMapsPanel({ detail }: Readonly<{ detail: TournamentDetail }>) {
  const { t } = useTournamentPageText();
  const [open, setOpen] = useState(false);
  const titleId = useId();
  return (
    <section className={`ds-block ${styles.block}`} aria-labelledby={titleId}>
      <div className="ds-section-title blue">
        <h2 id={titleId}>{t("page.roundMaps.title")}</h2>
        <InfoHint id={`${titleId}-hint`} subject={t("page.roundMaps.title")}>
          {t("page.roundMaps.lead")}
        </InfoHint>
      </div>
      <div>
        <button type="button" className="btn ghost" onClick={() => setOpen(true)}>
          {t("page.roundMaps.open")}
        </button>
      </div>
      {open && <RoundMapsDialog detail={detail} onClose={() => setOpen(false)} />}
    </section>
  );
}
