"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PRIVACY_POLICY_PATH } from "@/components/privacy/PrivacyChangesModal";
import { useToast } from "@/components/ui/toast";
import { useClientPower } from "@/lib/shared/hooks/useClientPower";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import { tournamentMatchHref } from "@/lib/shared/match-anchor";
import {
  launchErrorMessage,
  launchModalKey,
  launchModalWaits,
  MATCH_LAUNCH_OPEN_EVENT,
  nextLaunchMatchId,
  MATCH_LAUNCH_REFRESH_EVENT,
  readyCount,
  type LaunchCaster,
  type LaunchContact,
  type LaunchSide,
  type MatchLaunchInfo,
} from "@/lib/shared/match-launch";
import { PRIVACY_CHANGES_ANSWERED_EVENT } from "@/lib/shared/privacy-changes";
import type { TeamRole } from "@/lib/shared/types";
import styles from "./MatchLaunchCenter.module.css";

/** Cadences d'interrogation : serrée pendant un lancement, lâche sinon. */
const POLL_LOBBY_MS = 8_000;
const POLL_ACTIVE_MS = 30_000;
const POLL_IDLE_MS = 60_000;
/** Un match lancé depuis moins longtemps que cela est annoncé d'office. */
const LAUNCH_ANNOUNCE_WINDOW_MS = 10 * 60_000;
const DISMISSED_STORAGE_KEY = "bg_match_launch_dismissed";

const ROLE_LABELS: Partial<Record<TeamRole, string>> = {
  CAPITAINE: "Capitaine",
  MANAGER: "Manager",
  OWNER: "Propriétaire",
};

