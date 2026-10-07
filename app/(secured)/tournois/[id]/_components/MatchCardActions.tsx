"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeftRight,
  CalendarClock,
  CalendarPlus,
  Ellipsis,
  Film,
  Info,
  Mic,
  MicOff,
  Pencil,
  Play,
  Radio,
  Settings,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import {
  MATCH_LAUNCH_OPEN_EVENT,
  MATCH_LAUNCH_REFRESH_EVENT,
  type MatchLaunchPhase,
} from "@/lib/shared/match-launch";
import type { BracketMatch } from "@/lib/shared/types";
import { focusLeftMenu, handleMenuEscape } from "@/components/cyber/landing/PublicNavMenu";
import { ScrollArea } from "@/components/cyber/ScrollArea";
import { useLiveControls } from "../_lib/live-context";
import { useErrorsText, useMapError } from "../_lib/error-map";
import { launchErrorText, useActionsText } from "../_lib/actions-text";
import {
  groupMatchCardActions,
  matchCardActionName,
  type MatchCardAction,
  type MatchCardActionId,
} from "../_lib/match-card-actions";
import styles from "./MatchCardActions.module.css";

async function send(url: string, method: string, body?: unknown): Promise<void> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || "UNKNOWN");
  }
}

const ICONS: Record<MatchCardActionId, LucideIcon> = {
  playerScore: Pencil,
  openLaunch: Info,
  plan: CalendarPlus,
  adminScore: Pencil,
  schedule: CalendarClock,
  force: Play,
  hostSwap: ArrowLeftRight,
  claimCast: Mic,
  releaseCast: MicOff,
  onAir: Radio,
  liveConfig: Settings,
  replay: Film,
  report: TriangleAlert,
};

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

type PanelPlacement = { top: number; left: number; width: number; maxHeight: number; up: boolean };

const samePlacement = (a: PanelPlacement | null, b: PanelPlacement) =>
  a !== null &&
  a.top === b.top &&
  a.left === b.left &&
  a.width === b.width &&
  a.maxHeight === b.maxHeight &&
  a.up === b.up;

/**
 * Porté en fin de page, le panneau n'a pas de « suivant » naturel : la
 * tabulation qui en sort par un bout le referme et rend le focus au bouton
 * (`close`). Écoutée sur **chaque bouton** du panneau, pas sur son conteneur :
 * un `<div>` qui reçoit des touches se présente comme un contrôle qu'il n'est
 * pas (SonarQube S6848).
 */
export function closePanelOnTabOut(
  e: { key: string; shiftKey: boolean; currentTarget: Element; preventDefault: () => void },
  panel: ParentNode | null,
  close: () => void,
): void {
  if (e.key !== "Tab") return;
  const buttons: Element[] = Array.from(panel?.querySelectorAll("button") ?? []);
  const index = buttons.indexOf(e.currentTarget);
  if (index === -1) return;
  if ((e.shiftKey && index === 0) || (!e.shiftKey && index === buttons.length - 1)) {
    e.preventDefault();
    close();
  }
}

/** Marge entre le panneau et le bord de la fenêtre. */
const EDGE = 8;
/** Le panneau mord de 4 px sur le pied, pour s'y rattacher visuellement. */
const OVERLAP = 4;

/**
 * Où poser le panneau ouvert (coordonnées de la fenêtre), à la largeur de la
 * carte (bordure comprise) : du côté du pied d'action qui a le plus de place —
 * dessous de préférence — **sans jamais recouvrir le pied** ni sortir de la
 * fenêtre, en hauteur comme en largeur (une carte à demi défilée hors d'une
 * manche garde son panneau à l'écran). Plus haut que la place disponible, il
 * défile (`maxHeight`).
 */
export function panelPlacement(
  footer: Pick<DOMRect, "top" | "bottom" | "left" | "width">,
  panelHeight: number,
  viewport: Readonly<{ width: number; height: number }>,
): PanelPlacement {
  const spaceBelow = Math.max(0, viewport.height - (footer.bottom - OVERLAP) - EDGE);
  const spaceAbove = Math.max(0, footer.top + OVERLAP - EDGE);
  const up = panelHeight > spaceBelow && spaceAbove > spaceBelow;
  const maxHeight = up ? spaceAbove : spaceBelow;
  const shown = Math.min(panelHeight, maxHeight);
  const width = Math.min(footer.width + 2, viewport.width - 2 * EDGE);
  const left = Math.max(EDGE, Math.min(footer.left - 1, viewport.width - width - EDGE));
  return {
    top: Math.round(up ? footer.top + OVERLAP - shown : footer.bottom - OVERLAP),
    left: Math.round(left),
    width: Math.round(width),
    maxHeight: Math.floor(maxHeight),
    up,
  };
}

