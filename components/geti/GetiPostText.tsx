"use client";

import { useEffect, useId, useRef, useState } from "react";
import styles from "./geti.module.css";

/**
 * Texte d'une annonce, replié quand il est long. Rendu en **nœud de texte**
 * (retours à la ligne gardés par la feuille de style) : rien n'y est interprété.
 *
 * `long` (longueur du texte) décide du rendu serveur ; une fois la page
 * chargée, le bouton « Lire la suite » ne reste que si le texte replié
 * dépasse réellement (sur grand écran, un long paragraphe peut tenir).
 */
export function GetiPostText({
  body,
  long,
  text,
}: Readonly<{ body: string; long: boolean; text: { more: string; less: string } }>) {
  const [open, setOpen] = useState(false);
  const [overflowing, setOverflowing] = useState(long);
  const textRef = useRef<HTMLParagraphElement>(null);
  const id = useId();
  useEffect(() => {
    const element = textRef.current;
    if (!long || open || !element) return;
    const measure = () => setOverflowing(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [long, open, body]);
  if (body === "") return null;
  const collapsible = long && (open || overflowing);
  const clamped = long && !open;
  return (
    <div className={styles.body}>
      <p ref={textRef} id={id} className={clamped ? `${styles.bodyText} ${styles.bodyClamped}` : styles.bodyText}>
        {body}
      </p>
      {collapsible ? (
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
