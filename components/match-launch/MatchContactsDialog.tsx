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
 * Relire la modale ouverte ? Une fois, quand la carte passe au départ : la
 * note « contacts du caster au départ » laisse alors place à ses contacts. Pas
 * à la fin du match (un refus non demandé), ni à chaque rendu.
 */
export function rereadOnPhaseChange(previous: MatchLaunchPhase | null, next: MatchLaunchPhase | null): boolean {
  return matchUnderway(next) && !matchUnderway(previous);
}

type ContactsRead = { launch: MatchLaunchInfo } | { error: string | null };

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
    if (response.ok && payload.launch) return { launch: payload.launch };
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
  phase = null,
}: Readonly<{
  matchId: number;
  matchLabel: string;
  onClose: () => void;
  /** Heure de départ du match : un match pas encore lancé est relu à la frontière. */
  startAt?: string | null;
  launchedAt?: string | null;
  /**
   * Phase de la carte : la modale relit **une** fois quand le match part
   * (lancement ouvert, ou lancé) pendant qu'elle est ouverte, pour que les
   * contacts du caster, qui ne sortent qu'alors, remplacent la note d'attente.
   */
  phase?: MatchLaunchPhase | null;
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
  const previousPhase = useRef(phase);
  const [readKey, setReadKey] = useState(0);
  useEffect(() => {
    if (rereadOnPhaseChange(previousPhase.current, phase)) setReadKey((key) => key + 1);
    previousPhase.current = phase;
  }, [phase]);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const read = await readMatchContacts(matchId, {
          startAt: launchedAt === null ? startAt : null,
          signal: controller.signal,
        });
        if (!alive) return;
        if ("error" in read) {
          setState({ kind: "failed" });
          showError(contactsErrorText(text, read.error));
          return;
        }
        setState({ kind: "ready", launch: read.launch });
      } catch {
        if (!alive) return;
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

  const launch = state.kind === "ready" ? state.launch : null;
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
                  contactsShown={launch.phase === "LOBBY" || launch.phase === "LAUNCHED"}
                  contactsLaterText={t("contacts.casterLater")}
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
