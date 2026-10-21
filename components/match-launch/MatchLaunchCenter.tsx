"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LocaleLink, useLocalePathname } from "@/components/i18n/locale-navigation";
import { useLaunchText, type LaunchKey, type LaunchText } from "./launch-text";
import { INTL_LOCALE, type Locale } from "@/lib/shared/locales";
import { ScrollArea } from "@/components/cyber";
import { PushNotificationsPanel } from "@/components/notifications/PushNotificationsPanel";
import { PushTextProvider } from "@/components/notifications/push-text-provider";
import { englishPush } from "@/components/i18n/english-loaders-account";
import { useEnglishMessagesUntilRemount } from "@/components/i18n/use-english-messages";
import { preloadMissing } from "@/lib/shared/lazy-component";
import { PRIVACY_POLICY_PATH } from "@/components/privacy/PrivacyChangesModal";
import { useToast } from "@/components/ui/toast";
import { useClientPower } from "@/lib/shared/hooks/useClientPower";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import { anotherModalOpen, watchModalsClosed } from "@/lib/shared/dialog-focus";
import { tournamentMatchHref } from "@/lib/shared/match-anchor";
import {
  launchModalKey,
  launchModalWaits,
  MATCH_LAUNCH_OPEN_EVENT,
  nextLaunchMatchId,
  MATCH_LAUNCH_REFRESH_EVENT,
  readyCount,
  type MatchLaunchInfo,
} from "@/lib/shared/match-launch";
import { PRIVACY_CHANGES_ANSWERED_EVENT } from "@/lib/shared/privacy-changes";
import styles from "./MatchLaunchCenter.module.css";
import { CasterCard, SideCard } from "./LaunchContactCards";

/** Cadences d'interrogation : serrée pendant un lancement, lâche sinon. */
const POLL_LOBBY_MS = 8_000;
const POLL_ACTIVE_MS = 30_000;
const POLL_IDLE_MS = 60_000;
/**
 * Regroupement des demandes de relecture (`MATCH_LAUNCH_REFRESH_EVENT`) : assez
 * court pour qu'un « Prêt » adverse se voie dans la seconde, assez long pour
 * qu'une rafale d'instantanés ne vaille qu'une lecture.
 */
const REFRESH_EVENT_COALESCE_MS = 300;
/** Un match lancé depuis moins longtemps que cela est annoncé d'office. */
const LAUNCH_ANNOUNCE_WINDOW_MS = 10 * 60_000;
const DISMISSED_STORAGE_KEY = "bg_match_launch_dismissed";

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

function formatTime(iso: string | null, locale: Locale): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  // 24 h dans les deux langues (le français l'applique de lui-même).
  return date.toLocaleTimeString(INTL_LOCALE[locale], { hour: "2-digit", minute: "2-digit", ...(locale === "fr" ? {} : { hourCycle: "h23" as const }) });
}

/** Libellés qui dépendent de qui déclare « Prêt » : une équipe, ou le caster. */
function viewerLaunchCopy(text: LaunchText, role: MatchLaunchInfo["viewer"]["role"]): { partyWord: string; confirmQuestion: string } {
  const who = role === "CASTER" ? "caster" : "team";
  return { partyWord: text.t(`ready.${who}`), confirmQuestion: text.t(`confirmQuestion.${who}`) };
}

/** Sur-titre de la modale. */
function launchEyebrow(text: LaunchText, phase: MatchLaunchInfo["phase"]): string {
  return text.t(phase === "LAUNCHED" ? "eyebrowLaunched" : "eyebrowLobby");
}

/** Clés des refus du lancement (`errors.*`). */
type LaunchErrorKey = Extract<LaunchKey, `errors.${string}`>;

/**
 * Refus d'un geste du lancement (`launchErrorMessage`), dans la langue de la
 * page : la modale vit dans la mise en page racine, hors de la fiche et de sa
 * table des refus — elle porte les siens (`errors.*`).
 */
