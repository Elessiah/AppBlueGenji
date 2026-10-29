"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ScrollArea } from "@/components/cyber/ScrollArea";
import { useToast } from "@/components/ui/toast";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import { useClientPower } from "@/lib/shared/hooks/useClientPower";
import {
  MATCH_LAUNCH_REFRESH_EVENT,
  casterContactsPending,
  type MatchLaunchInfo,
} from "@/lib/shared/match-launch";
import type { BracketMatch } from "@/lib/shared/types";
import { CasterCards, RefereeCard, SideCard } from "./LaunchContactCards";
import { useLaunchText, type LaunchText } from "./launch-text";
import launchStyles from "./MatchLaunchCenter.module.css";
import styles from "./MatchContactsDialog.module.css";

/** Refus de `GET /api/matches/[id]/contacts`, dans la langue de la page. */
export function contactsErrorText(text: LaunchText, code: string | null | undefined): string {
  if (code === "MATCH_CONTACTS_UNAVAILABLE") return text.t("contacts.unavailable");
  return text.t("contacts.failed");
}

/** Lecture des contacts d'un match : en cours, lue, ou en échec (notifié). */
export type MatchContactsState = { kind: "loading" } | { kind: "ready"; launch: MatchLaunchInfo } | { kind: "failed" };

/**
 * Attente la plus longue avant l'unique relecture d'un refus
 * `MATCH_CONTACTS_UNAVAILABLE` : au-delà, l'écart d'horloge n'explique plus le
 * refus.
 */
export const CONTACTS_RETRY_MAX_WAIT_MS = 30_000;

/**
 * Marge sur l'en-tête `Date` : tronqué à la seconde, et posé après que le
 * serveur a décidé de la phase — un départ à la seconde même de l'en-tête peut
 * encore être à venir pour lui.
 */
const HEADER_SLACK_MS = 2_000;

/** Attente jusqu'au départ à l'heure du serveur, plus une seconde (au moins une seconde). */
function untilServerStart(start: number, server: number): number {
  return Math.max(start - server + 1_000, 1_000);
}

/**
 * Attente avant de relire un refus « indisponible », `null` sans relecture.
 * La carte décide du bouton à l'horloge du navigateur, le serveur à la sienne :
 * un caster dont l'horloge avance voit « Contacts » à l'heure du départ, avant
 * que le serveur ne tienne le match pour parti. Relu seulement quand l'heure du
 * serveur (en-tête `Date` du refus) précède le départ d'au plus
 * `CONTACTS_RETRY_MAX_WAIT_MS` ; un match sans heure, déjà lancé (`startAt`
 * `null`) ou dont le départ est passé au serveur depuis plus de
 * `HEADER_SLACK_MS` garde son refus.
 */
export function contactsRetryDelay(startAt: string | null, serverDate: string | null): number | null {
  if (startAt === null || serverDate === null) return null;
  const start = Date.parse(startAt);
  const server = Date.parse(serverDate);
  if (!Number.isFinite(start) || !Number.isFinite(server) || start <= server - HEADER_SLACK_MS) return null;
  const delay = untilServerStart(start, server);
  return delay <= CONTACTS_RETRY_MAX_WAIT_MS ? delay : null;
}

/** Relectures supplémentaires d'une relecture qui échoue (réseau, 5xx, 429). */
export const REREAD_RETRIES = 3;

/** Attente entre deux de ces relectures. */
export const REREAD_RETRY_MS = 10_000;

/**
 * Taire un échec de lecture ? Un refus définitif se dit toujours. Un échec
 * passager se tait quand des contacts sont déjà affichés ; sans rien de lu, il
 * se tait à la première lecture (la modale reste en chargement le temps d'une
 * nouvelle tentative), se dit **une** fois à l'échec de cette tentative, puis
 * se tait pour les suivantes. `failuresBefore` : échecs consécutifs avant celui-ci.
 */
export function failureIsSilent(transient: boolean, shown: boolean, failuresBefore: number): boolean {
  return transient && (shown || failuresBefore !== 1);
}

/** Relancer une relecture après `failures` échecs consécutifs ? */
export function shouldRetryReread(failures: number): boolean {
  return failures > 0 && failures <= REREAD_RETRIES;
}

/**
 * Relève de la modale pendant le lancement tant que l'arbitre désigné n'est pas
 * « Prêt » : son « Prêt » ne voyage plus dans l'instantané diffusé (décision 47),
 * il ne se lit que par cette lecture, réservée aux parties du match.
 */
export const REFEREE_READY_REREAD_MS = 10_000;

/** Relever la modale pour suivre le « Prêt » de l'arbitre ? En lancement, arbitre présenté et pas encore prêt. */
export function refereeReadyRereadDue(launch: MatchLaunchInfo | null): boolean {
  return launch !== null && launch.phase === "LOBBY" && launch.referee !== null && !launch.referee.ready;
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
  if (!casterContactsPending(launch) || launch.phase !== "SCHEDULED") return null;
  if (launch.startAt === null || serverDate === null) return null;
  const start = Date.parse(launch.startAt);
  const server = Date.parse(serverDate);
  if (!Number.isFinite(start) || !Number.isFinite(server)) return null;
  // `SCHEDULED` dit que le départ était à venir quand le serveur a lu : un
  // en-tête déjà à l'heure (tronqué, posé après) ne fait qu'avancer la relecture.
  return Math.min(untilServerStart(start, server), MAX_TIMER_MS);
}

