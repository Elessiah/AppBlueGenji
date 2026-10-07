"use client";

import { useEffect, useRef, useState } from "react";
import { useShellText } from "@/components/i18n/shell-text";
import { type ContactKind, contactHref, decodeContact } from "@/lib/shared/obfuscated-contact";
import styles from "./protected-contact.module.css";

interface ProtectedContactProps {
  /** Valeur encodée par `encodeContact` — jamais la valeur lisible. */
  encoded: string;
  kind: ContactKind;
  /**
   * À qui appartient la coordonnée, pour le nom accessible du bouton, dans la
   * langue de la page (« de l'association », « of the host ») : plusieurs
   * boutons « Afficher le numéro » sur une page se distinguent ainsi au
   * lecteur d'écran.
   */
  owner: string;
  /** Classe du bouton, pour l'accorder à son contexte (pied de page…). */
  buttonClassName?: string;
  /** Classe du lien révélé. */
  linkClassName?: string;
}

/**
 * Courriel ou numéro révélé **au geste** (`lib/shared/obfuscated-contact.ts`) :
 * le serveur ne rend qu'un bouton, la valeur n'est décodée qu'au clic, puis
 * rendue en lien `mailto:` / `tel:` qui reçoit le focus — le lecteur au clavier
 * reste là où il a agi, sur ce qu'il vient de demander.
 *
 * Le nom accessible **commence par le texte visible** (WCAG 2.5.3) : la
 * commande vocale « Afficher l'adresse » atteint le bouton, et la suite dit
 * laquelle. Textes de la coquille (`shell.protectedContact`) : français sans
 * fournisseur, anglais sous `/en`.
 */
export function ProtectedContact({ encoded, kind, owner, buttonClassName, linkClassName }: Readonly<ProtectedContactProps>) {
  const { t } = useShellText();
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

  const visible = t(`protectedContact.${kind}.label`);
  return (
    <button
      type="button"
      className={`tap-target ${styles.reveal} ${buttonClassName ?? ""}`.trim()}
      aria-label={t(`protectedContact.${kind}.name`, { owner })}
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
