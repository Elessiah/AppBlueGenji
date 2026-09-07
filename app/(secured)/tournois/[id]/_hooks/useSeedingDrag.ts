"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  autoScrollVelocity,
  dropIndexAt,
  moveToIndex,
} from "@/lib/shared/drag-reorder";
import { isValidSeedOrder } from "@/lib/shared/seeding";

/**
 * Glisser-déposer d'une liste verticale de rangs — la part qui touche au DOM.
 *
 * Toute l'arithmétique du geste vit dans `lib/shared/drag-reorder.ts` (pur,
 * testé sans navigateur). Ce hook n'en garde que ce qui ne peut pas s'en
 * abstraire : relever les géométries au début du geste, écouter le pointeur, et
 * faire défiler la page quand on atteint un bord.
 *
 * Trois partis pris.
 *
 * **Événements pointeur, jamais l'API HTML5 de glisser-déposer** : celle-ci
 * n'existe pas sur mobile, et son image fantôme n'est pas stylable. Les
 * `PointerEvent` couvrent souris, stylet et doigt d'un seul jeu de gestionnaires.
 *
 * **Géométrie relevée une fois**, au premier appui, et en coordonnées **page**
 * (`clientY + scrollY`) : les emplacements ne bougent pas pendant le geste —
 * seul leur contenu permute — et le repère page survit au défilement
 * automatique, qui déplacerait sinon la cible sous le pointeur immobile.
 *
 * **Aucune écriture avant le relâchement** : le geste ne produit qu'un aperçu.
 * Un `PATCH` par ligne survolée écrirait des dizaines d'ordres intermédiaires,
 * et chacun régénère le plateau du tournoi.
 */

/** Marge de déclenchement : en-deçà, l'appui reste un clic (focus, menu, etc.). */
const DRAG_THRESHOLD_PX = 4;

type DragSession = {
  teamId: number;
  pointerId: number;
  /** Ordre affiché au moment de l'appui — base de tous les aperçus du geste. */
  baseOrder: number[];
  /** Milieu vertical de chaque emplacement, en coordonnées page. */
  slotMidpoints: number[];
  /** Ordonnée du dernier mouvement, en coordonnées **fenêtre** (défilement). */
  pointerClientY: number;
  /** Ordonnée de l'appui initial, pour la marge de déclenchement. */
  originClientY: number;
  /** Le seuil est-il franchi ? Avant cela, rien n'est déplacé. */
  active: boolean;
  /**
   * Rang d'accueil courant — **la** valeur que lit le relâchement.
   *
   * Elle ne peut pas vivre dans un `useState` : la mise à jour naît d'un
   * `pointermove`, donc de priorité continue, que React planifie sans la
   * commiter dans la tâche courante. Le `pointerup` d'un geste vif arrive
   * avant ce rendu, et lirait le rang du geste *précédent* — ou rien du tout,
   * et le geste serait avalé en silence. L'état React reste, mais seulement
   * pour l'affichage, où un retard d'une image ne coûte rien.
   */
  targetIndex: number | null;
};

export type SeedingDrag = {
  /** Ligne actuellement tirée, `null` hors geste. */
  draggingTeamId: number | null;
  /**
   * Ordre à afficher — l'aperçu pendant le geste, `null` sinon.
   *
   * C'est **tout** ce que le geste rend à l'affichage : le rang d'accueil lui-
   * même reste dans la session, et n'en sort pas. Il en existe bien une copie
   * dans un `useState`, mais elle retarde d'un rendu — la sortir sous un nom
   * public inviterait à la brancher sur une écriture, et à réintroduire le
   * décalage qui avalait les gestes vifs.
   */
  previewOrder: number[] | null;
  /** Ref à poser sur chaque ligne, pour relever sa géométrie. */
  setRowRef: (teamId: number) => (node: HTMLElement | null) => void;
  /** Gestionnaires à poser sur la poignée de la ligne. */
  handleProps: (teamId: number) => {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  };
};

type UseSeedingDragOptions = {
  /** Ordre courant (identifiants d'engagés), tel qu'il est rendu. */
  order: readonly number[];
  /** Le geste est-il permis ? (staff, ordre non figé, au moins deux lignes) */
  enabled: boolean;
  /** Appelé au relâchement, seulement si la ligne a changé de rang. */
  onDrop: (nextOrder: number[], teamId: number, targetIndex: number) => void;
};