/**
 * Ce que la modale montre et que la carte reçoit par le flux (écritures) :
 * horaire, lancement, caster, adversaires, hôte, « Prêt ».
 */
export type ContactsCard = Pick<
  BracketMatch,
  | "startAt"
  | "launchedAt"
  | "casters"
  | "team1Id"
  | "team2Id"
  | "hostTeamId"
  | "team1Ready"
  | "team2Ready"
  | "refereeAssigned"
  | "refereeKey"
  | "selfManaged"
>;

const CARD_FIELDS = [
  "startAt",
  "launchedAt",
  "casters",
  "team1Id",
  "team2Id",
  "hostTeamId",
  "team1Ready",
  "team2Ready",
  "refereeAssigned",
  // Empreinte de la désignation : un match confié à un autre arbitre relit la
  // modale (pseudo, BattleTag). Le « Prêt » de l'arbitre n'est plus dans
  // l'instantané (décision 47) : la relève `REFEREE_READY_REREAD_MS` le suit.
  "refereeKey",
  "selfManaged",
] as const satisfies readonly (keyof ContactsCard)[];

/** Empreinte de la carte : change à chaque écriture qui touche la modale. */
export function contactsCardKey(card: ContactsCard | null): string {
  return card === null ? "" : JSON.stringify(CARD_FIELDS.map((field) => card[field]));
}

/**
 * Relire la modale ouverte quand la carte change ? À chaque écriture qui touche
 * ce qu'elle montre — lancement forcé, match reprogrammé ou remis à planifier,
 * caster qui s'inscrit ou se retire, adversaire corrigé, hôte changé, « Prêt » —,
 * une lecture par écriture ; jamais à l'horloge du navigateur, que la relecture
 * à l'heure du serveur couvre. Rien tant que la première lecture n'a pas abouti,
 * ni pour un `launchedAt` posé sur un match que la lecture disait déjà lancé
 * (tournoi sans phase de lancement : l'écriture suit l'heure).
 */
export function rereadOnCardChange(
  previous: ContactsCard | null,
  next: ContactsCard | null,
  launch: MatchLaunchInfo | null,
): boolean {
  if (launch === null || previous === null || next === null) return false;
  return CARD_FIELDS.some((field) => {
    // Par valeur : la liste des casters est un nouveau tableau à chaque instantané.
    if (JSON.stringify(previous[field]) === JSON.stringify(next[field])) return false;
    return field !== "launchedAt" || launch.phase !== "LAUNCHED";
  });
}

/** Attente demandée par un refus de quota (`Retry-After`, en secondes), `null` sans. */
export function parseRetryAfter(header: string | null): number | null {
  if (header === null) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : null;
}

/**
 * Refus définitif d'une relecture (plus partie du match, déconnecté…) : les
 * contacts affichés sont retirés. Tout autre échec (réseau, 5xx, quota) est
 * passager : l'affichage reste et la relecture se retente.
 */
export function isFinalRefusal(code: string | null): boolean {
  return code === "MATCH_CONTACTS_UNAVAILABLE" || code === "UNAUTHORIZED" || code === "INVALID_MATCH_ID";
}

type ContactsRead =
  | { launch: MatchLaunchInfo; serverDate: string | null }
  | { error: string | null; retryAfterMs: number | null };

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
    if (delay === null) return { error, retryAfterMs: parseRetryAfter(response.headers.get("retry-after")) };
    await wait(delay, signal);
  }
}

/**
 * Lit les contacts d'un match (`GET /api/matches/[id]/contacts`) et les tient à
 * jour : relus à chaque écriture qui touche ce qu'ils montrent (`card`), à
 * l'heure de départ du serveur quand ceux du caster l'attendent, et retentés
 * sans bruit après un échec passager ; un refus se dit par une notification.
 * Partagée par la modale « Contacts » et la page du match (`enabled` : le
 * lecteur est une partie du match ou un arbitre — rien n'est lu sinon).
 */
