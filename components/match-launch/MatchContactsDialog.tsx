"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ScrollArea } from "@/components/cyber/ScrollArea";
import { useToast } from "@/components/ui/toast";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import { MATCH_LAUNCH_REFRESH_EVENT, type MatchLaunchInfo, type MatchLaunchPhase } from "@/lib/shared/match-launch";
import { CasterCard, SideCard } from "./LaunchContactCards";
import { useLaunchText, type LaunchText } from "./launch-text";
import launchStyles from "./MatchLaunchCenter.module.css";
import styles from "./MatchContactsDialog.module.css";

/** Refus de `GET /api/matches/[id]/contacts`, dans la langue de la page. */
export function contactsErrorText(text: LaunchText, code: string | null | undefined): string {
  if (code === "MATCH_CONTACTS_UNAVAILABLE") return text.t("contacts.unavailable");
  return text.t("contacts.failed");
}

type LoadState = { kind: "loading" } | { kind: "ready"; launch: MatchLaunchInfo } | { kind: "failed" };

/**
 * Attente la plus longue avant l'unique relecture d'un refus
 * `MATCH_CONTACTS_UNAVAILABLE` : au-delà, l'écart d'horloge n'explique plus le
 * refus.
 */
export const CONTACTS_RETRY_MAX_WAIT_MS = 30_000;

/**
 * Attente avant de relire un refus « indisponible », `null` sans relecture.
 * La carte décide du bouton à l'horloge du navigateur, le serveur à la sienne :
 * un caster dont l'horloge avance voit « Contacts » à l'heure du départ, avant
 * que le serveur ne tienne le match pour parti. Relu seulement quand l'heure du
 * serveur (en-tête `Date` du refus) précède le départ d'au plus
 * `CONTACTS_RETRY_MAX_WAIT_MS` ; un match sans heure, déjà lancé (`startAt`
 * `null`) ou dont le départ est passé au serveur garde son refus.
 */
export function contactsRetryDelay(startAt: string | null, serverDate: string | null): number | null {
  if (startAt === null || serverDate === null) return null;
  const start = Date.parse(startAt);
  const server = Date.parse(serverDate);
  if (!Number.isFinite(start) || !Number.isFinite(server) || start <= server) return null;
  // L'en-tête est tronqué à la seconde : une seconde de marge.
  const delay = start - server + 1_000;
  return delay <= CONTACTS_RETRY_MAX_WAIT_MS ? delay : null;
}

/**
 * Le match est-il parti (lancement ouvert, ou lancé) ? C'est alors seulement
 * que les contacts du caster sortent (`exposesCaster`, serveur).
 */
export function matchUnderway(phase: MatchLaunchPhase | null): boolean {
  return phase === "LOBBY" || phase === "LAUNCHED";
}

/**
 * Les contacts du caster attendent-ils le départ ? Un caster inscrit, sur un
 * match pas encore parti à l'heure du serveur (`launch.phase`) : sa fiche porte
 * alors une note plutôt que ses contacts. Pas pour le caster lui-même (arbitre
 * qui caste) : rien à attendre sur sa propre fiche.
 */
export function casterContactsPending(launch: MatchLaunchInfo): boolean {
  return launch.caster !== null && launch.viewer.role !== "CASTER" && !matchUnderway(launch.phase);
}

/** Relectures supplémentaires d'une relecture qui échoue (réseau, 5xx, 429). */
export const REREAD_RETRIES = 3;

/** Attente entre deux de ces relectures. */
export const REREAD_RETRY_MS = 10_000;

/** Relancer une relecture après `failures` échecs consécutifs ? */
export function shouldRetryReread(failures: number): boolean {
  return failures > 0 && failures <= REREAD_RETRIES;
}

/** Plus longue attente que `setTimeout` accepte (≈ 24,8 jours). */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * Attente avant de relire une modale ouverte dont les contacts du caster
 * attendent le départ, `null` sans relecture : jusqu'à l'heure de départ **du
 * serveur** (en-tête `Date` de la réponse), plus une seconde — l'en-tête est
 * tronqué à la seconde, et l'horloge du navigateur peut avancer. Sans caster,
 * sans heure ou départ déjà passé au serveur, rien n'est relu.
 */
export function casterRereadDelay(launch: MatchLaunchInfo, serverDate: string | null): number | null {
  if (!casterContactsPending(launch) || launch.startAt === null || serverDate === null) return null;
  const start = Date.parse(launch.startAt);
  const server = Date.parse(serverDate);
  if (!Number.isFinite(start) || !Number.isFinite(server) || start <= server) return null;
  return Math.min(start - server + 1_000, MAX_TIMER_MS);
}

/** Horaire du match tel que la carte le reçoit (écritures annoncées par le flux). */
export type CardSchedule = { startAt: string | null; launchedAt: string | null };

