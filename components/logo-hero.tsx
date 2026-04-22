"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";

export function LogoHero() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const target = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const dx = (e.clientX / window.innerWidth - 0.5) * 2;
      const dy = (e.clientY / window.innerHeight - 0.5) * 2;
      target.current = { x: dy * -14, y: dx * 14 };
    };

    let raf: number;
    const tick = () => {
      const el = wrapRef.current;
      if (el) {
        const t = target.current;
        const c = current.current;
        c.x += (t.x - c.x) * 0.055;
        c.y += (t.y - c.y) * 0.055;
        el.style.transform = `rotateX(${c.x.toFixed(2)}deg) rotateY(${c.y.toFixed(2)}deg)`;
      }
      raf = requestAnimationFrame(tick);
    };

    window.addEventListener("mousemove", onMove);
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div style={{ perspective: "900px", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div
        ref={wrapRef}
        style={{
          transformStyle: "preserve-3d",
          willChange: "transform",
          position: "relative",
          width: 310,
          height: 310,
        }}
      >
        {/* Radial glow behind logo */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: "-70px",
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(89,212,255,0.16) 0%, rgba(89,212,255,0.05) 45%, transparent 70%)",
            animation: "logoPulse 3.8s ease-in-out infinite",
            pointerEvents: "none",
          }}
        />

        {/* Outer orbit ring — blue dot */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: "-32px",
            borderRadius: "50%",
            border: "1px solid rgba(89,212,255,0.18)",
            animation: "logoRing1 13s linear infinite",
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              position: "absolute",
              top: "50%",
              right: -4,
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "rgb(89,212,255)",
              transform: "translateY(-50%)",
              boxShadow: "0 0 10px 2px rgba(89,212,255,0.7)",
            }}
          />
        </div>

        {/* Inner orbit ring — purple dot */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: "-18px",
            borderRadius: "50%",
            border: "1px solid rgba(167,115,255,0.16)",
            animation: "logoRing2 20s linear infinite",
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              position: "absolute",
              top: -3,
              left: "50%",
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "rgb(167,115,255)",
              transform: "translateX(-50%)",
              boxShadow: "0 0 10px 2px rgba(167,115,255,0.7)",
            }}
          />
        </div>

        {/* Logo — floating animation */}
        <div style={{ animation: "logoFloat 4.6s ease-in-out infinite", position: "relative", zIndex: 1 }}>
          <Image
            src="/logo_bg.webp"
            alt="BlueGenji Arena"
            width={310}
            height={310}
            priority
            style={{
              display: "block",
              filter:
                "drop-shadow(0 0 36px rgba(89,212,255,0.28)) drop-shadow(0 0 10px rgba(89,212,255,0.14)) drop-shadow(0 10px 28px rgba(0,0,0,0.55))",
            }}
          />
        </div>

        {/* Ground glow shadow */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            bottom: -28,
            left: "50%",
            width: "52%",
            height: 18,
            borderRadius: "50%",
            background: "radial-gradient(ellipse, rgba(89,212,255,0.24) 0%, transparent 70%)",
            filter: "blur(7px)",
            animation: "logoShadow 4.6s ease-in-out infinite",
            pointerEvents: "none",
          }}
        />
      </div>
    </div>
  );
}
