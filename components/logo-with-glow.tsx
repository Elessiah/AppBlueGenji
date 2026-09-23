"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { useClientPower } from "@/lib/shared/hooks/useClientPower";

/** Pause des animations décoratives, pilotée par `ClientPowerRoot`. */
const DECO_ANIM_STATE = "var(--deco-anim-state)";

interface LogoWithGlowProps {
  src: string;
  alt: string;
  width: number;
  height: number;
  size?: "sm" | "md" | "lg";
  borderRadius?: number;
  borderColor?: string;
}

const sizeConfigs = {
  sm: { glow: 24, ring: 10, shadow: 12 },
  md: { glow: 36, ring: 16, shadow: 18 },
  lg: { glow: 70, ring: 32, shadow: 30 },
};

export function LogoWithGlow({
  src,
  alt,
  width,
  height,
  size = "sm",
  borderRadius = 12,
  borderColor = "rgba(89,212,255,0.3)",
}: LogoWithGlowProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const target = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });

  // Inclinaison qui suit la souris : la boucle ne tourne que **pendant** que le
  // halo rattrape le pointeur, et plus du tout quand la page n'est pas regardée
  // ou que le lecteur est en match (`lib/shared/client-power.ts`). Elle tournait
  // auparavant à la fréquence de l'écran pour toujours, souris immobile — 144
  // images par seconde sur un écran de joueur, pour un halo figé.
  const { decorativeMotion } = useClientPower();
  const tilts = size !== "sm" && decorativeMotion;

  useEffect(() => {
    if (!tilts) return;

    const wrap = wrapRef.current;
    let raf = 0;
    const tick = () => {
      raf = 0;
      const el = wrapRef.current;
      if (!el) return;
      const t = target.current;
      const c = current.current;
      c.x += (t.x - c.x) * 0.05;
      c.y += (t.y - c.y) * 0.05;
      el.style.transform = `rotateX(${c.x.toFixed(2)}deg) rotateY(${c.y.toFixed(2)}deg)`;
      // Rattrapé à un centième de degré près : plus rien à peindre.
      if (Math.abs(t.x - c.x) > 0.01 || Math.abs(t.y - c.y) > 0.01) {
        raf = requestAnimationFrame(tick);
      }
    };

    const onMove = (e: MouseEvent) => {
      const el = wrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = (e.clientX - cx) / (window.innerWidth * 0.4);
      const dy = (e.clientY - cy) / (window.innerHeight * 0.4);
      const amplitude = size === "md" ? 10 : 14;
      target.current = {
        x: Math.max(-1, Math.min(1, dy)) * amplitude,
        y: Math.max(-1, Math.min(1, dx)) * amplitude,
      };
      if (raf === 0) raf = requestAnimationFrame(tick);
    };

    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (raf !== 0) cancelAnimationFrame(raf);
      // Le halo se remet droit : laissé à sa dernière inclinaison, il resterait
      // de travers pendant tout le régime éco ou match.
      target.current = { x: 0, y: 0 };
      current.current = { x: 0, y: 0 };
      if (wrap) wrap.style.transform = "";
    };
  }, [size, tilts]);

  const config = sizeConfigs[size];
  const hasAnimation = size !== "sm";

  return (
    <div
      style={{
        perspective: size === "sm" ? "none" : "800px",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        ref={wrapRef}
        style={{
          position: "relative",
          width,
          height,
          transformStyle: hasAnimation ? "preserve-3d" : "flat",
          willChange: tilts ? "transform" : "auto",
        }}
      >
        {/* Glow */}
        {hasAnimation && (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: -config.glow,
              borderRadius: "50%",
              background: `radial-gradient(circle, rgba(89,212,255,0.12) 0%, rgba(89,212,255,0.04) 50%, transparent 70%)`,
              animation: "logoPulseSmall 3.5s ease-in-out infinite",
              animationPlayState: DECO_ANIM_STATE,
              pointerEvents: "none",
            }}
          />
        )}

        {/* Orbit ring 1 - blue */}
        {size !== "sm" && (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: -config.ring,
              borderRadius: "50%",
              border: "1px solid rgba(89,212,255,0.18)",
              animation: "logoRing1 13s linear infinite",
              animationPlayState: DECO_ANIM_STATE,
              pointerEvents: "none",
            }}
          >
            <span
              style={{
                position: "absolute",
                top: "50%",
                right: -3,
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "rgb(89,212,255)",
                transform: "translateY(-50%)",
                boxShadow: "0 0 8px rgba(89,212,255,0.8)",
              }}
            />
          </div>
        )}

        {/* Orbit ring 2 - purple */}
        {size !== "sm" && (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: -(config.ring * 0.6),
              borderRadius: "50%",
              border: "1px solid rgba(167,115,255,0.16)",
              animation: "logoRing2 20s linear infinite",
              animationPlayState: DECO_ANIM_STATE,
              pointerEvents: "none",
            }}
          >
            <span
              style={{
                position: "absolute",
                top: -2,
                left: "50%",
                width: 4,
                height: 4,
                borderRadius: "50%",
                background: "rgb(167,115,255)",
                transform: "translateX(-50%)",
                boxShadow: "0 0 8px rgba(167,115,255,0.8)",
              }}
            />
          </div>
        )}

        {/* Image */}
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          style={{
            width,
            height,
            borderRadius,
            border: `1px solid ${borderColor}`,
            objectFit: "cover",
            filter: hasAnimation
              ? `drop-shadow(0 0 ${config.shadow}px rgba(89,212,255,0.25)) drop-shadow(0 0 6px rgba(0,0,0,0.4))`
              : "drop-shadow(0 0 8px rgba(0,0,0,0.3))",
            animation: hasAnimation ? "logoFloatSmall 4s ease-in-out infinite" : "none",
            animationPlayState: DECO_ANIM_STATE,
          }}
        />

        {/* Ground shadow */}
        {hasAnimation && (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              bottom: -config.shadow / 2,
              left: "50%",
              width: "70%",
              height: config.shadow / 3,
              borderRadius: "50%",
              background: `radial-gradient(ellipse, rgba(89,212,255,0.2) 0%, transparent 70%)`,
              filter: "blur(3px)",
              animation: "logoShadowSmall 4s ease-in-out infinite",
              animationPlayState: DECO_ANIM_STATE,
              pointerEvents: "none",
              transform: "translateX(-50%)",
            }}
          />
        )}
      </div>
    </div>
  );
}
