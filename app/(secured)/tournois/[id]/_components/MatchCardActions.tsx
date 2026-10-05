"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
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
  CAST_IDENTITY_NOTICE,
  launchErrorMessage,
  MATCH_LAUNCH_OPEN_EVENT,
  MATCH_LAUNCH_REFRESH_EVENT,
  type MatchLaunchPhase,
} from "@/lib/shared/match-launch";
import type { BracketMatch } from "@/lib/shared/types";
import { focusLeftMenu, handleMenuEscape } from "@/components/cyber/landing/PublicNavMenu";
import { ScrollArea } from "@/components/cyber/ScrollArea";
import { useLiveControls } from "../_lib/live-context";
import { mapError } from "../_lib/error-map";
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

/** Marge entre le panneau et le bord de la fenêtre. */
const EDGE = 8;
/** Le panneau mord de 4 px sur le pied, pour s'y rattacher visuellement. */
const OVERLAP = 4;

/**
 * Où poser le panneau ouvert (coordonnées de la fenêtre), à la largeur de la
 * carte (bordure comprise) : du côté du pied d'action qui a le plus de place —
 * dessous de préférence — **sans jamais recouvrir le pied** ni sortir de la
 * fenêtre. Plus haut que la place disponible, il défile (`maxHeight`).
 */
