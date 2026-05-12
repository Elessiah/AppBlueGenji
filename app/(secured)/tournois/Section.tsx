"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import s from "./tournois.module.css";

interface SectionProps {
  ix: string;
  title: string;
  accent?: string;
  count: number;
  defaultOpen?: boolean;
  emptyMsg: string;
  dataCols?: "1" | "2" | "3";
  children: ReactNode;
}

export function Section({
  ix,
  title,
  accent,
  count,
  defaultOpen = true,
  emptyMsg,
  dataCols,
  children,
}: SectionProps) {
  const [expanded, setExpanded] = useState(defaultOpen);

  return (
    <div className={s.section} data-cols={dataCols}>
      <button
        className={s.sectionHead}
        aria-expanded={expanded}
        onClick={() => setExpanded((x) => !x)}
      >
        <span className={s.sectionIx}>{ix}</span>
        <h2 className={s.sectionTtl}>
          {title}
          {accent && <span className={s.sectionAccent}> {accent}</span>}
        </h2>
        <span className={s.sectionCount}>{count}</span>
        <svg className={s.sectionCaret} width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M10 6L8 9L6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      {expanded &&
        (count === 0 ? (
          <div className={`${s.sectionBody} ${s.empty}`}>
            <div className={s.emptyTitle}>Vide</div>
            <div className={s.emptyMsg}>{emptyMsg}</div>
          </div>
        ) : (
          <div className={s.sectionBody}>{children}</div>
        ))}
    </div>
  );
}
