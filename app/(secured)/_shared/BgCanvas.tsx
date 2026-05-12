"use client";

import { useEffect, useRef } from "react";
import s from "./annuaire.module.css";

type BgCanvasMode = "radial" | "network";

type BgCanvasProps = {
  rgb?: string;
  mode?: BgCanvasMode;
};

const DEFAULT_RADIAL_RGB = "89, 212, 255";
const DEFAULT_NETWORK_RGB = "90,200,255";

export function BgCanvas({ rgb, mode = "radial" }: BgCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (mode === "network") {
      let raf = 0;
      let width = 0;
      let height = 0;
      const color = rgb || DEFAULT_NETWORK_RGB;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      const resizeCanvas = () => {
        width = canvas.width = Math.floor(window.innerWidth * dpr);
        height = canvas.height = Math.floor(window.innerHeight * dpr);
        canvas.style.width = `${window.innerWidth}px`;
        canvas.style.height = `${window.innerHeight}px`;
      };

      resizeCanvas();
      window.addEventListener("resize", resizeCanvas);

      const nodeCount = 26;
      const nodes = Array.from({ length: nodeCount }, () => ({
        x: Math.random() * 1200,
        y: Math.random() * 800,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.18,
      }));

      const draw = () => {
        ctx.clearRect(0, 0, width, height);
        const sx = width / 1200;
        const sy = height / 800;

        ctx.fillStyle = "rgba(180,210,230,0.08)";
        for (let gx = 0; gx < 1200; gx += 60) {
          for (let gy = 0; gy < 800; gy += 60) {
            ctx.fillRect(gx * sx, gy * sy, 1, 1);
          }
        }

        nodes.forEach((node) => {
          node.x += node.vx;
          node.y += node.vy;
          if (node.x < 0 || node.x > 1200) node.vx *= -1;
          if (node.y < 0 || node.y > 800) node.vy *= -1;
        });

        ctx.strokeStyle = `rgba(${color},0.10)`;
        ctx.lineWidth = 1;
        for (let i = 0; i < nodeCount; i += 1) {
          for (let j = i + 1; j < nodeCount; j += 1) {
            const dx = nodes[i].x - nodes[j].x;
            const dy = nodes[i].y - nodes[j].y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < 180) {
              ctx.globalAlpha = (1 - distance / 180) * 0.6;
              ctx.beginPath();
              ctx.moveTo(nodes[i].x * sx, nodes[i].y * sy);
              ctx.lineTo(nodes[j].x * sx, nodes[j].y * sy);
              ctx.stroke();
            }
          }
        }

        ctx.globalAlpha = 1;
        ctx.fillStyle = `rgba(${color},0.5)`;
        nodes.forEach((node) => {
          ctx.beginPath();
          ctx.arc(node.x * sx, node.y * sy, 1.4, 0, Math.PI * 2);
          ctx.fill();
        });

        raf = requestAnimationFrame(draw);
      };

      draw();

      return () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", resizeCanvas);
      };
    }

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    resizeCanvas();

    const color = rgb || DEFAULT_RADIAL_RGB;
    let raf = 0;

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const gradient = ctx.createRadialGradient(
        canvas.width * 0.7,
        canvas.height * 0.3,
        0,
        canvas.width * 0.7,
        canvas.height * 0.3,
        canvas.width
      );

      gradient.addColorStop(0, `rgba(${color}, 0.15)`);
      gradient.addColorStop(0.5, `rgba(${color}, 0.08)`);
      gradient.addColorStop(1, `rgba(${color}, 0)`);

      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      raf = requestAnimationFrame(animate);
    };

    animate();

    window.addEventListener("resize", resizeCanvas);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [rgb, mode]);

  return <canvas ref={canvasRef} className={s.bgCanvas} />;
}
