"use client";

import { CyberButton } from "@/components/cyber";
import { LandingDialog } from "@/components/cyber/landing/LandingDialog";
import { BilingualField } from "@/components/ui/bilingual-field";
import type { FieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import {
  type RecruitmentAd,
  type RecruitmentContactChannel,
  type RecruitmentField,
  type RecruitmentDomain,
  type RecruitmentPriority,
  RECRUITMENT_BODY_MAX,
  RECRUITMENT_CONTACT_CHANNELS,
  RECRUITMENT_CONTACT_CHANNEL_LABELS,
  RECRUITMENT_DISCORD_MAX,
  RECRUITMENT_DOMAINS,
  RECRUITMENT_DOMAIN_LABELS,
  RECRUITMENT_PRIORITIES,
  RECRUITMENT_PRIORITY_DESCRIPTIONS,
  RECRUITMENT_PRIORITY_LABELS,
  RECRUITMENT_ROLES_MAX,
  RECRUITMENT_TITLE_MAX,
} from "@/lib/shared/recruitment";
import type { RecruitmentFormState } from "./recruitment-form";
import styles from "./page.module.css";

/**
 * Modale de création ou de modification d'une annonce (`RecruitmentSection`).
 * Elle ne tient aucun état : la section garde le formulaire, l'envoi et la
 * fermeture.
 */
export function RecruitmentAdEditor({
  editing,
  form,
  onChange,
  busy,
  prefilledDiscord,
  onClose,
  onSubmit,
  errors,
  enMissing,
  staffLang,
}: Readonly<{
  /** Annonce modifiée, `null` pour une création. */
  editing: RecruitmentAd | null;
  form: RecruitmentFormState;
  onChange: <K extends keyof RecruitmentFormState>(field: K, value: RecruitmentFormState[K]) => void;
  busy: boolean;
  /** Le Discord a été prérempli depuis le profil du recruteur. */
  prefilledDiscord: boolean;
  onClose: () => void;
  onSubmit: () => void;
  /** Refus rattachés aux champs (titre, missions, description, et leur anglais). */
  errors: FieldErrors<RecruitmentField>;
  /** Annonce déjà en ligne sans anglais (rattrapage du lot 5b). */
  enMissing: boolean;
  /** `fr` sous `/en` : l'administration reste en français (D4). */
  staffLang?: string;
}>) {
  const bilingual = (field: "title" | "roles" | "body") =>
    ({
      ids: { fr: `recruitment-${field}`, en: `recruitment-${field}-en` },
      fields: { fr: field, en: `${field}En` as const },
      errors,
      values: { fr: form[field], en: form[`${field}En`] },
      onChange: (lang: "fr" | "en", value: string) => onChange(lang === "fr" ? field : `${field}En`, value),
      enMissing,
      inputClassName: styles.modalInput,
      labelClassName: styles.modalLabel,
    }) as const;
  const submitLabel = editing ? "Enregistrer" : "Publier";
  return (
    <LandingDialog
      onClose={onClose}
      busy={busy}
      className={styles.modal}
      lang={staffLang}
      label={editing ? "Modifier une annonce" : "Nouvelle annonce"}
    >
      <h3 className={styles.modalTitle}>
        {editing ? "Modifier l'annonce" : "Nouvelle annonce"}
      </h3>

      <div className={styles.modalField}>
        <BilingualField
          label="Titre *"
          maxLength={RECRUITMENT_TITLE_MAX}
          placeholders={{
            fr: "Recherche arbitre pour les tournois du dimanche",
            en: "Looking for referees for the Sunday tournaments",
          }}
          {...bilingual("title")}
        />
      </div>

      <div className={styles.modalRow}>
        <label className={styles.modalField}>
          <span className={styles.modalLabel}>Référent / contact (optionnel)</span>
          <input
            className={styles.modalInput}
            value={form.teamName}
            maxLength={120}
            placeholder="Pôle arbitrage · Marie"
            onChange={(e) => onChange("teamName", e.target.value)}
          />
        </label>
        <label className={styles.modalField}>
          <span className={styles.modalLabel}>Pôle</span>
          <select
            className={styles.modalInput}
            value={form.domain}
            onChange={(e) => onChange("domain", e.target.value as RecruitmentDomain)}
          >
            {RECRUITMENT_DOMAINS.map((d) => (
              <option key={d} value={d}>
                {RECRUITMENT_DOMAIN_LABELS[d]}
              </option>
            ))}
          </select>
          <span className={styles.modalHint}>Domaine de bénévolat concerné.</span>
        </label>
      </div>

      <div className={styles.modalField}>
        <BilingualField
          label="Missions / profil recherché (optionnel)"
          required={false}
          maxLength={RECRUITMENT_ROLES_MAX}
          placeholders={{ fr: "Arbitrer les matchs, gérer les litiges…", en: "Referee matches, handle disputes…" }}
          {...bilingual("roles")}
        />
      </div>

      <div className={styles.modalField}>
        <BilingualField
          label="Description (optionnel)"
          required={false}
          multiline
          rows={8}
          maxLength={RECRUITMENT_BODY_MAX}
          placeholders={{
            fr: "Disponibilités attendues, compétences, ambiance de l'équipe…\n\nEn quoi consiste le rôle :\n- une mission par ligne commençant par un tiret",
            en: "Expected availability, skills, team atmosphere…\n\nWhat the role involves:\n- one task per line starting with a dash",
          }}
          {...bilingual("body")}
          inputClassName={`${styles.modalInput} ${styles.modalTextarea}`}
        />
        <span className={styles.modalHint}>
          Une ligne courte finissant par « : » devient un intertitre, une ligne commençant
          par un tiret devient une puce. Les cartes n&apos;affichent qu&apos;un aperçu :
          l&apos;annonce complète s&apos;ouvre en grand.
        </span>
        <span
          className={`${styles.counter} ${form.body.length > RECRUITMENT_BODY_MAX * 0.9 ? styles.counterWarn : ""}`}
        >
          {form.body.length} / {RECRUITMENT_BODY_MAX}
        </span>
      </div>

      <label className={styles.modalField}>
        <span className={styles.modalLabel}>Lien de candidature (optionnel)</span>
        <input
          className={styles.modalInput}
          value={form.contactUrl}
          maxLength={2048}
          placeholder="https://…/ticket (SpiceWorks, formulaire…)"
          onChange={(e) => onChange("contactUrl", e.target.value)}
        />
        <span className={styles.modalHint}>
          Bouton « Postuler → » de l'annonce. Idéal : un lien vers un ticket SpiceWorks.
        </span>
      </label>

      <label className={styles.modalField}>
        <span className={styles.modalLabel}>Contact Discord (optionnel)</span>
        <input
          className={styles.modalInput}
          value={form.contactDiscord}
          maxLength={RECRUITMENT_DISCORD_MAX}
          placeholder="pseudo#0000 ou lien d'invitation"
          onChange={(e) => onChange("contactDiscord", e.target.value)}
        />
        <span className={styles.modalHint}>Pseudo (copiable) ou lien d'invitation Discord.</span>
      </label>
      {!editing && prefilledDiscord && (
        <p className={styles.modalHint}>
          Discord pré-rempli depuis ton profil — modifie ou efface librement.
        </p>
      )}

      <label className={styles.modalField}>
        <span className={styles.modalLabel}>Canal de contact préféré</span>
        <select
          className={styles.modalInput}
          value={form.contactPreferred}
          onChange={(e) => onChange("contactPreferred", e.target.value as RecruitmentContactChannel)}
        >
          {RECRUITMENT_CONTACT_CHANNELS.map((c) => (
            <option key={c} value={c}>
              {RECRUITMENT_CONTACT_CHANNEL_LABELS[c]}
            </option>
          ))}
        </select>
        <span className={styles.modalHint}>Le canal choisi est mis en avant sur l'annonce.</span>
      </label>

      <label className={styles.modalField}>
        <span className={styles.modalLabel}>Statut d&apos;importance</span>
        <select
          className={styles.modalInput}
          value={form.priority}
          onChange={(e) => onChange("priority", e.target.value as RecruitmentPriority)}
        >
          {RECRUITMENT_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {RECRUITMENT_PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
        <span className={styles.modalHint}>{RECRUITMENT_PRIORITY_DESCRIPTIONS[form.priority]}</span>
        {editing && editing.priority !== form.priority && (
          <span className={styles.modalHint}>
            En changeant de statut, l&apos;annonce passera en fin de son nouveau groupe.
          </span>
        )}
      </label>

      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={form.active}
          onChange={(e) => onChange("active", e.target.checked)}
        />
        <span>Annonce active (visible publiquement)</span>
      </label>

      <div className={styles.modalActions}>
        <CyberButton variant="ghost" onClick={onClose} disabled={busy}>
          Annuler
        </CyberButton>
        <CyberButton variant="primary" onClick={onSubmit} disabled={busy}>
          {busy ? "…" : submitLabel}
        </CyberButton>
      </div>
    </LandingDialog>
  );
}