export function panelPlacement(
  footer: Pick<DOMRect, "top" | "bottom" | "left" | "width">,
  panelHeight: number,
  viewportHeight: number,
): PanelPlacement {
  const spaceBelow = Math.max(0, viewportHeight - (footer.bottom - OVERLAP) - EDGE);
  const spaceAbove = Math.max(0, footer.top + OVERLAP - EDGE);
  const up = panelHeight > spaceBelow && spaceAbove > spaceBelow;
  const maxHeight = up ? spaceAbove : spaceBelow;
  const shown = Math.min(panelHeight, maxHeight);
  return {
    top: Math.round(up ? footer.top + OVERLAP - shown : footer.bottom - OVERLAP),
    left: Math.round(footer.left - 1),
    width: Math.round(footer.width + 2),
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
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [confirmForce, setConfirmForce] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const { primary, more } = groupMatchCardActions(actions);
  const hasForce = actions.some((a) => a.id === "force");
  // Ouvert **et** encore quelque chose à montrer : un instantané du flux qui
  // retire le panneau ne doit pas le laisser « ouvert » en mémoire, prêt à
  // reparaître déplié sans clic au retour d'une action.
  const expanded = open && more.length > 0;
  const moreKey = more.map((a) => `${a.id}:${a.label}`).join("|");
  // …et l'oublie : sans cette remise à zéro, `open` resterait vrai et le
  // panneau reviendrait déplié avec la prochaine action secondaire.
  if (open && more.length === 0) setOpen(false);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      handleMenuEscape(e.key, document.activeElement, rootRef.current, toggleRef.current, () => setOpen(false));
    };
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [expanded]);

  // Placement du panneau ouvert, en coordonnées de la fenêtre : il est en
  // `position: fixed`, ce qui le sort des conteneurs qui rognent (cadre des
  // plateaux, zones défilantes de l'arbre et des manches) sans le sortir du
  // DOM de la carte — l'ordre de tabulation reste celui de la carte.
  const panelRef = useRef<HTMLDivElement>(null);
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
      // Un ancêtre transformé (l'apparition `.fade-in` de la page garde sa
      // matrice) devient le repère d'un `position: fixed` : on mesure où ce
      // repère se trouve à l'écran, et on retranche son origine.
      const rect = panel.getBoundingClientRect();
      const originTop = rect.top - (Number.parseFloat(panel.style.top) || 0);
      const originLeft = rect.left - (Number.parseFloat(panel.style.left) || 0);
      // Hauteur naturelle : celle du panneau, liste dépliée en entier (elle
      // peut être bornée par le placement précédent).
      const list = panel.firstElementChild;
      const natural = list ? panel.offsetHeight - list.clientHeight + list.scrollHeight : panel.offsetHeight;
      const onScreen = panelPlacement(root.getBoundingClientRect(), natural, window.innerHeight);
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
    return () => {
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
      showError(refresh ? launchErrorMessage((error as Error).message) : mapError((error as Error).message));
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
      void run(() => send(`/api/admin/matches/${match.id}/host`, "PUT", { teamId: next }), "Équipe hôte modifiée.");
    },
    claimCast: () => {
      if (castBlock) {
        showError(castBlock === "CASTER_IDENTITY_REQUIRED" ? CAST_IDENTITY_NOTICE : launchErrorMessage(castBlock));
        return;
      }
      void run(() => send(`/api/matches/${match.id}/caster`, "POST"), "Tu castes ce match.");
    },
    releaseCast: () => {
      void run(
        () => send(`/api/matches/${match.id}/caster`, "DELETE"),
        isCaster ? "Tu ne castes plus ce match." : "Caster retiré.",
      );
    },
    onAir: () => {
      void run(
        () => send(`/api/admin/matches/${match.id}/live`, "POST", { onAir: !onAir }),
        onAir ? "Antenne fermée." : "Antenne ouverte.",
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
        title={blocked && castBlock === "CASTER_IDENTITY_REQUIRED" ? CAST_IDENTITY_NOTICE : undefined}
        aria-label={matchCardActionName(action.label, matchLabel)}
        data-action={action.id}
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

  return (
    <div
      ref={rootRef}
      className={styles.root}
      onBlur={(e) => {
        if (expanded && focusLeftMenu(rootRef.current, e.relatedTarget)) setOpen(false);
      }}
    >
      <div className={styles.bar}>
        {primary && renderButton(primary, false)}
        {more.length > 0 && (
          <button
            ref={toggleRef}
            type="button"
            className={`tap-target ${styles.toggle} ${primary ? "" : styles.toggleWide}`}
            aria-expanded={expanded}
            aria-controls={panelId}
            aria-label={matchCardActionName("Plus d'actions", matchLabel)}
            title={primary ? "Plus d'actions" : undefined}
            onClick={() => setOpen(!expanded)}
          >
            <Ellipsis size={18} aria-hidden />
            {/* Seul, le bouton dit son nom ; à côté de l'action principale, le
                texte reste pour les lecteurs d'écran (il ouvre le nom accessible). */}
            <span className={primary ? "sr-only" : styles.label}>Plus d&apos;actions</span>
          </button>
        )}
      </div>
      {/* Toujours rendu, masqué par `hidden` : `aria-controls` désigne un
          élément qui existe, et le panneau ne porte que des boutons — seuls
          l'arbitrage et la diffusion en ont plus d'un. */}
      {more.length > 0 && (
        <div
          id={panelId}
          ref={panelRef}
          className={styles.panel}
          hidden={!expanded}
          data-placement={placement?.up ? "top" : "bottom"}
          // Coordonnées calculées à l'ouverture (`panelPlacement`) : seule
          // valeur qu'une feuille de style ne peut pas connaître.
          style={placement ? { top: placement.top, left: placement.left, width: placement.width } : undefined}
        >
          {/* Bornée à la place disponible : sur une fenêtre basse, la liste
              défile plutôt que de déborder hors de l'écran. */}
          <ScrollArea
            orientation="y"
            className={styles.list}
            ariaLabel={matchCardActionName("Plus d'actions", matchLabel)}
            style={placement ? { maxHeight: placement.maxHeight } : undefined}
          >
            {more.map((action) => renderButton(action, true))}
          </ScrollArea>
        </div>
      )}
      {/* Refermée d'elle-même si l'action disparaît (match lancé entre-temps
          par un autre arbitre). */}
      {confirmForce && hasForce && (
        <ConfirmActionDialog
          title={`Forcer le lancement de ${matchLabel} ?`}
          confirmLabel="Lancer le match"
          pendingLabel="Lancement…"
          onClose={() => setConfirmForce(false)}
          onConfirm={() => run(() => send(`/api/admin/matches/${match.id}/launch`, "POST"), "Match lancé.")}
        >
          <p>
            Le match démarre sans attendre les « Prêt » manquants : les engagés peuvent
            reporter leur score dès maintenant.
          </p>
          {phase === "TO_PLAN" && (
            <p>
              Ce match n&apos;est pas encore planifié : il démarre maintenant, sans heure
              annoncée aux engagés.
            </p>
          )}
        </ConfirmActionDialog>
      )}
    </div>
  );
}