/**
 * Relire la modale ouverte quand l'horaire de la carte change ? Un lancement
 * forcé (`launchedAt`), un match reprogrammé ou remis à planifier (`startAt`)
 * sont des écritures : la lecture du caster (contacts, ou note d'attente) et
 * l'heure de la relecture suivante en dépendent. Rien sans caster ; jamais à
 * l'horloge du navigateur, que la relecture à l'heure du serveur couvre.
 */
export function rereadOnScheduleChange(
  previous: CardSchedule,
  next: CardSchedule,
  launch: MatchLaunchInfo | null,
): boolean {
  if (launch === null || launch.caster === null) return false;
  return previous.startAt !== next.startAt || previous.launchedAt !== next.launchedAt;
}

/**
 * Refus définitif d'une relecture (plus partie du match, déconnecté…) : les
 * contacts affichés sont retirés. Tout autre échec (réseau, 5xx, quota) est
 * passager : l'affichage reste et la relecture se retente.
 */
export function isFinalRefusal(code: string | null): boolean {
  return code === "MATCH_CONTACTS_UNAVAILABLE" || code === "UNAUTHORIZED" || code === "INVALID_MATCH_ID";
}

type ContactsRead = { launch: MatchLaunchInfo; serverDate: string | null } | { error: string | null };

type ReadOptions = {
  /** Heure de départ d'un match **pas encore lancé** ; `null` sinon. */
  startAt: string | null;
  signal?: AbortSignal;
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

function abortableWait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/**
 * Lit les contacts d'un match ; un refus « indisponible » à la frontière du
 * départ (`contactsRetryDelay`) est relu **une** fois, tout autre échec est
 * rendu tel quel. `signal` coupe l'attente et la lecture à la fermeture.
 */
export async function readMatchContacts(matchId: number, options: ReadOptions): Promise<ContactsRead> {
  const { startAt, signal, wait = abortableWait } = options;
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`/api/matches/${matchId}/contacts`, { cache: "no-store", signal });
    const payload = (await response.json().catch(() => ({}))) as { launch?: MatchLaunchInfo; error?: string };
    if (response.ok && payload.launch) return { launch: payload.launch, serverDate: response.headers.get("date") };
    const error = payload.error ?? null;
    const delay =
      attempt === 0 && error === "MATCH_CONTACTS_UNAVAILABLE"
        ? contactsRetryDelay(startAt, response.headers.get("date"))
        : null;
    if (delay === null) return { error };
    await wait(delay, signal);
  }
}

/**
 * Modale « Contacts » d'une carte de match (`docs/features/MATCH_LAUNCH.md`
 * § Contacts hors lancement) : les fiches de la modale de lancement — équipes,
 * hôte, contacts, caster —, lues pour **ce** match par
 * `GET /api/matches/[id]/contacts`. Le serveur seul décide qui les reçoit (les
 * parties du match, comme au lancement) ; la carte n'offre le bouton qu'à
 * elles, et un refus se dit par une notification.
 *
 * Portée dans `document.body`, `useDialogBehavior` (piège de focus, Échap),
 * voile fermé par `useBackdropDismiss` ; le focus d'ouverture va à « Fermer ».
 */
