"use client";

import { useEffect, useRef } from "react";
import { usePalette } from "@/lib/palette-context";

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  colorIdx: number;
}

interface Proj {
  px: number; py: number;
  scale: number;
}

const PALETTES = {
  blue: [[89, 212, 255], [167, 115, 255], [79, 224, 162]] as [number, number, number][],
  gold: [[89, 212, 255], [245, 195, 58], [255, 157, 46]] as [number, number, number][],
};

export function Background3D() {
  const accent = usePalette();
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const colors = PALETTES[accent];
    const COUNT = 72;
    const RANGE = 660;
    const FOV = 500;
    const MAX_DIST = 195;

    const particles: Particle[] = Array.from({ length: COUNT }, (_, i) => ({
      x: (Math.random() - 0.5) * RANGE,
      y: (Math.random() - 0.5) * RANGE,
      z: (Math.random() - 0.5) * RANGE,
      vx: (Math.random() - 0.5) * 0.22,
      vy: (Math.random() - 0.5) * 0.22,
      vz: (Math.random() - 0.5) * 0.22,
      colorIdx: i % colors.length,
    }));

    const proj = new Array<Proj>(COUNT);
    let angle = 0;
    let raf: number;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const cosX = Math.cos(0.13);
    const sinX = Math.sin(0.13);

    const frame = () => {
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      angle += 0.00048;

      const cosY = Math.cos(angle);
      const sinY = Math.sin(angle);

      for (let i = 0; i < COUNT; i++) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy; p.z += p.vz;
        if (Math.abs(p.x) > RANGE / 2) p.vx *= -1;
        if (Math.abs(p.y) > RANGE / 2) p.vy *= -1;
        if (Math.abs(p.z) > RANGE / 2) p.vz *= -1;

        const rx = p.x * cosY - p.z * sinY;
        let rz = p.x * sinY + p.z * cosY;
        const ry = p.y * cosX - rz * sinX;
        rz = p.y * sinX + rz * cosX;

        const depth = FOV + rz + RANGE / 2;
        const scale = depth > 1 ? Math.min(FOV / depth, 2) : 0;
        proj[i] = { px: rx * scale + W / 2, py: ry * scale + H / 2, scale };
      }

      // Connections
      for (let i = 0; i < COUNT; i++) {
        for (let j = i + 1; j < COUNT; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dz = particles[i].z - particles[j].z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > MAX_DIST * MAX_DIST) continue;
          const dist = Math.sqrt(d2);
          const s = (proj[i].scale + proj[j].scale) / 2;
          const alpha = (1 - dist / MAX_DIST) * 0.26 * s;
          const [r, g, b] = colors[particles[i].colorIdx];
          ctx.beginPath();
          ctx.moveTo(proj[i].px, proj[i].py);
          ctx.lineTo(proj[j].px, proj[j].py);
          ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
          ctx.lineWidth = Math.max(0.3, s * 0.65);
          ctx.stroke();
        }
      }

      // Particles
      for (let i = 0; i < COUNT; i++) {
        const { px, py, scale } = proj[i];
        if (scale < 0.05) continue;
        const [r, g, b] = colors[particles[i].colorIdx];
        const rCore = scale * 3;
        const rGlow = rCore * 3.8;
        const opacity = Math.min(0.88, scale * 0.78);

        const grad = ctx.createRadialGradient(px, py, 0, px, py, rGlow);
        grad.addColorStop(0, `rgba(${r},${g},${b},${opacity * 0.32})`);
        grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.beginPath();
        ctx.arc(px, py, rGlow, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(px, py, rCore, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${opacity})`;
        ctx.fill();
      }

      raf = requestAnimationFrame(frame);
    };

    frame();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [accent]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        pointerEvents: "none",
        zIndex: 0,
        opacity: 0.44,
      }}
    />
  );
}
