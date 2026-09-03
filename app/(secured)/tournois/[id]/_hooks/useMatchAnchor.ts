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

/**
 * Délai de la passe de contrôle du placement.
 *
 * La page continue de vivre après le défilement : un instantané SSE peut
 * rallonger un classement, déplier un bandeau de diffusion, et faire descendre
 * la carte hors de l'écran juste après qu'on l'y a amenée.
 */
const SETTLE_CHECK_MS = 700;

/** Durée du surlignage d'arrivée. Assez long pour être vu, assez court pour ne
 *  pas devenir un état permanent de la carte. */
const HIGHLIGHT_MS = 3_000;

/**
 * Gestes par lesquels le lecteur reprend la main sur la page.
 *
 * La recherche peut durer vingt secondes ; pendant ce temps la page est
 * utilisable, et arriver après coup pour recadrer et déplacer le focus
 * arracherait le curseur d'un champ de score en cours de saisie. Ces
 * évènements-là ne peuvent venir que d'une personne — un `mousemove` ne compte
 * pas, et `scroll` non plus : c'est *nous* qui le déclenchons.
 */
const READER_GESTURES = ["pointerdown", "keydown", "wheel", "touchstart"] as const;

export type MatchAnchorState = {
  /** Match cherché, tant qu'il n'a pas été trouvé (ou que l'attente dure). */
  targetMatchId: number | null;
  /** Match trouvé, le temps du surlignage. */
  highlightedMatchId: number | null;
};

type UseMatchAnchorOptions = {
  /**
   * Tournoi affiché.
   *
   * Il n'entre dans aucun calcul : il sert de **remise à zéro**. L'App Router
   * réutilise la page d'un paramètre à l'autre — `/tournois/5` → `/tournois/7`
   * ne la remonte pas —, et une navigation client passe par `history.pushState`,
   * qui ne déclenche **pas** de `hashchange`. Sans cette dépendance, l'ancre du
   * second tournoi serait purement ignorée, et le halo du premier pourrait
   * suivre sur une manche de même identifiant. C'est la précaution que prennent
   * déjà `useTournamentLive` et les trois dialogues de la page.
   */
  tournamentId: number;
  /** Matchs connus du tournoi ; `undefined` tant que le flux n'a rien apporté. */
  matches: readonly PhasedMatch[] | null | undefined;
  /** Phase affichée (`MULTI` uniquement), pour savoir s'il faut en changer. */
  selectedPhaseId: number | null;
  /** Sélection d'une phase — `setSelectedPhaseId` de la page. */
  onSelectPhase: (phaseId: number) => void;
};

/**
 * Amène la carte au centre de l'écran **et** de sa zone défilante.
 *
 * `block`/`inline: "center"` fait défiler *tous* les conteneurs ancestraux :
 * c'est ce qui rend l'ancre valable à l'intérieur d'un `<ScrollArea>` horizontal
 * (arbre, rondes suisses, rounds de survie) sans que la zone défilante ait quoi
 * que ce soit à savoir de l'ancre.
 *
 * Le défilement est **instantané**, et c'est délibéré. C'est déjà ce que fait un
 * navigateur sur une ancre native — on arrive à destination, on ne s'y rend pas.
 * Et surtout, un défilement animé s'étale sur plusieurs frames, pendant
 * lesquelles la page vit encore : le flux SSE re-rend le plateau, la phase
 * bascule, un volet se déplie. L'animation y est avalée sans la moindre erreur —
 * l'ancre laissait alors le lecteur en haut de la page, avec le halo allumé sur
 * une carte qu'il ne voyait pas.
 */
function centerInView(element: HTMLElement): void {
  element.scrollIntoView({ block: "center", inline: "center" });
}

/** La carte touche-t-elle encore l'écran ? */
function isOnScreen(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return (
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < window.innerHeight &&
    rect.left < window.innerWidth
  );
}

