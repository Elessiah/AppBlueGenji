"use client";

import { useState, useEffect } from "react";
import styles from "./CountdownStrip.module.css";

interface CountdownStripProps {
  targetISO: string;
  label?: string;
}

function useCountdown(targetISO: string) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const target = new Date(targetISO);
  let delta = Math.max(0, target.getTime() - now.getTime());
  const d = Math.floor(delta / 86400000);
  delta -= d * 86400000;
  const h = Math.floor(delta / 3600000);
  delta -= h * 3600000;
  const m = Math.floor(delta / 60000);
  delta -= m * 60000;
  const s = Math.floor(delta / 1000);

  const pad = (n: number) => String(n).padStart(2, "0");
  return { d: pad(d), h: pad(h), m: pad(m), s: pad(s) };
}

export function CountdownStrip({ targetISO, label }: CountdownStripProps) {
  const { d, h, m, s } = useCountdown(targetISO);

  return (
    <div className={styles.root}>
      {label && <div className={styles.label}>{label}</div>}
      <div className={styles.countdown}>
        {[
          { label: "J", value: d },
          { label: "H", value: h },
          { label: "M", value: m },
          { label: "S", value: s },
        ].map(({ label: lbl, value }) => (
          <div key={lbl} className={styles.unit}>
            <div className={`num ${styles.val}`}>{value}</div>
            <div className={`mono ${styles.lbl}`}>{lbl}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
