"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";

interface LogoWithGlowProps {
  src: string;
  alt: string;
  width: number;
  height: number;
  size?: "sm" | "md" | "lg";
  borderRadius?: number;
  borderColor?: string;
  unoptimized?: boolean;
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
  unoptimized,
}: LogoWithGlowProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const target = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const el = wrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = (e.clientX - cx) / (window.innerWidth * 0.4);
      const dy = (e.clientY - cy) / (window.innerHeight * 0.4);
      target.current = {
        x: Math.max(-1, Math.min(1, dy)) * (size === "sm" ? 6 : size === "md" ? 10 : 14),
        y: Math.max(-1, Math.min(1, dx)) * (size === "sm" ? 6 : size === "md" ? 10 : 14),
      };
    };

    let raf: number;
    const tick = () => {
      const el = wrapRef.current;
      if (el) {
        const t = target.current;
        const c = current.current;
        c.x += (t.x - c.x) * 0.05;
        c.y += (t.y - c.y) * 0.05;
        el.style.transform = `rotateX(${c.x.toFixed(2)}deg) rotateY(${c.y.toFixed(2)}deg)`;
      }
      raf = requestAnimationFrame(tick);
    };

    if (size !== "sm") {
      window.addEventListener("mousemove", onMove);
      raf = requestAnimationFrame(tick);
    }

    return () => {
      if (size !== "sm") {
        window.removeEventListener("mousemove", onMove);
        cancelAnimationFrame(raf);
      }
    };
  }, [size]);

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
          willChange: hasAnimation ? "transform" : "auto",
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
          unoptimized={unoptimized}
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
              pointerEvents: "none",
              transform: "translateX(-50%)",
            }}
          />
        )}
      </div>
    </div>
  );
}
