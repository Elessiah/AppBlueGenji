"use client";

import { useState } from "react";
import { CyberButton } from "@/components/cyber";
import { useToast } from "@/components/ui/toast";
import { validatePressEmail } from "@/lib/shared/contact";
import styles from "./page.module.css";

interface ContactSectionProps {
  initialEmail: string;
  isAdmin: boolean;
}

export function ContactSection({ initialEmail, isAdmin }: ContactSectionProps) {
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

  return (
    <section id="contact" className={styles.section}>
      <header className={styles.head}>
        <div>
          <span className="eyebrow">SECTION 08</span>
          <h2 className={styles.sectionTitle}>Contact presse</h2>
        </div>
        <span className={styles.meta}>MÉDIAS · PARTENARIATS</span>
      </header>

      <div className={styles.contactGrid}>
        <p className={styles.lede}>
          Une demande d&apos;interview, un dossier de presse ou une couverture
          d&apos;événement&nbsp;? Écrivez-nous, nous répondons sous 48&nbsp;h.
        </p>

        <aside className={styles.contactSide}>
          {editing ? (
            <>
              <label className={styles.modalField}>
                <span className={styles.modalLabel}>Email de contact</span>
                <input
                  type="email"
                  className={styles.modalInput}
                  value={draft}
                  maxLength={254}
                  placeholder="presse@bluegenji-esport.fr"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submit();
                    if (e.key === "Escape") cancel();
                  }}
                  autoFocus
                />
              </label>
              <div className={styles.modalActions}>
                <CyberButton variant="ghost" onClick={cancel} disabled={busy}>
                  Annuler
                </CyberButton>
                <CyberButton variant="primary" onClick={submit} disabled={busy}>
                  {busy ? "…" : "Enregistrer"}
                </CyberButton>
              </div>
            </>
          ) : (
            <>
              <a className={styles.contactEmail} href={`mailto:${email}`}>
                {email}
              </a>
              {isAdmin && (
                <button
                  type="button"
                  className={styles.bureauAction}
                  onClick={openEdit}
                  aria-label="Modifier l'email de contact presse"
                >
                  Modifier
                </button>
              )}
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
