"use client";

import { useEffect, useRef } from "react";

export function BgCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // Skip animation if reduced motion is preferred
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const c = ref.current;
    if (!c) return;

    const ctx = c.getContext("2d");
    if (!ctx) return;

    let raf: number;
    let w: number;
    let h: number;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      w = c.width = window.innerWidth * dpr;
      h = c.height = window.innerHeight * dpr;
      c.style.width = window.innerWidth + "px";
      c.style.height = window.innerHeight + "px";
    };

    resize();
    window.addEventListener("resize", resize);

    const N = 26;
    const nodes = Array.from({ length: N }, () => ({
      x: Math.random() * 1200,
      y: Math.random() * 800,
      vx: (Math.random() - 0.5) * 0.18,
      vy: (Math.random() - 0.5) * 0.18,
    }));

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const sx = w / 1200;
      const sy = h / 800;

      // Grid dots
      ctx.fillStyle = "rgba(180,210,230,0.08)";
      for (let gx = 0; gx < 1200; gx += 60) {
        for (let gy = 0; gy < 800; gy += 60) {
          ctx.fillRect(gx * sx, gy * sy, 1, 1);
        }
      }

      // Nodes + connections
      nodes.forEach((n) => {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > 1200) n.vx *= -1;
        if (n.y < 0 || n.y > 800) n.vy *= -1;
      });

      ctx.strokeStyle = "rgba(90,200,255,0.10)";
      ctx.lineWidth = 1;
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 180) {
            ctx.globalAlpha = (1 - d / 180) * 0.6;
            ctx.beginPath();
            ctx.moveTo(nodes[i].x * sx, nodes[i].y * sy);
            ctx.lineTo(nodes[j].x * sx, nodes[j].y * sy);
            ctx.stroke();
          }
        }
      }

      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(90,200,255,0.5)";
      nodes.forEach((n) => {
        ctx.beginPath();
        ctx.arc(n.x * sx, n.y * sy, 1.4, 0, Math.PI * 2);
        ctx.fill();
      });

      raf = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        opacity: 0.55,
      }}
      aria-hidden="true"
    />
  );
}