export function launchErrorText(text: LaunchText, code: string | null | undefined): string {
  // Lecture directe de la table des messages, et non de `LAUNCH_ERROR_MESSAGES`
  // (dont le français est le même, testé) : l'importer aurait mis ses phrases
  // une seconde fois dans le paquet de toutes les pages. Une clé absente se
  // rend telle quelle (`scopedText`) : c'est le signe d'un code inconnu.
  // Un code se limite à `A-Z0-9_` : autre chose (accolade, chevron) ferait
  // échouer le formateur sur la clé rendue telle quelle — repli direct.
  const key = `errors.${code ?? ""}`;
  const message = code && /^[A-Z0-9_]+$/.test(code) ? text.t(key as LaunchErrorKey) : key;
  return message === key ? text.t("errors.fallback") : message;
}

/** Libellé d'un bouton, remplacé par « … » le temps d'un envoi. */
function busyLabel(busy: boolean, label: string): string {
  return busy ? "…" : label;
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
 * l'heure exacte du prochain match programmé, et la fiche d'un tournoi la fait
 * relire dès que son flux apprend un changement d'une rencontre du lecteur
 * (`viewerLaunchChanged`, `lib/shared/viewer-alerts.ts`).
 */
export function MatchLaunchCenter({
  privacyPending = false,
  requestedMatchId = null,
}: Readonly<{
  privacyPending?: boolean;
  /** Ouverture demandée avant le chargement de ce morceau (`MatchLaunchCenterLazy`), lue au montage. */
  requestedMatchId?: number | null;
}>) {
  const { showError, showSuccess } = useToast();
  const text = useLaunchText();
  const { t } = text;
  const { clocks } = useClientPower();
  // Un choix de confidentialité dû passe d'abord (`launchModalWaits`).
  const [privacyAnswered, setPrivacyAnswered] = useState(false);
  // Route sans préfixe de langue : `/en/rgpd` est la page de confidentialité.
  const { path: pathname } = useLocalePathname();
  const waiting = launchModalWaits({
    privacyPending,
    privacyAnswered,
    onPrivacyPage: pathname === PRIVACY_POLICY_PATH,
  });
  const { launches, refresh } = useMatchLaunchFeed(clocks);
  const [openMatchId, setOpenMatchId] = useState<number | null>(requestedMatchId);
  const [confirming, setConfirming] = useState(false);
  // Où rendre le focus au prochain rendu : « Prêt », « Retour » et la
  // confirmation retirent chacun le bouton qui l'avait, et le focus sortait
  // alors de la modale (sur `<body>`). Consommé par l'effet plus bas.
  const pendingFocusRef = useRef<"confirm" | "ready" | null>(null);
  const confirmRef = useRef<HTMLFieldSetElement>(null);
  const readyRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const dismissedRef = useRef<Set<string> | null>(null);
  // Relance de l'ouverture d'office, retenue par une autre modale ouverte.
  const [modalRecheck, setModalRecheck] = useState(0);

  // Ouverture demandée ailleurs (carte du match).
  useEffect(() => {
    const onOpen = (event: Event) => {
      const matchId = Number((event as CustomEvent<{ matchId?: unknown }>).detail?.matchId);
      if (!Number.isInteger(matchId)) return;
      setConfirming(false);
      setOpenMatchId(matchId);
      void refresh();
    };
    window.addEventListener(MATCH_LAUNCH_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(MATCH_LAUNCH_OPEN_EVENT, onOpen);
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
    dismissedRef.current ??= readDismissed();
    const now = Date.now();
    const next = launches.find(
      (info) => wantsAutoOpen(info, now) && !dismissedRef.current?.has(launchModalKey(info)),
    );
    if (!next) return;
    // Jamais par-dessus une autre modale (« Contacts », score…) : deux pièges
    // de focus se disputeraient Tab et Échap. L'annonce attend sa fermeture,
    // guettée par un observateur du DOM tant que l'onglet est visible
    // (horloges actives), réarmé à son retour. Une modale qui cède sa place
    // (invitation à certifier, `data-modal-yields`) ne la retient pas : elle
    // s'efface.
    const urgent = { overYielding: true };
    if (anotherModalOpen(document, urgent)) {
      return clocks ? watchModalsClosed(() => setModalRecheck((n) => n + 1), undefined, urgent) : undefined;
    }
    setConfirming(false);
    setOpenMatchId(next.matchId);
  }, [launches, current, waiting, clocks, modalRecheck]);

  useEffect(() => {
    if (!privacyPending) return;
    const onAnswered = () => setPrivacyAnswered(true);
    window.addEventListener(PRIVACY_CHANGES_ANSWERED_EVENT, onAnswered);
    return () => window.removeEventListener(PRIVACY_CHANGES_ANSWERED_EVENT, onAnswered);
  }, [privacyPending]);


  const close = useCallback(() => {
    if (current) {
      dismissedRef.current ??= readDismissed();
      dismissedRef.current.add(launchModalKey(current));
      writeDismissed(dismissedRef.current);
    }
    setConfirming(false);
    setOpenMatchId(null);
  }, [current]);

  const dialogRef = useDialogBehavior({
    open: current !== null,
    onClose: () => {
      if (confirming) {
        pendingFocusRef.current = "ready";
        setConfirming(false);
      } else close();
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
      const readyMessage = ready ? t("readyNoted") : t("readyCanceled");
      showSuccess(payload.launched ? t("launched") : readyMessage);
      setConfirming(false);
      pendingFocusRef.current = "ready";
      await refresh();
    } catch (error) {
      // Le bouton, désactivé le temps de l'envoi, a pu perdre le focus.
      pendingFocusRef.current = confirming ? "confirm" : "ready";
      showError(launchErrorText(text, (error as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      showSuccess(t("copied", { label }));
    } catch {
      showError(t("copyFailed"));
    }
  };

  // Rend le focus demandé une fois l'envoi fini et le nouvel état rendu. Sans
  // cible (le bouton n'est plus offert), le focus va à la modale elle-même.
  useEffect(() => {
    const target = pendingFocusRef.current;
    if (target === null || busy) return;
    pendingFocusRef.current = null;
    const element = target === "confirm" ? confirmRef.current : readyRef.current;
    (element ?? dialogRef.current)?.focus();
  });

  const pending = launches.filter((info) => info.phase === "LOBBY" || info.phase === "LAUNCHED");

  if (!current) {
    if (waiting || pending.length === 0) return null;
    return (
      <LaunchFab
        pending={pending}
        onOpen={(matchId) => {
          setConfirming(false);
          setOpenMatchId(matchId);
        }}
      />
    );
  }

  const count = readyCount({
    team1Ready: current.team1.ready,
    team2Ready: current.team2.ready,
    casterRequired: current.caster !== null,
    casterReady: current.caster?.ready ?? false,
  });
  const autoAt = formatTime(current.autoLaunchAt, text.locale);
  const startAt = formatTime(current.startAt, text.locale);
  const titleId = `match-launch-title-${current.matchId}`;
  const statusId = `match-launch-status-${current.matchId}`;
  const confirmTextId = `match-launch-confirm-${current.matchId}`;
  const nextMatchId = nextLaunchMatchId(
    pending.map((info) => info.matchId),
    current.matchId,
  );
  const { partyWord, confirmQuestion } = viewerLaunchCopy(text, current.viewer.role);

  return (
    <div /* NOSONAR S6819 — voile de modale, sans équivalent natif */ className={styles.overlay} role="presentation">
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
        <ScrollArea orientation="y" className={styles.scroll} ariaLabel={t("detailsAria")}>
          <header className={styles.head}>
            <span className="eyebrow">
              {launchEyebrow(text, current.phase)} ·{" "}
              {current.tournamentName}
            </span>
            <h2 id={titleId} className={styles.title}>
              <span className={styles.titleTeam}>{current.team1.name}</span>
              {/* « VS » se lit « vé-esse » : l'oreille reçoit « contre », hors
                  écran. Un `aria-label` sur ce `<span>` sans rôle serait interdit
                  (`aria-prohibited-attr`) — et c'est ce titre qui nomme la modale. */}
              <span className={styles.vs} aria-hidden="true">
                {t("vs")}
              </span>
              <span className="sr-only"> {t("versus")} </span>
              <span className={styles.titleTeam}>{current.team2.name}</span>
            </h2>
            <p /* NOSONAR S6819 — région live d'état, pas le résultat d'un formulaire */ id={statusId} className={styles.status} data-phase={current.phase} role="status">
              <LaunchStatus phase={current.phase} count={count} autoAt={autoAt} startAt={startAt} />
            </p>
          </header>

          <div className={styles.body}>
            <div className={styles.sides}>
              <SideCard side={current.team1} isHost={current.hostTeamId === current.team1.teamId} phase={current.phase} onCopy={copy} />
              <div className={styles.divider} aria-hidden="true">
                {t("vs")}
              </div>
              <SideCard side={current.team2} isHost={current.hostTeamId === current.team2.teamId} phase={current.phase} onCopy={copy} />
            </div>

            <CasterCard caster={current.caster} phase={current.phase} onCopy={copy} />
          </div>

          {/* Le même réglage que sur /profil, sous sa forme compacte : c'est ici
              que le joueur découvre qu'il aurait pu être prévenu. Il se tait une
              fois l'appareil abonné. */}
          {/* Réglage des notifications : dans la langue de la page depuis le
              lot 9-2 (`push`) ; son anglais chargé sous `/en` seulement. */}
          <LaunchPushPanel locale={text.locale} lead={t("pushLead")} />
        </ScrollArea>

        {/* La confirmation n'a d'objet qu'en lancement : un match lancé entre-temps
            (arbitrage, délai) la referme d'elle-même. */}
        {confirming && current.phase === "LOBBY" ? (
          <fieldset
            ref={confirmRef}
            className={`native-group ${styles.confirm}`}
            aria-labelledby={confirmTextId}
            tabIndex={-1}
          >
            <p id={confirmTextId} className={styles.confirmText}>
              {confirmQuestion} {t("startsWhenReady")}
            </p>
            <div className={styles.actions}>
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  pendingFocusRef.current = "ready";
                  setConfirming(false);
                }}
                disabled={busy}
              >
                {t("back")}
              </button>
              <button
                type="button"
                className={`btn ${styles.readyButton}`}
                onClick={() => void setReady(true)}
                disabled={busy}
              >
                {busyLabel(busy, t("confirmReady"))}
              </button>
            </div>
          </fieldset>
        ) : (
          <footer className={styles.footer}>
            {current.phase === "LOBBY" && current.viewer.canDeclareReady && (
              current.viewer.ready ? (
                <button
                  ref={readyRef}
                  type="button"
                  className={`btn ${styles.readyOn}`}
                  onClick={() => void setReady(false)}
                  disabled={busy}
                  aria-pressed="true"
                  title={t("cancelReadyTitle")}
                >
                  {busyLabel(busy, t("cancelReady"))}
                </button>
              ) : (
                <button
                  ref={readyRef}
                  type="button"
                  className={`btn ${styles.readyButton}`}
                  onClick={() => {
                    pendingFocusRef.current = "confirm";
                    setConfirming(true);
                  }}
                  disabled={busy}
                  aria-pressed="false"
                  // Focus d'ouverture : ce bouton n'ouvre que la confirmation,
                  // un Entrée égaré ne déclare donc rien. Ni « annuler » (un
                  // clic retire le « Prêt » sans confirmation) ni un lien ne
                  // sont marqués : la modale s'ouvre d'elle-même, parfois
                  // pendant une saisie ailleurs dans la page.
                  data-autofocus
                >
                  {partyWord}
                </button>
              )
            )}
            {current.phase === "LOBBY" && !current.viewer.canDeclareReady && (
              <p className={styles.hint}>
                {t("notLeader")}
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
                  {t("otherMatch", { count: pending.filter((info) => info.matchId !== current.matchId).length })}
                </button>
              )}
              <LocaleLink
                className="btn ghost"
                href={tournamentMatchHref(current.tournamentId, current.matchId)}
                onClick={close}
              >
                {t("viewMatch")}
              </LocaleLink>
              <button type="button" className="btn ghost" onClick={close}>
                {t("close")}
              </button>
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}

/**
 * Le réglage compact des notifications : un lecteur français ne télécharge pas
 * son anglais (revue de performance du lot 9-2). Sous `/en`, il paraît quand
 * l'anglais est là (`englishPush`, partagé : déjà reçu par `/profil`, il ne
 * repart pas) ; un échec le laisse caché — réglage facultatif, offert
 * aussi par `/profil` — plutôt que de le montrer en français. Monté avec la
 * fenêtre ouverte seulement (refermée, elle cède la place au bouton flottant),
 * il retente à la réouverture suivante (`onceLoader` ne garde pas un échec) —
 * jamais par une boucle de fond.
 * Dernier élément de la zone défilante : paru après coup (fenêtre ouverte sans
 * survol du bouton — ouverture d'office, carte d'un match), il allonge la zone
 * sans rien déplacer de ce qui se lit au-dessus.
 */
function LaunchPushPanel({ locale, lead }: Readonly<{ locale: Locale; lead: string }>) {
  const { english, failed } = useEnglishMessagesUntilRemount(locale, englishPush);
  // Échec : rien (pas de lecture d'état pour un réglage qui ne paraîtra pas).
  if (locale === "en" && failed) return null;
  // Monté tout de suite, caché tant que l'anglais arrive : la lecture de l'état
  // des notifications part en même temps que lui, pas après. Rien de français
  // ne se montre ; sans boîte (`display: contents`), aucun écart dans la colonne.
  const hidden = locale === "en" && !english;
  return (
    <div className={styles.pushSlot} data-waiting={hidden || undefined}>
      <PushTextProvider locale={locale} messages={locale === "en" ? (english ?? undefined) : undefined}>
        <PushNotificationsPanel variant="compact" topics={["MATCH_START"]} lead={lead} />
      </PushTextProvider>
    </div>
  );
}

const preloadPush = preloadMissing([englishPush]);

/** Précharge l'anglais du réglage des notifications (bouton de la fenêtre de lancement). */
function preloadEnglishPush(locale: Locale): void {
  if (locale === "en") preloadPush();
}

/** Cadence de relève selon la phase la plus pressante de la liste. */
function launchPollInterval(launches: readonly MatchLaunchInfo[]): number {
  const hasLobby = launches.some((info) => info.phase === "LOBBY");
  const hasActive = launches.some((info) => info.phase !== "SCHEDULED");
  let pollMs = POLL_IDLE_MS;
  if (hasLobby) pollMs = POLL_LOBBY_MS;
  else if (hasActive) pollMs = POLL_ACTIVE_MS;
  return pollMs;
}

/**
 * Liste des lancements du lecteur, tenue à jour : lecture au montage et au
 * retour sur l'onglet, relève périodique suspendue onglet caché, relecture à
 * l'heure du prochain match programmé et sur demande d'une autre page.
 */
function useMatchLaunchFeed(clocks: boolean) {
  const [launches, setLaunches] = useState<MatchLaunchInfo[]>([]);

  // Numéros de séquence : une réponse lente (relève et signal qui se croisent)
  // ne doit pas écraser une réponse plus récente déjà appliquée.
  const requestSeqRef = useRef(0);
  const appliedSeqRef = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    try {
      const response = await fetch("/api/me/match-launches", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { launches?: MatchLaunchInfo[] };
      if (seq < appliedSeqRef.current) return;
      appliedSeqRef.current = seq;
      setLaunches(Array.isArray(payload.launches) ? payload.launches : []);
    } catch {
      // Réseau coupé : la liste actuelle reste, la prochaine relève rattrapera.
    }
  }, []);

  const pollMs = launchPollInterval(launches);

  // Lecture au montage et au retour sur l'onglet — et **seulement** là : posée
  // dans l'effet de relève, qui dépend de `pollMs`, elle repartait à chaque
  // changement de phase, en double de la lecture qui venait de le révéler.
  useEffect(() => {
    if (clocks) void refresh();
  }, [clocks, refresh]);

  // Relève périodique, suspendue onglet caché.
  useEffect(() => {
    if (!clocks) return;
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

  // Relecture après une écriture faite ailleurs (caster inscrit, lancement
  // forcé).
  useEffect(() => {
    // Regroupés : la fiche d'un tournoi signale chaque changement d'une
    // rencontre du lecteur, et une rafale d'instantanés ne doit valoir qu'une
    // lecture.
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const onRefresh = () => {
      if (refreshTimer !== null) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void refresh();
      }, REFRESH_EVENT_COALESCE_MS);
    };
    window.addEventListener(MATCH_LAUNCH_REFRESH_EVENT, onRefresh);
    return () => {
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      window.removeEventListener(MATCH_LAUNCH_REFRESH_EVENT, onRefresh);
    };
  }, [refresh]);

  return { launches, refresh };
}

/** Pastille qui rouvre la modale tant qu'un match du lecteur se joue. */
function LaunchFab({
  pending,
  onOpen,
}: Readonly<{ pending: readonly MatchLaunchInfo[]; onOpen: (matchId: number) => void }>) {
  const { t, locale } = useLaunchText();
  const lobby = pending.find((info) => info.phase === "LOBBY");
  const target = lobby ?? pending[0];
  // Sous `/en`, l'anglais du réglage des notifications part au survol : il est
  // là quand la fenêtre s'ouvre, sans rien télécharger pour qui ne l'ouvre pas.
  const preload = () => preloadEnglishPush(locale);
  return (
    <button
      type="button"
      className={styles.fab}
      data-phase={target.phase}
      onClick={() => onOpen(target.matchId)}
      onPointerEnter={(event) => {
        // Au toucher, `pointerenter` part aussi au début d'un défilement : seul un vrai survol compte.
        if (event.pointerType !== "touch") preload();
      }}
      onFocus={preload}
    >
      <span aria-hidden="true">{lobby ? "⏳" : "▶"}</span>
      {lobby ? t("fabLobby") : t("fabMine")}
      <span className={styles.fabTeams}>
        {t("fabTeams", { team1: target.team1.name, team2: target.team2.name })}
      </span>
    </button>
  );
}

/** État du lancement, annoncé aux technologies d'assistance. */
function LaunchStatus({
  phase,
  count,
  autoAt,
  startAt,
}: Readonly<{
  phase: MatchLaunchInfo["phase"];
  count: { ready: number; expected: number };
  autoAt: string | null;
  startAt: string | null;
}>) {
  const { t } = useLaunchText();
  return (
    <>
      {phase === "LOBBY" && (
        <>
          {t("status.waiting")}{" "}
          <strong className="num">
            {count.ready}/{count.expected}
          </strong>{" "}
          {t("status.ready")}
          {autoAt && <> · {t("status.autoAt")} <span className="num">{autoAt}</span></>}
        </>
      )}
      {phase === "LAUNCHED" && <>{t("status.launched")}</>}
      {phase === "SCHEDULED" && (
        <>{t("status.startsAt")} <span className="num">{startAt ?? "—"}</span></>
      )}
    </>
  );
}