export function MatchContactsDialog({
  matchId,
  matchLabel,
  onClose,
  startAt = null,
  launchedAt = null,
}: Readonly<{
  matchId: number;
  matchLabel: string;
  onClose: () => void;
  /**
   * Horaire de la carte : un match pas encore lancé est relu à la frontière du
   * départ ; un changement (lancement forcé, reprogrammé) fait relire la modale.
   */
  startAt?: string | null;
  launchedAt?: string | null;
}>) {
  const text = useLaunchText();
  const { t } = text;
  const { showError, showSuccess } = useToast();
  const titleId = useId();
  // À la fermeture, la modale de lancement relit ses matchs : une ouverture
  // d'office retenue pendant que « Contacts » était ouverte part alors.
  const close = () => {
    onClose();
    window.dispatchEvent(new Event(MATCH_LAUNCH_REFRESH_EVENT));
  };
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  useEffect(() => setMounted(true), []);
  const dialogRef = useDialogBehavior({ open: mounted, onClose: close });
  const backdrop = useBackdropDismiss(close);
  const [readKey, setReadKey] = useState(0);
  const [serverDate, setServerDate] = useState<string | null>(null);
  const launch = state.kind === "ready" ? state.launch : null;
  const [rereadFailures, setRereadFailures] = useState(0);
  // Horaire de la carte vu par la dernière lecture réussie : un changement
  // survenu pendant la première lecture compte à son arrivée.
  const previousSchedule = useRef<CardSchedule>({ startAt, launchedAt });
  useEffect(() => {
    if (!launch) return;
    const schedule = { startAt, launchedAt };
    if (rereadOnScheduleChange(previousSchedule.current, schedule, launch)) setReadKey((key) => key + 1);
    previousSchedule.current = schedule;
  }, [startAt, launchedAt, launch]);

  // Relecture échouée : quelques nouvelles tentatives espacées.
  useEffect(() => {
    if (!shouldRetryReread(rereadFailures)) return;
    const timer = setTimeout(() => setReadKey((key) => key + 1), REREAD_RETRY_MS);
    return () => clearTimeout(timer);
  }, [rereadFailures]);

  // Contacts du caster en attente : une relecture à l'heure de départ du serveur.
  useEffect(() => {
    if (!launch) return;
    const delay = casterRereadDelay(launch, serverDate);
    if (delay === null) return;
    const timer = setTimeout(() => setReadKey((key) => key + 1), delay);
    return () => clearTimeout(timer);
  }, [launch, serverDate]);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    // Une relecture (départ, horaire changé) qui échoue passagèrement garde à
    // l'écran ce qui est déjà lu : seuls les contacts du caster y manquaient.
    const reread = readKey > 0;
    void (async () => {
      try {
        const read = await readMatchContacts(matchId, {
          startAt: launchedAt === null ? startAt : null,
          signal: controller.signal,
        });
        if (!alive) return;
        if ("error" in read) {
          if (reread && !isFinalRefusal(read.error)) {
            setRereadFailures((count) => count + 1);
            return;
          }
          setState({ kind: "failed" });
          showError(contactsErrorText(text, read.error));
          return;
        }
        setServerDate(read.serverDate);
        setRereadFailures(0);
        setState({ kind: "ready", launch: read.launch });
      } catch {
        if (!alive) return;
        if (reread) {
          setRereadFailures((count) => count + 1);
          return;
        }
        setState({ kind: "failed" });
        showError(contactsErrorText(text, null));
      }
    })();
    return () => {
      alive = false;
      controller.abort();
    };
    // Une lecture par ouverture, et une au départ du match : la langue ou la
    // notification ne relancent rien.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, readKey]);

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      showSuccess(t("copied", { label }));
    } catch {
      showError(t("copyFailed"));
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div /* NOSONAR S6819 — voile de modale, sans équivalent natif */ role="presentation" className={styles.backdrop} {...backdrop}>
      <div /* NOSONAR S6819 — modale portée dans body (useDialogBehavior) : `<dialog>` changerait couche, Échap et ::backdrop */
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={state.kind === "loading"}
        tabIndex={-1}
        className={styles.dialog}
      >
        <h2 id={titleId} className={styles.title}>
          {t("contacts.title", { match: matchLabel })}
        </h2>
        <p className={styles.subtitle}>{t("contacts.lead")}</p>
        <ScrollArea orientation="y" className={styles.scroll} ariaLabel={t("contacts.scrollAria")}>
          <div className={styles.content}>
            {state.kind === "loading" && <p className={styles.note}>{t("contacts.loading")}</p>}
            {/* Le refus part en notification (jamais en ligne) ; le corps reste
                neutre — « aucun contact » laisserait croire que les adversaires
                n'en ont pas. */}
            {state.kind === "failed" && <p className={styles.note}>{t("contacts.notShown")}</p>}
            {launch && (
              <>
                <div className={launchStyles.sides}>
                  <SideCard
                    side={launch.team1}
                    isHost={launch.hostTeamId === launch.team1.teamId}
                    phase={launch.phase}
                    onCopy={copy}
                    contactsShown
                    linkNames
                  />
                  <div className={launchStyles.divider} aria-hidden="true">
                    {t("vs")}
                  </div>
                  <SideCard
                    side={launch.team2}
                    isHost={launch.hostTeamId === launch.team2.teamId}
                    phase={launch.phase}
                    onCopy={copy}
                    contactsShown
                    linkNames
                  />
                </div>
                <CasterCard
                  caster={launch.caster}
                  phase={launch.phase}
                  onCopy={copy}
                  // Les contacts du caster ne sortent que le temps du match
                  // (`exposesCaster`) : avant, une note plutôt que deux « — »
                  // qui laisseraient croire qu'il n'en a pas.
                  contactsShown={matchUnderway(launch.phase)}
                  // Pas au caster lui-même (arbitre compris) : la note parle de lui.
                  contactsLaterText={casterContactsPending(launch) ? t("contacts.casterLater") : undefined}
                  noCasterText={t("contacts.noCaster")}
                  linkNames
                />
              </>
            )}
          </div>
        </ScrollArea>
        <div className={styles.actions}>
          <button type="button" className="btn ghost" onClick={close} data-autofocus>
            {t("close")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
