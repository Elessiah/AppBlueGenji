"use client";

import { useEffect, useRef, useState } from "react";
import { type ContactKind, contactHref, decodeContact } from "@/lib/shared/obfuscated-contact";
import styles from "./protected-contact.module.css";

interface ProtectedContactProps {
  /** Valeur encodée par `encodeContact` — jamais la valeur lisible. */
  encoded: string;
  kind: ContactKind;
  /**
   * À qui appartient la coordonnée, pour le nom accessible du bouton
   * (« de l'association », « de l'hébergeur ») : plusieurs boutons « Afficher
   * le numéro » sur une page se distinguent ainsi au lecteur d'écran.
   */
  owner: string;
  /** Classe du bouton, pour l'accorder à son contexte (pied de page…). */
  buttonClassName?: string;
  /** Classe du lien révélé. */
  linkClassName?: string;
}

const VISIBLE_LABEL: Record<ContactKind, string> = {
  email: "Afficher l'adresse",
  phone: "Afficher le numéro",
};

const ACCESSIBLE_NOUN: Record<ContactKind, string> = {
  email: "électronique",
  phone: "de téléphone",
};

/**
 * Courriel ou numéro révélé **au geste** (`lib/shared/obfuscated-contact.ts`) :
 * le serveur ne rend qu'un bouton, la valeur n'est décodée qu'au clic, puis
 * rendue en lien `mailto:` / `tel:` qui reçoit le focus — le lecteur au clavier
 * reste là où il a agi, sur ce qu'il vient de demander.
 *
 * Le nom accessible **commence par le texte visible** (WCAG 2.5.3) : la
 * commande vocale « Afficher l'adresse » atteint le bouton, et la suite dit
 * laquelle.
 */
export function ProtectedContact({ encoded, kind, owner, buttonClassName, linkClassName }: Readonly<ProtectedContactProps>) {
  const [plain, setPlain] = useState<string | null>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const focusOnReveal = useRef(false);

  useEffect(() => {
    if (plain && focusOnReveal.current) {
      focusOnReveal.current = false;
      linkRef.current?.focus();
    }
  }, [plain]);

  if (!encoded) return null;

  if (plain) {
    return (
      <a ref={linkRef} className={`tap-target ${styles.revealed} ${linkClassName ?? ""}`.trim()} href={contactHref(kind, plain)}>
        {plain}
      </a>
    );
  }

  const visible = VISIBLE_LABEL[kind];
  return (
    <button
      type="button"
      className={`tap-target ${styles.reveal} ${buttonClassName ?? ""}`.trim()}
      aria-label={`${visible} ${ACCESSIBLE_NOUN[kind]} ${owner}`}
      onClick={() => {
        const decoded = decodeContact(encoded);
        if (!decoded) return;
        focusOnReveal.current = true;
        setPlain(decoded);
      }}
    >
      {visible}
    </button>
  );
}
