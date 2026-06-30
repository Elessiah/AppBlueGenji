"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import { validatePressEmail } from "@/lib/shared/contact";
import styles from "./FooterPressContact.module.css";

interface FooterPressContactProps {
  initialEmail: string;
  isAdmin: boolean;
}

/**
 * Contact presse affiché directement dans le footer. L'email est un lien
 * `mailto:` ; les admins peuvent le modifier en place (même API que la section
 * association d'origine). Le rendu hérite du style `.columns a` du footer.
 */
export function FooterPressContact({ initialEmail, isAdmin }: FooterPressContactProps) {
  const { showError, showSuccess } = useToast();
  const [email, setEmail] = useState(initialEmail);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialEmail);
  const [busy, setBusy] = useState(false);

  function openEdit() {
    setDraft(email);
    setEditing(true);
  }

  function cancel() {
    if (busy) return;
    setEditing(false);
    setDraft(email);
  }

  async function submit() {
    const validation = validatePressEmail(draft);
    if (!validation.ok) {
      showError("Adresse email invalide.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/association/contact", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: validation.value }),
      });
      const data = (await res.json()) as { email?: string; error?: string };
      if (!res.ok || !data.email) {
        showError(data.error ? `Échec : ${data.error}` : "Échec de l'enregistrement.");
        return;
      }
      setEmail(data.email);
      setEditing(false);
      showSuccess("Email de contact presse mis à jour.");
    } catch {
      showError("Erreur réseau, réessaye.");
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <span className={styles.editRow}>
        <input
          type="email"
          className={styles.input}
          value={draft}
          maxLength={254}
          placeholder="presse@bluegenji-esport.fr"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") cancel();
          }}
          disabled={busy}
          autoFocus
        />
        <button type="button" className={styles.iconBtn} onClick={submit} disabled={busy} aria-label="Enregistrer">
          {busy ? "…" : "✓"}
        </button>
        <button type="button" className={styles.iconBtn} onClick={cancel} disabled={busy} aria-label="Annuler">
          ✕
        </button>
      </span>
    );
  }

  return (
    <span className={styles.row}>
      <a className={styles.email} href={`mailto:${email}`}>
        {email}
      </a>
      {isAdmin && (
        <button
          type="button"
          className={styles.edit}
          onClick={openEdit}
          aria-label="Modifier l'email de contact presse"
        >
          Modifier
        </button>
      )}
    </span>
  );
}