/**
 * Ouvre la fiche du tournoi défilée sur le match désigné par `#match-[id]`.
 *
 * Cinq étapes, volontairement séparées — chacune peut échouer seule sans
 * empêcher les autres d'aboutir :
 *
 * 1. **Lire le fragment** (au montage, et à chaque `hashchange` : un second clic
 *    sur un autre match depuis la même page ne remonte pas le composant).
 * 2. **Révéler la phase** qui contient le match, en `MULTI` — une seule fois par
 *    cible (`phaseAppliedFor`), sinon un clic du lecteur sur une autre phase
 *    serait défait par l'ancre à chaque instantané SSE.
 * 3. **Chercher l'élément puis défiler.** La recherche est répétée, parce que la
 *    cible peut n'être rendue que plus tard : le flux SSE apporte le plateau, la
 *    phase bascule, et `BracketSections` déplie le volet où dort le match (il
 *    n'en rend qu'un à la fois sur un gros tableau).
 * 4. **Contrôler le placement** une fois la page retombée : elle continue de
 *    vivre après le défilement, et un instantané peut chasser la carte de
 *    l'écran juste après qu'on l'y a amenée.
 * 5. **Éteindre le surlignage.**
 *
 * Le fragment n'est **pas** effacé de l'URL après usage : le lien reste
 * copiable et partageable, et un rechargement doit redéfiler au même endroit.
 *
 * Renvoie **deux** identifiants, qui ne valent pas au même moment : la `cible`
 * tant que le match est cherché — c'est elle qui fait déplier le volet où il
 * dort (`BracketSections`) — puis le `surlignage`, une fois arrivé.
 */
export function useMatchAnchor({
  tournamentId,
  matches,
  selectedPhaseId,
  onSelectPhase,
}: UseMatchAnchorOptions): MatchAnchorState {
  const [target, setTarget] = useState<number | null>(null);
  const [highlighted, setHighlighted] = useState<number | null>(null);
  /** Instant d'abandon de la recherche en cours. */
  const deadlineRef = useRef(0);
  /** Cible dont la phase a déjà été révélée. */
  const phaseAppliedFor = useRef<number | null>(null);
  /** Le lecteur a-t-il pris la main depuis que cette cible est cherchée ? */
  const readerTookOver = useRef(false);

  // 1. Le fragment d'URL.
  //
  // Relancé à chaque changement de tournoi, parce que la page n'est pas remontée
  // pour autant et qu'un `pushState` ne produit pas de `hashchange`.
  useEffect(() => {
    // Ce qui restait de la cible précédente ne concerne pas ce tournoi-ci.
    setTarget(null);
    setHighlighted(null);
    phaseAppliedFor.current = null;

    const read = () => {
      const matchId = parseMatchAnchor(window.location.hash);
      if (matchId === null) return;
      deadlineRef.current = Date.now() + LOOKUP_TIMEOUT_MS;
      phaseAppliedFor.current = null;
      // Le clic qui a mené ici a produit son propre `pointerdown`, mais **avant**
      // cet effet : la marque repart donc de zéro pour la nouvelle cible.
      readerTookOver.current = false;
      setTarget(matchId);
    };

    // Gestes qui ne peuvent venir que du lecteur — un `mousemove` n'en est pas
    // un, et le défilement, non plus : celui qu'on déclenche nous-mêmes lèverait
    // la marque qu'il est censé poser.
    const takeOver = () => {
      readerTookOver.current = true;
    };

    read();
    window.addEventListener("hashchange", read);
    for (const event of READER_GESTURES) {
      window.addEventListener(event, takeOver, { passive: true });
    }
    return () => {
      window.removeEventListener("hashchange", read);
      for (const event of READER_GESTURES) window.removeEventListener(event, takeOver);
    };
  }, [tournamentId]);

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
        // Le lecteur a pris la main entre-temps : on renonce au déplacement,
        // pas au repère. Le halo reste — il désigne toujours la manche qu'il
        // venait voir, et il la trouvera en défilant — mais on ne lui arrache
        // ni sa position ni son curseur.
        if (!readerTookOver.current) {
          centerInView(element);
          // Le focus suit, sans son propre recadrage : c'est ce que fait le
          // navigateur sur une ancre native, et c'est ce qui annonce la carte à
          // un lecteur d'écran — le halo et le défilement ne disent rien à qui
          // ne voit pas la page.
          element.focus({ preventScroll: true });
        }
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

  // 4. Contrôle du placement, une fois la page retombée.
  useEffect(() => {
    if (highlighted === null) return;

    const timer = setTimeout(() => {
      // Même règle qu'à l'arrivée : on ne rattrape que la page, jamais le
      // lecteur. S'il a bougé de lui-même, la carte est hors écran parce qu'il
      // l'a voulu.
      if (readerTookOver.current) return;
      const element = document.getElementById(matchAnchorId(highlighted));
      // On ne recadre que si la carte a réellement quitté l'écran : la corriger
      // d'office serait un second saut sans raison.
      if (element && !isOnScreen(element)) centerInView(element);
    }, SETTLE_CHECK_MS);

    return () => clearTimeout(timer);
  }, [highlighted]);

  // 5. Extinction du surlignage.
  useEffect(() => {
    if (highlighted === null) return;
    const timer = setTimeout(() => setHighlighted(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlighted]);

  return { targetMatchId: target, highlightedMatchId: highlighted };
}