function readDismissed(): Set<string> {
  try {
    const raw = window.sessionStorage.getItem(DISMISSED_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

function writeDismissed(keys: Set<string>): void {
  try {
    window.sessionStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify([...keys].slice(-50)));
  } catch {
    // Stockage indisponible : la modale reviendra au prochain chargement.
  }
}

function formatTime(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

/** Doit-on ouvrir la modale d'office pour ce match ? */
function wantsAutoOpen(info: MatchLaunchInfo, now: number): boolean {
  if (info.phase === "LOBBY") return true;
  if (info.phase !== "LAUNCHED" || !info.launchedAt) return false;
  return now - new Date(info.launchedAt).getTime() < LAUNCH_ANNOUNCE_WINDOW_MS;
}

/**
 * Modale de **lancement d'un match**, montée pour tout compte connecté dans la
 * mise en page racine : elle s'ouvre d'elle-même, sur n'importe quelle page du
 * site, à l'heure de début d'un match que le joueur joue ou caste
 * (`lib/shared/match-launch.ts`).
 *
 * Elle présente la rencontre (« Équipe 1 VS Équipe 2 », tournoi), l'équipe qui
 * héberge la partie, les contacts de chaque équipe et du caster, et recueille
 * les « Prêt » : avec confirmation pour le donner, d'un clic pour le retirer.
 * Fermée, elle laisse une pastille pour la rouvrir tant que le match se joue.
 *
 * La liste vient de `/api/me/match-launches`, interrogée à cadence variable et
 * suspendue onglet caché (`useClientPower().clocks`) ; une minuterie la relit à
 * l'heure exacte du prochain match programmé.
 */
export function MatchLaunchCenter({ privacyPending = false }: { privacyPending?: boolean }) {
  const { showError, showSuccess } = useToast();
  const { clocks } = useClientPower();
  // Un choix de confidentialité dû passe d'abord (`launchModalWaits`).
  const [privacyAnswered, setPrivacyAnswered] = useState(false);
  const pathname = usePathname();
  const waiting = launchModalWaits({
    privacyPending,
    privacyAnswered,
    onPrivacyPage: pathname === PRIVACY_POLICY_PATH,
  });
  const [launches, setLaunches] = useState<MatchLaunchInfo[]>([]);
  const [openMatchId, setOpenMatchId] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const dismissedRef = useRef<Set<string> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/me/match-launches", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { launches?: MatchLaunchInfo[] };
      setLaunches(Array.isArray(payload.launches) ? payload.launches : []);
    } catch {
      // Réseau coupé : la liste actuelle reste, la prochaine relève rattrapera.
    }
  }, []);

  const hasLobby = launches.some((info) => info.phase === "LOBBY");
  const hasActive = launches.some((info) => info.phase !== "SCHEDULED");
  const pollMs = hasLobby ? POLL_LOBBY_MS : hasActive ? POLL_ACTIVE_MS : POLL_IDLE_MS;

  // Relève périodique, suspendue onglet caché et reprise aussitôt au retour.
  useEffect(() => {
    if (!clocks) return;
    void refresh();
    const timer = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(timer);
  }, [clocks, pollMs, refresh]);

  // L'heure du prochain match programmé : relue à la seconde dite plutôt qu'au
  // prochain passage de la relève.
  const nextStart = useMemo(() => {
    const now = Date.now();
    const times = launches
      .filter((info) => info.phase === "SCHEDULED" && info.startAt)
      .map((info) => new Date(info.startAt as string).getTime())
      .filter((time) => Number.isFinite(time) && time > now);
    return times.length > 0 ? Math.min(...times) : null;
  }, [launches]);

  useEffect(() => {
    if (nextStart === null || !clocks) return;
    const timer = setTimeout(() => void refresh(), Math.max(0, nextStart - Date.now()) + 500);
    return () => clearTimeout(timer);
  }, [nextStart, clocks, refresh]);

  // Ouverture demandée ailleurs (carte du match), et relecture après une
  // écriture faite ailleurs (caster inscrit, lancement forcé).
  useEffect(() => {
    const onOpen = (event: Event) => {
      const matchId = Number((event as CustomEvent<{ matchId?: unknown }>).detail?.matchId);
      if (!Number.isInteger(matchId)) return;
      setConfirming(false);
      setOpenMatchId(matchId);
      void refresh();
    };
    const onRefresh = () => void refresh();
    window.addEventListener(MATCH_LAUNCH_OPEN_EVENT, onOpen);
    window.addEventListener(MATCH_LAUNCH_REFRESH_EVENT, onRefresh);
    return () => {
      window.removeEventListener(MATCH_LAUNCH_OPEN_EVENT, onOpen);
      window.removeEventListener(MATCH_LAUNCH_REFRESH_EVENT, onRefresh);
    };
  }, [refresh]);

  // Ouverture d'office : un match qui entre en lancement, ou qui vient d'être
  // lancé, et que le joueur n'a pas encore écarté à cette phase.
  //
  // Posée sur le match **résolu** et non sur l'identifiant demandé : un match
  // ouvert qui sort de la liste (terminé) ne bloque pas l'annonce du suivant,
  // et une ouverture demandée avant que la liste n'arrive se résout d'elle-même
  // à la relève qu'elle déclenche.
  const current = waiting ? null : (launches.find((info) => info.matchId === openMatchId) ?? null);

  useEffect(() => {
    if (waiting || current !== null) return;
    if (dismissedRef.current === null) dismissedRef.current = readDismissed();
    const now = Date.now();
    const next = launches.find(
      (info) => wantsAutoOpen(info, now) && !dismissedRef.current?.has(launchModalKey(info)),
    );
    if (next) {
      setConfirming(false);
      setOpenMatchId(next.matchId);
    }
  }, [launches, current, waiting]);

  useEffect(() => {
    if (!privacyPending) return;
    const onAnswered = () => setPrivacyAnswered(true);
    window.addEventListener(PRIVACY_CHANGES_ANSWERED_EVENT, onAnswered);
    return () => window.removeEventListener(PRIVACY_CHANGES_ANSWERED_EVENT, onAnswered);
  }, [privacyPending]);


  const close = useCallback(() => {
    if (current) {
      if (dismissedRef.current === null) dismissedRef.current = readDismissed();
      dismissedRef.current.add(launchModalKey(current));
      writeDismissed(dismissedRef.current);
    }
    setConfirming(false);
    setOpenMatchId(null);
  }, [current]);

  const dialogRef = useDialogBehavior({
    open: current !== null,
    onClose: () => {
      if (confirming) setConfirming(false);
      else close();
    },
    locked: busy,
  });

  const setReady = async (ready: boolean) => {
    if (!current || busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/matches/${current.matchId}/ready`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ready }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        launched?: boolean;
      };
      if (!response.ok) throw new Error(payload.error || "UNKNOWN");
      showSuccess(
        payload.launched
          ? "Toutes les parties sont prêtes : le match est lancé !"
          : ready
            ? "C'est noté, tu es prêt."
            : "« Prêt » annulé.",
      );
      setConfirming(false);
      await refresh();
    } catch (error) {
      showError(launchErrorMessage((error as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      showSuccess(`${label} copié.`);
    } catch {
      showError("Copie impossible : sélectionne le texte à la main.");
    }
  };

  const pending = launches.filter((info) => info.phase === "LOBBY" || info.phase === "LAUNCHED");

  if (!current) {
    if (waiting || pending.length === 0) return null;
    const lobby = pending.find((info) => info.phase === "LOBBY");
    const target = lobby ?? pending[0];
    return (
      <button
        type="button"
        className={styles.fab}
        data-phase={target.phase}
        onClick={() => {
          setConfirming(false);
          setOpenMatchId(target.matchId);
        }}
      >
        <span aria-hidden="true">{lobby ? "⏳" : "▶"}</span>
        {lobby ? "Match en lancement" : "Mon match"}
        <span className={styles.fabTeams}>
          {target.team1.name} vs {target.team2.name}
        </span>
      </button>
    );
  }

  const count = readyCount({
    team1Ready: current.team1.ready,
    team2Ready: current.team2.ready,
    casterRequired: current.caster !== null,
    casterReady: current.caster?.ready ?? false,
  });
  const autoAt = formatTime(current.autoLaunchAt);
  const startAt = formatTime(current.startAt);
  const titleId = `match-launch-title-${current.matchId}`;
  const statusId = `match-launch-status-${current.matchId}`;
  const nextMatchId = nextLaunchMatchId(
    pending.map((info) => info.matchId),
    current.matchId,
  );
  const partyWord = current.viewer.role === "CASTER" ? "Je suis prêt" : "Mon équipe est prête";

  return (
    <div className={styles.overlay} role="presentation">
      <div
        ref={dialogRef}
        className={styles.modal}
        role={confirming ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={statusId}
        aria-busy={busy}
        tabIndex={-1}
        data-phase={current.phase}
      >
        <header className={styles.head}>
          <span className="eyebrow">
            {current.phase === "LAUNCHED" ? "MATCH LANCÉ" : "LANCEMENT DU MATCH"} ·{" "}
            {current.tournamentName}
          </span>
          <h2 id={titleId} className={styles.title}>
            <span className={styles.titleTeam}>{current.team1.name}</span>
            {/* « VS » se lit « vé-esse » : l'oreille reçoit « contre », hors
                écran. Un `aria-label` sur ce `<span>` sans rôle serait interdit
                (`aria-prohibited-attr`) — et c'est ce titre qui nomme la modale. */}
            <span className={styles.vs} aria-hidden="true">
              VS
            </span>
            <span className="sr-only"> contre </span>
            <span className={styles.titleTeam}>{current.team2.name}</span>
          </h2>
          <p id={statusId} className={styles.status} data-phase={current.phase} role="status">
            {current.phase === "LOBBY" && (
              <>
                En attente des « Prêt » —{" "}
                <strong className="num">
                  {count.ready}/{count.expected}
                </strong>{" "}
                prêts
                {autoAt && <> · lancement automatique à <span className="num">{autoAt}</span></>}
              </>
            )}
            {current.phase === "LAUNCHED" && <>Le match est lancé — bonne partie !</>}
            {current.phase === "SCHEDULED" && (
              <>Début prévu à <span className="num">{startAt ?? "—"}</span></>
            )}
          </p>
        </header>

        <div className={styles.body}>
          <div className={styles.sides}>
            <SideCard side={current.team1} isHost={current.hostTeamId === current.team1.teamId} phase={current.phase} onCopy={copy} />
            <div className={styles.divider} aria-hidden="true">
              VS
            </div>
            <SideCard side={current.team2} isHost={current.hostTeamId === current.team2.teamId} phase={current.phase} onCopy={copy} />
          </div>

          <CasterCard caster={current.caster} phase={current.phase} onCopy={copy} />
        </div>

        {/* La confirmation n'a d'objet qu'en lancement : un match lancé entre-temps
            (arbitrage, délai) la referme d'elle-même. */}
        {confirming && current.phase === "LOBBY" ? (
          <div className={styles.confirm}>
            <p className={styles.confirmText}>
              {current.viewer.role === "CASTER"
                ? "Confirmes-tu être prêt à caster ce match ?"
                : "Confirmes-tu que ton équipe est au complet et prête à jouer ?"}{" "}
              Le match démarre dès que toutes les parties sont prêtes.
            </p>
            <div className={styles.actions}>
              <button type="button" className="btn ghost" onClick={() => setConfirming(false)} disabled={busy}>
                Retour
              </button>
              <button
                type="button"
                className={`btn ${styles.readyButton}`}
                onClick={() => void setReady(true)}
                disabled={busy}
              >
                {busy ? "…" : "Confirmer : prêt"}
              </button>
            </div>
          </div>
        ) : (
          <footer className={styles.footer}>
            {current.phase === "LOBBY" && current.viewer.canDeclareReady && (
              current.viewer.ready ? (
                <button
                  type="button"
                  className={`btn ${styles.readyOn}`}
                  onClick={() => void setReady(false)}
                  disabled={busy}
                  aria-pressed="true"
                  title="Cliquer pour annuler ton « Prêt »"
                >
                  {busy ? "…" : "✓ Prêt — annuler"}
                </button>
              ) : (
                <button
                  type="button"
                  className={`btn ${styles.readyButton}`}
                  onClick={() => setConfirming(true)}
                  disabled={busy}
                  aria-pressed="false"
                >
                  {partyWord}
                </button>
              )
            )}
            {current.phase === "LOBBY" && !current.viewer.canDeclareReady && (
              <p className={styles.hint}>
                Le capitaine, un manager ou le propriétaire de ton équipe la déclare prête.
              </p>
            )}
            <div className={styles.links}>
              {nextMatchId !== null && (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    setConfirming(false);
                    setOpenMatchId(nextMatchId);
                  }}
                >
                  Autre match ({pending.filter((info) => info.matchId !== current.matchId).length})
                </button>
              )}
              <Link
                className="btn ghost"
                href={tournamentMatchHref(current.tournamentId, current.matchId)}
                onClick={close}
              >
                Voir le match
              </Link>
              <button type="button" className="btn ghost" onClick={close}>
                Fermer
              </button>
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}

type CopyFn = (value: string, label: string) => Promise<void>;

function ReadyChip({ ready, phase }: { ready: boolean; phase: MatchLaunchInfo["phase"] }) {
  if (phase !== "LOBBY") return null;
  return (
    <span className={ready ? styles.chipReady : styles.chipWaiting}>
      {ready ? "✓ Prêt" : "En attente"}
    </span>
  );
}

function IdentityLine({
  kind,
  value,
  verified,
  onCopy,
}: {
  kind: "Discord" | "BattleTag";
  value: string | null;
  verified: boolean;
  onCopy: CopyFn;
}) {
  return (
    <div className={styles.identity}>
      <span className={styles.identityKind}>{kind}</span>
      {value ? (
        <>
          <span className={`mono ${styles.identityValue}`}>{value}</span>
          {verified ? (
            <span className={styles.verified} title="Vérifié">
              ✓<span className="sr-only"> vérifié</span>
            </span>
          ) : (
            <span className={styles.unverified}>non vérifié</span>
          )}
          <button
            type="button"
            className={styles.copy}
            onClick={() => void onCopy(value, kind)}
            aria-label={`Copier le ${kind} ${value}`}
          >
            Copier
          </button>
        </>
      ) : (
        <span className={styles.missing}>—</span>
      )}
    </div>
  );
}

function ContactRow({ contact, onCopy }: { contact: LaunchContact; onCopy: CopyFn }) {
  // Dans l'ordre de la priorité de choix (capitaine, manager, propriétaire),
  // pas dans l'ordre de saisie : la pastille la plus parlante vient en tête.
  const roles = (Object.keys(ROLE_LABELS) as TeamRole[])
    .filter((role) => contact.roles.includes(role))
    .map((role) => ROLE_LABELS[role] as string);
  return (
    <li className={styles.contact}>
      <div className={styles.contactHead}>
        <span className={styles.pseudo}>{contact.pseudo}</span>
        {roles.map((label) => (
          <span key={label} className={styles.role}>
            {label}
          </span>
        ))}
      </div>
      <IdentityLine kind="Discord" value={contact.discordTag} verified={contact.discordTag !== null} onCopy={onCopy} />
      <IdentityLine kind="BattleTag" value={contact.battletag} verified={contact.battletagVerified} onCopy={onCopy} />
    </li>
  );
}

function SideCard({
  side,
  isHost,
  phase,
  onCopy,
}: {
  side: LaunchSide;
  isHost: boolean;
  phase: MatchLaunchInfo["phase"];
  onCopy: CopyFn;
}) {
  return (
    <section className={styles.side} data-host={isHost ? "true" : undefined} aria-label={side.name}>
      <div className={styles.sideHead}>
        <span className={styles.emblem} aria-hidden="true">
          {side.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- fichier du site, déjà optimisé au téléversement
            <img src={side.logoUrl} alt="" />
          ) : (
            Array.from(side.name.trim())[0]?.toUpperCase() ?? "?"
          )}
        </span>
        <span className={styles.sideName}>{side.name}</span>
        <ReadyChip ready={side.ready} phase={phase} />
      </div>
      {isHost && (
        <p className={styles.hostBadge}>
          <span aria-hidden="true">🏠</span> Héberge la partie — crée le salon
        </p>
      )}
      {side.isGhost ? (
        <p className={styles.note}>Équipe invitée : pas de contact.</p>
      ) : phase === "SCHEDULED" ? (
        <p className={styles.note}>Les contacts s&apos;affichent au lancement.</p>
      ) : side.contacts.length === 0 ? (
        <p className={styles.note}>Aucun contact disponible.</p>
      ) : (
        <ul className={styles.contacts}>
          {side.contacts.map((contact) => (
            <ContactRow key={contact.userId} contact={contact} onCopy={onCopy} />
          ))}
        </ul>
      )}
    </section>
  );
}

function CasterCard({
  caster,
  phase,
  onCopy,
}: {
  caster: LaunchCaster | null;
  phase: MatchLaunchInfo["phase"];
  onCopy: CopyFn;
}) {
  if (!caster) {
    return (
      <section className={styles.caster} aria-label="Caster">
        <p className={styles.note}>
          <span aria-hidden="true">🎙</span> Aucun caster inscrit : le match part dès que les deux
          équipes sont prêtes.
        </p>
      </section>
    );
  }
  return (
    <section className={styles.caster} aria-label="Caster">
      <div className={styles.sideHead}>
        <span className={styles.emblem} aria-hidden="true">
          🎙
        </span>
        <span className={styles.sideName}>
          <span className={styles.casterLabel}>Caster</span> {caster.pseudo}
        </span>
        <ReadyChip ready={caster.ready} phase={phase} />
      </div>
      {phase !== "SCHEDULED" && (
        <div className={styles.casterIds}>
          <IdentityLine kind="Discord" value={caster.discordTag} verified={caster.discordTag !== null} onCopy={onCopy} />
          <IdentityLine kind="BattleTag" value={caster.battletag} verified={caster.battletagVerified} onCopy={onCopy} />
        </div>
      )}
    </section>
  );
}