const TONE_CLASS = {
  primary: styles.tonePrimary,
  staff: styles.toneStaff,
  warn: styles.toneWarn,
  neutral: "",
} as const;

/**
 * Pied d'action d'une carte de match : l'action principale du lecteur, et un
 * bouton de divulgation « Plus d'actions » qui déplie le reste sous le pied,
 * **par-dessus** les cartes suivantes : la carte garde sa taille, sans quoi
 * l'arbre (qui mesure ses cartes, `useSlotHeight`) regrandirait tous ses
 * créneaux et ferait sauter la page.
 *
 * Mêmes règles clavier que le menu du compte : Échap referme et rend le focus
 * au bouton, la tabulation qui sort du pied le referme. Choisir une action
 * referme le panneau et pose le focus sur « Plus d'actions » **avant** de
 * l'exécuter : la modale ouverte rend ensuite le focus à un bouton qui existe
 * encore.
 *
 * Les gestes et leurs appels sont ceux des anciens bandeaux, à l'identique ;
 * le lancement forcé garde sa confirmation (`ConfirmActionDialog`).
 */
export function MatchCardActions({
  match,
  phase,
  actions,
  matchLabel,
  isCaster,
  onAir,
  onPlayerScore,
  onAdminScore,
  onReport,
}: Readonly<{
  match: BracketMatch;
  phase: MatchLaunchPhase;
  actions: readonly MatchCardAction[];
  matchLabel: string;
  /** Le lecteur est le caster inscrit (« Ne plus caster » plutôt que « Retirer le caster »). */
  isCaster: boolean;
  /** Le direct est ouvert : le bouton d'antenne le coupe. */
  onAir: boolean;
  onPlayerScore: () => void;
  onAdminScore: () => void;
  onReport: () => void;
}>) {
  const { openSchedule, openConfig, openReplay, castBlock } = useLiveControls();
  const { showError, showSuccess } = useToast();
  const mapError = useMapError();
  const errorsText = useErrorsText();
  const actionText = useActionsText();
  const { t } = actionText;
  const launchError = (code: string | null | undefined) => launchErrorText(actionText, errorsText, code);
  const castIdentityNotice = launchError("CASTER_IDENTITY_REQUIRED");
  const actionName = (label: string) => matchCardActionName(label, matchLabel, actionText);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [confirmForce, setConfirmForce] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const { primary, more } = groupMatchCardActions(actions);
  const hasForce = actions.some((a) => a.id === "force");
  // Une confirmation en attente ne survit pas à la disparition de son action :
  // sans cette remise à zéro, la modale se rouvrirait seule au retour de
  // « Forcer » (instantané du flux), sans clic.
  if (confirmForce && !hasForce) setConfirmForce(false);
  // Ouvert **et** encore quelque chose à montrer : un instantané du flux qui
  // retire le panneau ne doit pas le laisser « ouvert » en mémoire, prêt à
  // reparaître déplié sans clic au retour d'une action.
  const expanded = open && more.length > 0;
  const moreKey = more.map((a) => `${a.id}:${a.label}`).join("|");
  // …et l'oublie : sans cette remise à zéro, `open` resterait vrai et le
  // panneau reviendrait déplié avec la prochaine action secondaire.
  if (open && more.length === 0) setOpen(false);

  // Le panneau est porté dans `document.body` : le « menu » est le pied **et**
  // le panneau, deux sous-arbres DOM distincts.
  const panelRef = useRef<HTMLDivElement>(null);
  const menu = {
    contains: (node: Node | null) =>
      Boolean(rootRef.current?.contains(node) || panelRef.current?.contains(node)),
  };

  useEffect(() => {
    if (!expanded) return;
    // À l'ouverture, le focus entre dans le panneau : porté hors de la carte,
    // il n'est pas sur le chemin de la tabulation depuis le bouton.
    panelRef.current?.querySelector("button")?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      handleMenuEscape(e.key, document.activeElement, menu, toggleRef.current, () => setOpen(false));
    };
    const onPointer = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
    // `menu` ne lit que des refs : le recréer à chaque rendu ne change rien.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  // Placement du panneau ouvert, en coordonnées de la fenêtre : porté dans
  // `document.body` et en `position: fixed`, il échappe à tout ce qui rogne ou
  // masque autour de la carte (cadre des plateaux, zones défilantes et leur
  // dégradé de bord).
  const [placement, setPlacement] = useState<PanelPlacement | null>(null);
  useIsomorphicLayoutEffect(() => {
    if (!expanded) {
      setPlacement(null);
      return;
    }
    let frame = 0;
    const place = () => {
      const root = rootRef.current;
      const panel = panelRef.current;
      if (!root || !panel) return;
      // Un ancêtre transformé deviendrait le repère d'un `position: fixed` :
      // on mesure où le repère se trouve à l'écran, et on retranche son
      // origine (nulle dans `document.body`, sauf réglage qui le transforme).
      const rect = panel.getBoundingClientRect();
      const originTop = rect.top - (Number.parseFloat(panel.style.top) || 0);
      const originLeft = rect.left - (Number.parseFloat(panel.style.left) || 0);
      // Hauteur naturelle : celle du panneau, liste dépliée en entier (elle
      // peut être bornée par le placement précédent).
      const list = panel.firstElementChild;
      const natural = list ? panel.offsetHeight - list.clientHeight + list.scrollHeight : panel.offsetHeight;
      const onScreen = panelPlacement(root.getBoundingClientRect(), natural, {
        width: document.documentElement.clientWidth,
        height: window.innerHeight,
      });
      const next = {
        ...onScreen,
        top: Math.round(onScreen.top - originTop),
        left: Math.round(onScreen.left - originLeft),
      };
      setPlacement((previous) => (samePlacement(previous, next) ? previous : next));
    };
    // Défilement de la page : le panneau suit sa carte, une fois par image au
    // plus. Défilement d'une zone qui contient la carte (arbre, colonnes de
    // manche) : il se referme — la carte peut y sortir de la partie visible,
    // et un panneau fixe flotterait alors sur l'en-tête ou la barre latérale.
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    const onScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.contains(rootRef.current)) {
        // Le focus ne disparaît pas avec le panneau : il revient au bouton.
        if (panelRef.current?.contains(document.activeElement)) toggleRef.current?.focus({ preventScroll: true });
        setOpen(false);
        return;
      }
      schedule();
    };
    place();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", schedule);
    // La carte peut bouger sans défilement : une ligne ajoutée par le flux
    // (caster, direct) au-dessus du pied, une carte voisine qui grandit. Tout
    // déplacement de ce genre change la taille d'un ancêtre — on les observe
    // tous, de la carte au corps de page (une dizaine d'éléments).
    const resizes = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    for (let node = rootRef.current?.parentElement ?? null; node && resizes; node = node.parentElement) {
      resizes.observe(node);
    }
    return () => {
      resizes?.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", schedule);
    };
    // `moreKey` : une action ajoutée ou retirée par le flux, panneau ouvert,
    // change sa hauteur — il se replace.
  }, [expanded, moreKey]);

  if (actions.length === 0) return null;

  const run = async (action: () => Promise<void>, success: string, refresh = true): Promise<boolean> => {
    setBusy(true);
    try {
      await action();
      showSuccess(success);
      if (refresh) window.dispatchEvent(new Event(MATCH_LAUNCH_REFRESH_EVENT));
      return true;
    } catch (error) {
      showError(refresh ? launchError((error as Error).message) : mapError((error as Error).message));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handlers: Record<MatchCardActionId, () => void> = {
    playerScore: onPlayerScore,
    openLaunch: () =>
      window.dispatchEvent(new CustomEvent(MATCH_LAUNCH_OPEN_EVENT, { detail: { matchId: match.id } })),
    plan: () => openSchedule(match),
    adminScore: onAdminScore,
    schedule: () => openSchedule(match),
    force: () => setConfirmForce(true),
    hostSwap: () => {
      const next = match.hostTeamId === match.team1Id ? match.team2Id : match.team1Id;
      void run(() => send(`/api/admin/matches/${match.id}/host`, "PUT", { teamId: next }), t("cardActions.hostChanged"));
    },
    claimCast: () => {
      if (castBlock) {
        showError(launchError(castBlock));
        return;
      }
      void run(() => send(`/api/matches/${match.id}/caster`, "POST"), t("cardActions.casting"));
    },
    releaseCast: () => {
      void run(
        () => send(`/api/matches/${match.id}/caster`, "DELETE"),
        isCaster ? t("cardActions.notCasting") : t("cardActions.casterRemoved"),
      );
    },
    onAir: () => {
      void run(
        () => send(`/api/admin/matches/${match.id}/live`, "POST", { onAir: !onAir }),
        onAir ? t("cardActions.airClosed") : t("cardActions.airOpened"),
        false,
      );
    },
    liveConfig: () => openConfig(match),
    replay: () => openReplay(match),
    report: onReport,
  };

  // Gestes qui écrivent eux-mêmes (sans modale) : désactivés pendant un envoi.
  const writes = (id: MatchCardActionId) =>
    id === "hostSwap" || id === "claimCast" || id === "releaseCast" || id === "onAir" || id === "force";

  const renderButton = (action: MatchCardAction, inMenu: boolean) => {
    const Icon = ICONS[action.id];
    const blocked = action.id === "claimCast" && castBlock !== null;
    return (
      <button
        key={action.id}
        type="button"
        className={[
          "tap-target",
          inMenu ? styles.item : styles.primary,
          inMenu ? "" : TONE_CLASS[action.tone],
        ]
          .filter(Boolean)
          .join(" ")}
        disabled={busy && writes(action.id)}
        aria-disabled={action.id === "claimCast" ? blocked : undefined}
        title={blocked && castBlock === "CASTER_IDENTITY_REQUIRED" ? castIdentityNotice : undefined}
        aria-label={actionName(action.label)}
        data-action={action.id}
        onKeyDown={inMenu ? onPanelKeyDown : undefined}
        onClick={() => {
          if (inMenu) {
            setOpen(false);
            toggleRef.current?.focus();
          }
          handlers[action.id]();
        }}
      >
        <Icon size={16} aria-hidden />
        <span className={styles.label}>{action.label}</span>
      </button>
    );
  };

  // La tabulation qui quitte le pied et le panneau referme ce dernier.
  const onMenuBlur = (e: { relatedTarget: EventTarget | null }) => {
    if (expanded && focusLeftMenu(menu, e.relatedTarget)) setOpen(false);
  };
  // Écoutée sur chaque bouton du panneau (`closePanelOnTabOut`).
  const onPanelKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) =>
    closePanelOnTabOut(e, panelRef.current, () => {
      setOpen(false);
      toggleRef.current?.focus();
    });

  return (
    <div ref={rootRef} className={styles.root} onBlur={onMenuBlur}>
      <div className={styles.bar}>
        {primary && renderButton(primary, false)}
        {more.length > 0 && (
          <button
            ref={toggleRef}
            type="button"
            className={`tap-target ${styles.toggle} ${primary ? "" : styles.toggleWide}`}
            aria-expanded={expanded}
            aria-controls={expanded ? panelId : undefined}
            aria-label={actionName(t("cardActions.more"))}
            title={primary ? t("cardActions.more") : undefined}
            onClick={() => setOpen(!expanded)}
          >
            <Ellipsis size={18} aria-hidden />
            {/* Seul, le bouton dit son nom ; à côté de l'action principale, le
                texte reste pour les lecteurs d'écran (il ouvre le nom accessible). */}
            <span className={primary ? "sr-only" : styles.label}>{t("cardActions.more")}</span>
          </button>
        )}
      </div>
      {/* Monté à l'ouverture seulement (un plateau compte jusqu'à 254 cartes,
          et chaque `ScrollArea` pose ses observateurs), porté dans
          `document.body` comme les modales. */}
      {expanded &&
        createPortal(
          <div
            id={panelId}
            ref={panelRef}
            className={styles.panel}
            data-placement={placement?.up ? "top" : "bottom"}
            // Coordonnées calculées à l'ouverture (`panelPlacement`) : seule
            // valeur qu'une feuille de style ne peut pas connaître.
            style={placement ? { top: placement.top, left: placement.left, width: placement.width } : undefined}
            onBlur={onMenuBlur}
          >
            {/* Bornée à la place disponible : sur une fenêtre basse, la liste
                défile plutôt que de déborder hors de l'écran. */}
            <ScrollArea
              orientation="y"
              className={styles.list}
              ariaLabel={actionName(t("cardActions.more"))}
              style={placement ? { maxHeight: placement.maxHeight } : undefined}
            >
              {more.map((action) => renderButton(action, true))}
            </ScrollArea>
          </div>,
          document.body,
        )}
      {/* Refermée — et oubliée — si l'action disparaît (match lancé entre-temps
          par un autre arbitre). */}
      {confirmForce && hasForce && (
        <ConfirmActionDialog
          title={t("cardActions.forceConfirm.title", { match: matchLabel })}
          confirmLabel={t("cardActions.forceConfirm.confirm")}
          pendingLabel={t("cardActions.forceConfirm.pending")}
          onClose={() => setConfirmForce(false)}
          onConfirm={() => run(() => send(`/api/admin/matches/${match.id}/launch`, "POST"), t("cardActions.forceConfirm.success"))}
        >
          <p>{t("cardActions.forceConfirm.body")}</p>
          {phase === "TO_PLAN" && (
            <p>{t("cardActions.forceConfirm.unplanned")}</p>
          )}
        </ConfirmActionDialog>
      )}
    </div>
  );
}
