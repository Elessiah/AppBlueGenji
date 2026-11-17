"use client";

import { useState } from "react";
import { type ContactInfo, type PublicContactInfo, toPublicContact, validateContactInfo } from "@/lib/shared/contact";
import { decodeContact } from "@/lib/shared/obfuscated-contact";
import { ProtectedContact } from "@/components/ui/protected-contact";
import { useToast } from "@/components/ui/toast";
import { useShellText } from "@/components/i18n/shell-text";
import { CyberButton } from "@/components/cyber";
import { BusyButton } from "@/components/ui/busy-button";
import { BusyLabel } from "@/components/ui/busy-label";
import { useBusyGuard } from "@/lib/shared/hooks/useBusyGuard";
import { LandingDialog } from "./LandingDialog";
import styles from "./FooterContact.module.css";
import { DISCORD_INVITE_URL } from "@/lib/shared/discord";

interface FooterContactProps {
  /** Courriel encodé : le pied de page est rendu dans le HTML de toutes les pages. */
  initialContact: PublicContactInfo;
  isAdmin: boolean;
}

/**
 * Catégorie « Contact » du footer : email, tag Discord et lien Discord. Les
 * admins peuvent personnaliser les trois canaux via une fenêtre d'édition
 * (même API `PUT /api/association/contact`). Les liens héritent du style
 * `.columns a` du footer.
 *
 * Le courriel n'arrive **qu'encodé** et ne se lit qu'au clic sur « Afficher
 * l'adresse » (`ProtectedContact`) ; la fenêtre d'édition le décode à
 * l'ouverture, un geste du staff lui aussi.
 */
