"use client";

import { useId, useState } from "react";
import styles from "./geti.module.css";

/**
 * Texte d'une annonce, replié quand il est long. Rendu en **nœud de texte**
 * (retours à la ligne gardés par la feuille de style) : rien n'y est interprété.
 */
export function GetiPostText({
  body,
  long,
  text,
}: Readonly<{ body: string; long: boolean; text: { more: string; less: string } }>) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (body === "") return null;
  const clamped = long && !open;
  return (
    <div className={styles.body}>
      <p id={id} className={clamped ? `${styles.bodyText} ${styles.bodyClamped}` : styles.bodyText}>
        {body}
      </p>
      {long ? (
        <button
          type="button"
          className={styles.more}
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? text.less : text.more}
        </button>
      ) : null}
    </div>
  );
}
