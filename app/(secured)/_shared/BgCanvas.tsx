"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { useClientPower } from "@/lib/shared/hooks/useClientPower";
import type { CanvasPolicy } from "@/lib/shared/client-power";
import s from "./annuaire.module.css";

type BgCanvasMode = "radial" | "network";

type BgCanvasProps = {
  rgb?: string;
  mode?: BgCanvasMode;
};

const DEFAULT_RADIAL_RGB = "89, 212, 255";
const DEFAULT_NETWORK_RGB = "90,200,255";

/**
 * Plafond de cadence du fond animé. Un écran de joueur rafraîchit à 144 ou
 * 240 Hz, et `requestAnimationFrame` le suit : des nœuds qui dérivent d'un
 * dixième de pixel par image n'ont pas besoin de plus de trente images par
 * seconde pour paraître fluides.
 */
export const NETWORK_FRAME_INTERVAL_MS = 1000 / 30;

/** Espace logique du réseau, étiré à la fenêtre au dessin. */
const SPACE_W = 1200;
const SPACE_H = 800;
const NODE_COUNT = 26;

type Node = { x: number; y: number; vx: number; vy: number };

function createNodes(): Node[] {
  return Array.from({ length: NODE_COUNT }, () => ({
    x: Math.random() * SPACE_W, // NOSONAR typescript:S2245 — animation décorative, aucun usage de sécurité
    y: Math.random() * SPACE_H, // NOSONAR typescript:S2245 — animation décorative, aucun usage de sécurité
    vx: (Math.random() - 0.5) * 0.18, // NOSONAR typescript:S2245 — animation décorative, aucun usage de sécurité
    vy: (Math.random() - 0.5) * 0.18, // NOSONAR typescript:S2245 — animation décorative, aucun usage de sécurité
  }));
}

/**
 * Fond des annuaires et de la liste des tournois.
 *
 * - `radial` est un **dégradé fixe** : il est rendu en CSS. Il était dessiné sur
 *   un canevas plein écran **à chaque image**, pour toujours — soixante à deux
 *   cent quarante fois par seconde le même dégradé, plus un tampon de pixels de
 *   la taille de la fenêtre gardé en mémoire.
 * - `network` est une vraie animation, soumise au régime de charge
 *   (`lib/shared/client-power.ts`) : animée quand la page est regardée, figée
 *   sur sa dernière image quand elle ne l'est plus, et **libérée** (tampon rendu
 *   au navigateur) quand l'onglet est caché ou que le lecteur est en match.
 */
export function BgCanvas({ rgb, mode = "radial" }: Readonly<BgCanvasProps>) {
  if (mode === "radial") {
    const color = rgb || DEFAULT_RADIAL_RGB;
    // Même géométrie que l'ancien dessin : centre à 70 % / 30 %, rayon égal à
    // la largeur de la fenêtre.
    const style: CSSProperties = {
      background: `radial-gradient(circle 100vw at 70% 30%, rgba(${color}, 0.15) 0%, rgba(${color}, 0.08) 50%, rgba(${color}, 0) 100%)`,
    };
    return <div aria-hidden className={s.bgCanvas} style={style} />;
  }
  return <NetworkCanvas rgb={rgb || DEFAULT_NETWORK_RGB} />;
}

function NetworkCanvas({ rgb }: Readonly<{ rgb: string }>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Les nœuds survivent aux changements de régime : reprendre l'animation ne
  // doit pas faire sauter le réseau à une autre configuration.
  const nodesRef = useRef<Node[] | null>(null);
  const { canvas: policy } = useClientPower();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    nodesRef.current ??= createNodes();
    return runNetwork(canvas, rgb, policy, nodesRef.current);
  }, [rgb, policy]);

  return <canvas ref={canvasRef} aria-hidden className={s.bgCanvas} />; // NOSONAR S6825 — un <canvas> sans tabIndex n'est pas focalisable : fond décoratif
}

/** Trame de points fixe, une maille toutes les 60 unités de l'espace logique. */
function drawGrid(ctx: CanvasRenderingContext2D, sx: number, sy: number): void {
  ctx.fillStyle = "rgba(180,210,230,0.08)";
  for (let gx = 0; gx < SPACE_W; gx += 60) {
    for (let gy = 0; gy < SPACE_H; gy += 60) {
      ctx.fillRect(gx * sx, gy * sy, 1, 1);
    }
  }
}

/** Avance chaque nœud d'un pas, en le faisant rebondir sur les bords de l'espace. */
function advanceNodes(nodes: Node[]): void {
  for (const node of nodes) {
    node.x += node.vx;
    node.y += node.vy;
    if (node.x < 0 || node.x > SPACE_W) node.vx *= -1;
    if (node.y < 0 || node.y > SPACE_H) node.vy *= -1;
  }
}

/** Relie les nœuds proches (moins de 180 unités), d'autant plus nettement qu'ils le sont. */
function drawLinks(ctx: CanvasRenderingContext2D, nodes: Node[], rgb: string, sx: number, sy: number): void {
  ctx.strokeStyle = `rgba(${rgb},0.10)`;
  ctx.lineWidth = 1;
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const distance = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
      if (distance >= 180) continue;
      ctx.globalAlpha = (1 - distance / 180) * 0.6;
      ctx.beginPath();
      ctx.moveTo(nodes[i].x * sx, nodes[i].y * sy);
      ctx.lineTo(nodes[j].x * sx, nodes[j].y * sy);
      ctx.stroke();
    }
  }
}

/** Fait vivre le canevas selon `policy` ; rend la fonction de nettoyage. */
function runNetwork(
  canvas: HTMLCanvasElement,
  rgb: string,
  policy: CanvasPolicy,
  nodes: Node[],
): (() => void) | undefined {
  if (policy === "RELEASE") {
    // Un canevas de 0 × 0 n'a plus de tampon : c'est la seule façon de rendre
    // sa mémoire sans le retirer du DOM.
    canvas.width = 0;
    canvas.height = 0;
    return undefined;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;

  let width = 0;
  let height = 0;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const draw = (advance: boolean) => {
    ctx.clearRect(0, 0, width, height);
    const sx = width / SPACE_W;
    const sy = height / SPACE_H;

    drawGrid(ctx, sx, sy);
    if (advance) advanceNodes(nodes);
    drawLinks(ctx, nodes, rgb, sx, sy);

    ctx.globalAlpha = 1;
    ctx.fillStyle = `rgba(${rgb},0.5)`;
    for (const node of nodes) {
      ctx.beginPath();
      ctx.arc(node.x * sx, node.y * sy, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const resize = () => {
    width = canvas.width = Math.floor(window.innerWidth * dpr);
    height = canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    // Redimensionner efface le canevas : une image figée doit être reposée.
    if (policy === "STILL") draw(false);
  };

  resize();
  window.addEventListener("resize", resize);

  if (policy === "STILL") {
    return () => window.removeEventListener("resize", resize);
  }

  let raf = 0;
  let last = 0;
  const frame = (time: number) => {
    raf = requestAnimationFrame(frame);
    if (time - last < NETWORK_FRAME_INTERVAL_MS) return;
    last = time;
    draw(true);
  };
  draw(false);
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
  };
}