export function useMatchContacts(
  matchId: number,
  card: ContactsCard | null,
  enabled = true,
): { state: MatchContactsState; launch: MatchLaunchInfo | null } {
  const text = useLaunchText();
  const { showError } = useToast();
  const [state, setState] = useState<MatchContactsState>({ kind: "loading" });
  const launch = state.kind === "ready" ? state.launch : null;
  const [readKey, setReadKey] = useState(0);
  const [serverDate, setServerDate] = useState<string | null>(null);
  const [rereadFailures, setRereadFailures] = useState(0);
  // Attente demandée par le dernier refus de quota (`Retry-After`), 0 sans.
  const [rereadWait, setRereadWait] = useState(0);
  const startAt = card?.startAt ?? null;
  const launchedAt = card?.launchedAt ?? null;
  // Empreinte de la carte vue par la dernière lecture réussie : un changement
  // survenu pendant la première lecture compte à son arrivée.
  const cardKey = contactsCardKey(card);
  const previousCard = useRef(card);
  // Nouvelle relecture (départ, carte changée) : ses échecs se
  // comptent de zéro, quels qu'aient été ceux d'une relecture précédente.
  const rereadNow = () => {
    setRereadFailures(0);
    setReadKey((key) => key + 1);
  };
  useEffect(() => {
    if (!launch) return;
    if (rereadOnCardChange(previousCard.current, card, launch)) rereadNow();
    previousCard.current = card;
    // L'empreinte suit les champs de la carte, pas l'identité de l'objet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardKey, launch]);

  // Relecture échouée : quelques nouvelles tentatives espacées, jamais avant
  // l'attente qu'un refus de quota demande.
  useEffect(() => {
    if (!shouldRetryReread(rereadFailures)) return;
    const timer = setTimeout(() => setReadKey((key) => key + 1), Math.max(REREAD_RETRY_MS, rereadWait));
    return () => clearTimeout(timer);
  }, [rereadFailures, rereadWait]);

  // « Prêt » de l'arbitre : relevé pendant le lancement, onglet visible
  // seulement (`clocks`), jusqu'à ce qu'il soit prêt ou que la phase change.
  const { clocks } = useClientPower();
  const followReferee = clocks && refereeReadyRereadDue(launch);
  useEffect(() => {
    if (!followReferee) return;
    const timer = setInterval(rereadNow, REFEREE_READY_REREAD_MS);
    return () => clearInterval(timer);
  }, [followReferee]);

  // Contacts du caster en attente : une relecture à l'heure de départ du serveur.
  useEffect(() => {
    if (!launch) return;
    const delay = casterRereadDelay(launch, serverDate);
    if (delay === null) return;
    const timer = setTimeout(rereadNow, delay);
    return () => clearTimeout(timer);
  }, [launch, serverDate]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const controller = new AbortController();
    // Un échec passager garde à l'écran ce qui est déjà lu (seuls les contacts
    // du caster y manquaient) ; sans rien de lu, la modale reste en chargement
    // le temps de la **première** nouvelle tentative (un raté isolé), puis
    // notifie l'échec — les tentatives suivantes continuent sans bruit.
    const shown = state.kind === "ready";
    const keepWaiting = (transient: boolean) => failureIsSilent(transient, shown, rereadFailures);
    void (async () => {
      try {
        const read = await readMatchContacts(matchId, {
          startAt: launchedAt === null ? startAt : null,
          signal: controller.signal,
        });
        if (!alive) return;
        if ("error" in read) {
          // Échec passager, à l'ouverture comme en relecture : retenté.
          const transient = !isFinalRefusal(read.error);
          if (transient) {
            setRereadWait(read.retryAfterMs ?? 0);
            setRereadFailures((count) => count + 1);
          }
          if (keepWaiting(transient)) return;
          setState({ kind: "failed" });
          showError(contactsErrorText(text, read.error));
          return;
        }
        setServerDate(read.serverDate);
        setRereadFailures(0);
        setState({ kind: "ready", launch: read.launch });
      } catch {
        if (!alive) return;
        setRereadWait(0);
        setRereadFailures((count) => count + 1);
        if (keepWaiting(true)) return;
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
  }, [matchId, readKey, enabled]);
  return { state, launch };
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
  card = null,
}: Readonly<{
  matchId: number;
  matchLabel: string;
  onClose: () => void;
  /**
   * Le match tel que la carte le reçoit : un match pas encore lancé est relu à
   * la frontière du départ ; une écriture qui touche la modale la fait relire.
   */
  card?: ContactsCard | null;
}>) {
  const text = useLaunchText();
  const { t } = text;
  const { showError, showSuccess } = useToast();
  const titleId = useId();
  const [mounted, setMounted] = useState(false);
  const { state, launch } = useMatchContacts(matchId, card);
  // À la fermeture, la modale de lancement relit ses matchs : une ouverture
  // d'office retenue pendant que « Contacts » était ouverte part alors. Pas
  // pour un arbitre : la modale de lancement ne lui présente rien.
  const close = () => {
    onClose();
    if (launch?.viewer.role !== "REFEREE") window.dispatchEvent(new Event(MATCH_LAUNCH_REFRESH_EVENT));
  };
  useEffect(() => setMounted(true), []);
  const dialogRef = useDialogBehavior({ open: mounted, onClose: close });
  const backdrop = useBackdropDismiss(close);

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
                    linkNames
                  />
                </div>
                <CasterCards
                  casters={launch.casters}
                  phase={launch.phase}
                  onCopy={copy}
                  noCasterText={t("contacts.noCaster")}
                  // Tout tournoi, lancement ou non : « au départ du match ».
                  laterText={t("contacts.casterLater")}
                  linkNames
                  announceArrival
                />
                <RefereeCard
                  referee={launch.referee}
                  selfManaged={launch.selfManaged}
                  phase={launch.phase}
                  onCopy={copy}
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