export function useSeedingDrag({ order, enabled, onDrop }: UseSeedingDragOptions): SeedingDrag {
  const rows = useRef(new Map<number, HTMLElement | null>());
  const session = useRef<DragSession | null>(null);

  const [draggingTeamId, setDraggingTeamId] = useState<number | null>(null);
  const [targetIndex, setTargetIndex] = useState<number | null>(null);

  // Le geste lit l'ordre et le rappel au fil des mouvements : passer par des
  // refs évite de réabonner les écouteurs de fenêtre à chaque rendu — et un
  // réabonnement en plein glissement perdrait la capture du pointeur.
  const orderRef = useRef(order);
  orderRef.current = order;
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  const setRowRef = useCallback(
    (teamId: number) => (node: HTMLElement | null) => {
      if (node) rows.current.set(teamId, node);
      else rows.current.delete(teamId);
    },
    [],
  );

  /** Fin du geste, quelle qu'en soit la cause : plus rien ne doit rester tiré. */
  const endSession = useCallback(() => {
    session.current = null;
    setDraggingTeamId(null);
    setTargetIndex(null);
  }, []);

  const updateTarget = useCallback(() => {
    const current = session.current;
    if (!current || !current.active) return;
    const pageY = current.pointerClientY + window.scrollY;
    const next = dropIndexAt(current.slotMidpoints, pageY);
    current.targetIndex = next;
    setTargetIndex(next);
  }, []);

  const onPointerDown = useCallback(
    (teamId: number) => (event: React.PointerEvent<HTMLElement>) => {
      // Bouton principal seulement : un clic droit ouvre un menu contextuel, et
      // un clic milieu colle sous X11 — ni l'un ni l'autre n'est un glissement.
      if (!enabled || event.button !== 0 || session.current) return;

      const baseOrder = [...orderRef.current];
      const midpoints = baseOrder.map((id) => {
        const node = rows.current.get(id);
        if (!node) return Number.POSITIVE_INFINITY;
        const rect = node.getBoundingClientRect();
        return rect.top + rect.height / 2 + window.scrollY;
      });

      session.current = {
        teamId,
        pointerId: event.pointerId,
        baseOrder,
        slotMidpoints: midpoints,
        pointerClientY: event.clientY,
        originClientY: event.clientY,
        active: false,
        targetIndex: null,
      };

      // Sans capture, sortir de la poignée (ce qui arrive dès le premier
      // centimètre) couperait le flux d'événements au doigt comme au stylet.
      // Elle refuse un pointeur qui n'est plus actif (relâché entre-temps, ou
      // événement synthétique) : le geste tient sans elle grâce aux écouteurs
      // de fenêtre, on ne perd donc rien à laisser passer le refus.
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* pointeur inconnu du navigateur : on continue sans capture */
      }
      event.preventDefault();
    },
    [enabled],
  );

  // Écouteurs de fenêtre : le pointeur quitte la poignée dès le premier
  // mouvement, et le relâchement peut survenir n'importe où sur la page.
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = session.current;
      if (!current || event.pointerId !== current.pointerId) return;

      current.pointerClientY = event.clientY;

      if (!current.active) {
        if (Math.abs(event.clientY - current.originClientY) < DRAG_THRESHOLD_PX) return;
        current.active = true;
        setDraggingTeamId(current.teamId);
      }

      // Empêche la sélection de texte de suivre le pointeur pendant le geste.
      event.preventDefault();
      updateTarget();
    };

    const finish = (event: PointerEvent) => {
      const current = session.current;
      if (!current || event.pointerId !== current.pointerId) return;

      const { baseOrder, teamId, active, targetIndex: landing } = current;
      endSession();

      if (!active || landing === null) return;
      if (baseOrder.indexOf(teamId) === landing) return;
      // La liste a changé sous le geste (une inscription arrivée par le flux,
      // un désengagement) : l'ordre construit sur l'ancienne n'est plus une
      // permutation, et le serveur le refuserait en 400 — un « Ordre invalide »
      // au nom d'une faute que personne n'a commise. Le flux a déjà réaffiché
      // la bonne liste ; on abandonne le geste plutôt que d'écrire un ordre faux.
      // Le contrôle est celui du serveur, mot pour mot (`isValidSeedOrder`) :
      // en réécrire un second ici, c'est se donner deux définitions du refus.
      if (!isValidSeedOrder(orderRef.current, baseOrder)) return;

      onDropRef.current(moveToIndex(baseOrder, teamId, landing), teamId, landing);
    };

    const cancel = (event: PointerEvent) => {
      if (session.current && event.pointerId === session.current.pointerId) endSession();
    };

    // Échapper annule : le geste est réversible tant qu'on n'a pas relâché.
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && session.current) {
        event.preventDefault();
        endSession();
      }
    };

    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
    };
  }, [endSession, updateTarget]);

  // Défilement automatique aux bords : sans lui, le geste ne porterait que sur
  // ce qui tient à l'écran — trente engagés n'y tiennent pas.
  useEffect(() => {
    if (draggingTeamId === null) return;

    let frame = 0;
    let previous = performance.now();

    const step = (now: number) => {
      const elapsed = (now - previous) / 1000;
      previous = now;

      const current = session.current;
      if (current) {
        const velocity = autoScrollVelocity(current.pointerClientY, window.innerHeight);
        if (velocity !== 0) window.scrollBy(0, velocity * elapsed);
        // Relevé à chaque image, et pas seulement quand *nous* défilons : la
        // molette du lecteur déplace elle aussi la cible sous un pointeur
        // immobile, et aucun `pointermove` ne viendrait le rattraper.
        updateTarget();
      }

      frame = window.requestAnimationFrame(step);
    };

    frame = window.requestAnimationFrame(step);

    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.userSelect = previousUserSelect;
    };
  }, [draggingTeamId, updateTarget]);

  const previewOrder = useMemo(() => {
    const current = session.current;
    if (draggingTeamId === null || !current || targetIndex === null) return null;
    return moveToIndex(current.baseOrder, draggingTeamId, targetIndex);
  }, [draggingTeamId, targetIndex]);

  const handleProps = useCallback(
    (teamId: number) => ({ onPointerDown: onPointerDown(teamId) }),
    [onPointerDown],
  );

  return { draggingTeamId, previewOrder, setRowRef, handleProps };
}
