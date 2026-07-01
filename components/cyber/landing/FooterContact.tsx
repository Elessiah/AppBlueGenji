"use client";

import { useEffect, useState } from "react";
import { type ContactInfo, validateContactInfo } from "@/lib/shared/contact";
import { useToast } from "@/components/ui/toast";
import { CyberButton } from "@/components/cyber";
import styles from "./FooterContact.module.css";

interface FooterContactProps {
  initialContact: ContactInfo;
  isAdmin: boolean;
}

/**
 * Catégorie « Contact » du footer : email, tag Discord et lien Discord. Les
 * admins peuvent personnaliser les trois canaux via une fenêtre d'édition
 * (même API `PUT /api/association/contact`). Les liens héritent du style
 * `.columns a` du footer.
 */
export function FooterContact({ initialContact, isAdmin }: FooterContactProps) {
  const { showError, showSuccess } = useToast();
  const [contact, setContact] = useState<ContactInfo>(initialContact);
  const [form, setForm] = useState<ContactInfo>(initialContact);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, busy]);

  function openEdit() {
    setForm(contact);
    setOpen(true);
  }

  function close() {
    if (busy) return;
    setOpen(false);
    setForm(contact);
  }

  async function submit() {
    const validation = validateContactInfo(form);
    if (!validation.ok) {
      showError(ERROR_MESSAGES[validation.error] ?? "Coordonnées invalides.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/association/contact", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validation.value),
      });
      const data = (await res.json()) as { contact?: ContactInfo; error?: string };
      if (!res.ok || !data.contact) {
        showError(data.error ? ERROR_MESSAGES[data.error] ?? `Échec : ${data.error}` : "Échec de l'enregistrement.");
        return;
      }
      setContact(data.contact);
      setOpen(false);
      showSuccess("Coordonnées de contact mises à jour.");
    } catch {
      showError("Erreur réseau, réessaye.");
    } finally {
      setBusy(false);
    }
  }

  const hasAny = contact.email || contact.discordTag || contact.discordUrl;

  return (
    <>
      <ul>
        {contact.email && (
          <li>
            <a href={`mailto:${contact.email}`}>{contact.email}</a>
          </li>
        )}
        {contact.discordTag && (
          <li>
            <span className={styles.tagLabel}>Discord&nbsp;·</span>{" "}
            <span className={styles.tag}>{contact.discordTag}</span>
          </li>
        )}
        {contact.discordUrl && (
          <li>
            <a href={contact.discordUrl} target="_blank" rel="noreferrer">
              Serveur Discord
            </a>
          </li>
        )}
        {!hasAny && (
          <li>
            <span className={styles.empty}>Non renseigné</span>
          </li>
        )}
        {isAdmin && (
          <li>
            <button type="button" className={styles.edit} onClick={openEdit}>
              Modifier
            </button>
          </li>
        )}
      </ul>

      {open && (
        <div className={styles.overlay} onClick={close} role="presentation">
          <div
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Modifier les coordonnées de contact"
          >
            <h3 className={styles.modalTitle}>Modifier le contact</h3>

            <label className={styles.field}>
              <span className={styles.label}>Email</span>
              <input
                type="email"
                className={styles.input}
                value={form.email}
                maxLength={254}
                placeholder="contact@bluegenji-esport.fr"
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                autoFocus
              />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Tag Discord</span>
              <input
                className={styles.input}
                value={form.discordTag}
                maxLength={64}
                placeholder="bluegenji"
                onChange={(e) => setForm((f) => ({ ...f, discordTag: e.target.value }))}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Lien Discord</span>
              <input
                className={styles.input}
                value={form.discordUrl}
                maxLength={200}
                placeholder="https://discord.gg/bluegenji"
                onChange={(e) => setForm((f) => ({ ...f, discordUrl: e.target.value }))}
              />
            </label>

            <div className={styles.actions}>
              <CyberButton variant="ghost" onClick={close} disabled={busy}>
                Annuler
              </CyberButton>
              <CyberButton variant="primary" onClick={submit} disabled={busy}>
                {busy ? "…" : "Enregistrer"}
              </CyberButton>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const ERROR_MESSAGES: Record<string, string> = {
  EMAIL_INVALID: "Adresse email invalide.",
  EMAIL_TOO_LONG: "Adresse email trop longue.",
  DISCORD_TAG_INVALID: "Tag Discord invalide (pas d'espace).",
  DISCORD_TAG_TOO_LONG: "Tag Discord trop long.",
  DISCORD_URL_INVALID: "Lien Discord invalide (doit pointer vers discord.gg ou discord.com).",
  DISCORD_URL_TOO_LONG: "Lien Discord trop long.",
};
