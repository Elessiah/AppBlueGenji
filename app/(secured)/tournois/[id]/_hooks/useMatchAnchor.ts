"use client";

import { useEffect, useRef, useState } from "react";
import {
  matchAnchorId,
  parseMatchAnchor,
  phaseRevealingMatch,
  type PhasedMatch,
} from "@/lib/shared/match-anchor";

/**
 * Combien de temps l'ancre reste-t-elle en attente de sa cible ?
 *
 * Le plateau n'arrive **pas** au premier rendu : la page ouvre le flux SSE, et
 * c'est lui qui apporte les matchs. Chercher l'élément une seule fois après le
 * montage ne trouverait donc jamais rien. On guette, et on renonce au bout de
 * ce délai — un identifiant qui ne désigne aucun match de ce tournoi (manche
 * d'un autre tournoi, plateau régénéré depuis, manche qualificative masquée par
 * les play-offs d'une BG Survie) ne doit pas laisser une boucle derrière lui.
 */
const LOOKUP_TIMEOUT_MS = 20_000;

/** Cadence de la recherche. Un `setTimeout` plutôt qu'un `requestAnimationFrame` :
 *  la cible peut arriver alors que l'onglet est en arrière-plan, où les frames
 *  ne sont plus servies. */
const LOOKUP_INTERVAL_MS = 100;

/** Durée du surlignage d'arrivée. Assez long pour être vu, assez court pour ne
 *  pas devenir un état permanent de la carte. */
const HIGHLIGHT_MS = 3_000;

type UseMatchAnchorOptions = {
  /** Matchs connus du tournoi ; `undefined` tant que le flux n'a rien apporté. */
  matches: readonly PhasedMatch[] | null | undefined;
  /** Phase affichée (`MULTI` uniquement), pour savoir s'il faut en changer. */
  selectedPhaseId: number | null;
  /** Sélection d'une phase — `setSelectedPhaseId` de la page. */
  onSelectPhase: (phaseId: number) => void;
};

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Ouvre la fiche du tournoi défilée sur le match désigné par `#match-[id]`.
 *
 * Trois étapes, volontairement séparées — chacune peut échouer seule sans
 * empêcher les autres d'aboutir :
 *
 * 1. **Lire le fragment** (au montage, et à chaque `hashchange` : un second clic
 *    sur un autre match depuis la même page ne remonte pas le composant).
 * 2. **Révéler la phase** qui contient le match, en `MULTI` — une seule fois par
 *    cible (`phaseAppliedFor`), sinon un clic du lecteur sur une autre phase
 *    serait défait par l'ancre à chaque instantané SSE.
 * 3. **Chercher l'élément puis défiler.** `scrollIntoView` avec
 *    `block`/`inline: "center"` fait défiler *tous* les conteneurs ancestraux —
 *    c'est ce qui rend l'ancre valable à l'intérieur d'un `<ScrollArea>`
 *    horizontal (arbre, rondes suisses, rounds de survie) sans que la zone
 *    défilante ait quoi que ce soit à savoir de l'ancre.
 *
 * Le fragment n'est **pas** effacé de l'URL après usage : le lien reste
 * copiable et partageable, et un rechargement doit redéfiler au même endroit.
 *
 * Renvoie l'identifiant du match à surligner (`null` hors surlignage).
 */
export function useMatchAnchor({
  matches,
  selectedPhaseId,
  onSelectPhase,
}: UseMatchAnchorOptions): number | null {
  const [target, setTarget] = useState<number | null>(null);
  const [highlighted, setHighlighted] = useState<number | null>(null);
  /** Instant d'abandon de la recherche en cours. */
  const deadlineRef = useRef(0);
  /** Cible dont la phase a déjà été révélée. */
  const phaseAppliedFor = useRef<number | null>(null);

  // 1. Le fragment d'URL.
  useEffect(() => {
    const read = () => {
      const matchId = parseMatchAnchor(window.location.hash);
      if (matchId === null) return;
      deadlineRef.current = Date.now() + LOOKUP_TIMEOUT_MS;
      phaseAppliedFor.current = null;
      setTarget(matchId);
    };

    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  // 2. La phase qui contient la cible (`MULTI`).
  useEffect(() => {
    if (target === null) return;
    if (phaseAppliedFor.current === target) return;

    const phaseId = phaseRevealingMatch(matches, target, selectedPhaseId);
    // Cible encore inconnue : on ne marque rien, la bascule sera retentée dès
    // que le flux aura apporté le plateau.
    if (phaseId === null) return;

    phaseAppliedFor.current = target;
    onSelectPhase(phaseId);
  }, [target, matches, selectedPhaseId, onSelectPhase]);

  // 3. L'élément, puis le défilement.
  useEffect(() => {
    if (target === null) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const look = () => {
      if (cancelled) return;

      const element = document.getElementById(matchAnchorId(target));
      if (element) {
        element.scrollIntoView({
          behavior: prefersReducedMotion() ? "auto" : "smooth",
          block: "center",
          inline: "center",
        });
        setHighlighted(target);
        setTarget(null);
        return;
      }

      if (Date.now() >= deadlineRef.current) {
        setTarget(null);
        return;
      }
      timer = setTimeout(look, LOOKUP_INTERVAL_MS);
    };

    look();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [target]);

  // 4. Extinction du surlignage.
  useEffect(() => {
    if (highlighted === null) return;
    const timer = setTimeout(() => setHighlighted(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlighted]);

  return highlighted;
}