export function FooterContact({ initialContact, isAdmin }: Readonly<FooterContactProps>) {
  const { showError, showSuccess } = useToast();
  // Textes lus par le visiteur ; la fenêtre d'édition (staff) reste en
  // français jusqu'au lot des éditeurs de la vitrine (I18N_MIGRATION_PLAN.md, lot 5).
  const { t, locale } = useShellText();
  // Parties restées en français (édition staff → lot 5) : marquées comme
  // telles sur une page d'une autre langue (WCAG 3.1.2). `ProtectedContact`
  // suit la langue de la page depuis le lot 7b.
  const frenchPart = locale === "fr" ? undefined : "fr";
  const [contact, setContact] = useState<PublicContactInfo>(initialContact);
  const [form, setForm] = useState<ContactInfo>(() => editableContact(initialContact));
  const [open, setOpen] = useState(false);
  // Garde synchrone (`docs/features/BUSY_BUTTONS.md`) : un double clic sur
  // « Enregistrer » partait deux fois ; les boutons restent focalisables.
  const { busy, isBusy, run } = useBusyGuard();

  function openEdit() {
    setForm(editableContact(contact));
    setOpen(true);
  }

  function close() {
    if (isBusy()) return;
    setOpen(false);
    setForm(editableContact(contact));
  }

  // Champ modifié pendant l'envoi : ignoré, même avant que « readOnly » soit
  // rendu (ce qui est affiché est ce qui part).
  const editField = (field: keyof ContactInfo, value: string) => {
    if (!isBusy()) setForm((f) => ({ ...f, [field]: value }));
  };

  async function submit() {
    if (isBusy()) return;
    const validation = validateContactInfo(form);
    if (!validation.ok) {
      showError(ERROR_MESSAGES[validation.error] ?? "Coordonnées invalides.", { lang: frenchPart });
      return;
    }

    await run(async () => {
      try {
        const res = await fetch("/api/association/contact", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(validation.value),
        });
        const data = (await res.json()) as { contact?: ContactInfo; error?: string };
        if (!res.ok || !data.contact) {
          showError(data.error ? ERROR_MESSAGES[data.error] ?? `Échec : ${data.error}` : "Échec de l'enregistrement.", { lang: frenchPart });
          return;
        }
        setContact(toPublicContact(data.contact));
        setOpen(false);
        showSuccess("Coordonnées de contact mises à jour.", { lang: frenchPart });
      } catch {
        showError("Erreur réseau, réessaye.", { lang: frenchPart });
      }
    });
  }

  const hasAny = contact.emailEncoded || contact.discordTag || contact.discordUrl;

  return (
    <>
      <ul>
        {contact.emailEncoded && (
          <li className={styles.item}>
            <span className={styles.itemLabel}>{t("footer.contact.email")}</span>
            {/* `key` : une adresse révélée puis modifiée par le staff doit
                repartir masquée, pas garder l'ancienne valeur décodée. */}
            <ProtectedContact
              key={contact.emailEncoded}
              encoded={contact.emailEncoded}
              kind="email"
              owner={t("protectedContact.ownerAssociation")}
            />
          </li>
        )}
        {contact.discordTag && (
          <li className={styles.item}>
            <span className={styles.itemLabel}>{t("footer.contact.discord")}</span>
            <span className={styles.tag}>{contact.discordTag}</span>
          </li>
        )}
        {contact.discordUrl && (
          <li className={styles.item}>
            <span className={styles.itemLabel}>{t("footer.contact.server")}</span>
            <a className="tap-target" href={contact.discordUrl} target="_blank" rel="noreferrer">
              {t("footer.contact.discordServer")}
            </a>
          </li>
        )}
        {!hasAny && (
          <li>
            <span className={styles.empty}>{t("footer.contact.empty")}</span>
          </li>
        )}
        {isAdmin && (
          <li>
            <button type="button" className={styles.edit} onClick={openEdit} lang={frenchPart}>
              {/* Commande staff : reste en français jusqu'au lot 5, comme sa fenêtre. */}
              Modifier
            </button>
          </li>
        )}
      </ul>

      {open && (
        <LandingDialog
          onClose={close}
          busy={busy}
          className={styles.modal}
          lang={frenchPart}
          label="Modifier les coordonnées de contact"
        >
          <h3 className={styles.modalTitle}>Modifier le contact</h3>

          <label className={styles.field}>
            <span className={styles.label}>Email</span>
            <input
              type="email"
              className={styles.input}
              value={form.email}
              maxLength={254}
              placeholder="Adresse de l'association"
              readOnly={busy}
              onChange={(e) => editField("email", e.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Tag Discord</span>
            <input
              className={styles.input}
              value={form.discordTag}
              maxLength={64}
              placeholder="bluegenji"
              readOnly={busy}
              onChange={(e) => editField("discordTag", e.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Lien Discord</span>
            <input
              className={styles.input}
              value={form.discordUrl}
              maxLength={200}
              placeholder={DISCORD_INVITE_URL}
              readOnly={busy}
              onChange={(e) => editField("discordUrl", e.target.value)}
            />
          </label>

          <div className={styles.actions}>
            <CyberButton variant="ghost" asChild>
              <BusyButton busy={false} blocked={busy} onClick={close}>
                Annuler
              </BusyButton>
            </CyberButton>
            <CyberButton variant="primary" asChild>
              <BusyButton busy={busy} onClick={submit}>
                <BusyLabel busy={busy} idle="Enregistrer" pending="Enregistrement…" />
              </BusyButton>
            </CyberButton>
          </div>
        </LandingDialog>
      )}
    </>
  );
}

function editableContact(contact: PublicContactInfo): ContactInfo {
  return {
    email: decodeContact(contact.emailEncoded),
    discordTag: contact.discordTag,
    discordUrl: contact.discordUrl,
  };
}

const ERROR_MESSAGES: Record<string, string> = {
  EMAIL_INVALID: "Adresse email invalide.",
  EMAIL_TOO_LONG: "Adresse email trop longue.",
  DISCORD_TAG_INVALID: "Tag Discord invalide (pas d'espace).",
  DISCORD_TAG_TOO_LONG: "Tag Discord trop long.",
  DISCORD_URL_INVALID: "Lien Discord invalide (doit pointer vers discord.gg ou discord.com).",
  DISCORD_URL_TOO_LONG: "Lien Discord trop long.",
};
