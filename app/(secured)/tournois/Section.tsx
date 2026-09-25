"use client";

import type { ReactNode } from "react";
import { useId, useState } from "react";
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
  const bodyId = useId();

  return (
    <div className={s.section} data-cols={dataCols}>
      {/* Un `<h2>` n'est pas du contenu phrasé : posé à l'intérieur d'un
          `<button>`, il n'y était pas autorisé. C'est le bouton qui va dans le
          titre, jamais l'inverse. */}
      <h2 className={s.sectionH2}>
        <button
          className={s.sectionHead}
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded((x) => !x)}
        >
          <span className={s.sectionIx}>{ix}</span>
          <span className={s.sectionTtl}>
            {title}
            {accent && <span className={s.sectionAccent}> {accent}</span>}
          </span>
          <span className={s.sectionCount}>{count}</span>
          <svg className={s.sectionCaret} width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 6L8 9L6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </h2>

      {expanded &&
        (count === 0 ? (
          <div id={bodyId} className={`${s.sectionBody} ${s.empty}`}>
            <div className={s.emptyTitle}>Vide</div>
            <div className={s.emptyMsg}>{emptyMsg}</div>
          </div>
        ) : (
          <div id={bodyId} className={s.sectionBody}>{children}</div>
        ))}
    </div>
  );
}
