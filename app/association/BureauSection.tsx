"use client";

import { useMemo, useState } from "react";
import { CyberCard, CyberButton, TeamSigil } from "@/components/cyber";
import { BilingualField, EnglishMissingMark, withEnglishMissing } from "@/components/ui/bilingual-field";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { useToast } from "@/components/ui/toast";
import {
  type BureauMember,
  BUREAU_FIELD_ERRORS,
  BUREAU_ROLE_MAX,
  bureauErrorMessage,
  computeInitials,
  FALLBACK_BUREAU,
  localizedBureau,
  randomBureauColor,
  validateBureauInput,
} from "@/lib/shared/bureau";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { DEFAULT_LOCALE, type Locale } from "@/lib/shared/locales";
import { scopedText } from "@/lib/shared/scoped-text";
import { hasEnglish } from "@/lib/shared/staff-translation";
import type frAssociation from "@/messages/fr/association.json";
import { LandingDialog } from "@/components/cyber/landing/LandingDialog";
import styles from "./page.module.css";

interface BureauSectionProps {
  initialMembers: BureauMember[];
  isAdmin: boolean;
  /** Langue de la page, et les textes visiteurs de la section dans cette langue (`association.bureau`). */
  locale?: Locale;
  messages: (typeof frAssociation)["bureau"];
}

interface FormState {
  name: string;
  role: string;
  roleEn: string;
  initials: string;
  color: string;
}

const EMPTY_FORM: FormState = { name: "", role: "", roleEn: "", initials: "", color: "" };

/** `id` des deux champs du rôle, cibles de `useFieldErrors`. */
const ROLE_FIELD_IDS = { role: "bureau-role", roleEn: "bureau-role-en" } as const;

export function BureauSection({
  initialMembers,
  isAdmin,
  locale = DEFAULT_LOCALE,
  messages,
}: Readonly<BureauSectionProps>) {
  const { t } = scopedText(locale, messages);
  // La gestion reste en français (D4) : sous `/en`, ses contrôles, sa fenêtre
  // et ses notifications le disent (`lang="fr"`).
  const staffLang = locale === DEFAULT_LOCALE ? undefined : "fr";
  const toast = useToast();
  const staffToast = staffLang ? { lang: staffLang } : undefined;
  const showError = (message: string) => toast.showError(message, staffToast);
  const showSuccess = (message: string) => toast.showSuccess(message, staffToast);
  const fieldErrors = useFieldErrors(BUREAU_FIELD_ERRORS, ROLE_FIELD_IDS);
  const [members, setMembers] = useState<BureauMember[]>(initialMembers);
  // Le bureau dans la langue de la page : sous `/en`, un membre dont le rôle
  // n'a pas encore d'anglais n'est pas rendu (`localizedBureau`).
  const shown = useMemo(() => localizedBureau(members, locale), [members, locale]);
  const [editing, setEditing] = useState<BureauMember | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Les membres de secours (id négatif) ne sont pas en base : non modifiables.
  const canManage = (m: BureauMember) => isAdmin && m.id > 0;

  function openCreate() {
    fieldErrors.clear();
    setEditing(null);
    setForm({ name: "", role: "", roleEn: "", initials: "", color: randomBureauColor() });
    setOpen(true);
  }

  function openEdit(member: BureauMember) {
    fieldErrors.clear();
    setEditing(member);
    setForm({
      name: member.name,
      role: member.role,
      roleEn: member.roleEn ?? "",
      initials: member.initials,
      color: member.color,
    });
    setOpen(true);
  }

  function close() {
    if (busy) return;
    setOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  // Un refus désigne son champ quand il le peut (rôle, anglais du rôle) :
  // rattaché à lui, focus ramené, et la même phrase en notification.
  function refuse(code: string | undefined, fallback: string) {
    const message = bureauErrorMessage(code, fallback);
    fieldErrors.report(code, message);
    showError(message);
  }

  // Initiales affichées : saisie manuelle si fournie, sinon dérivées du nom.
  const previewInitials = (form.initials.trim() || computeInitials(form.name) || "·").toUpperCase();

  async function submit() {
    if (!form.name.trim()) {
      showError("Le nom est requis.");
      return;
    }
    const payload = {
      name: form.name.trim(),
      role: form.role.trim(),
      roleEn: form.roleEn.trim(),
      initials: form.initials.trim() || computeInitials(form.name),
      color: form.color || randomBureauColor(),
    };
    // Même validation que le serveur, avant l'envoi : le rôle et son anglais
    // (obligatoire, D9) sont désignés sans aller-retour.
    const check = validateBureauInput(payload);
    if (!check.ok) {
      refuse(check.error, "Formulaire invalide.");
      return;
    }

    setBusy(true);

    try {
      const url = editing ? `/api/association/bureau/${editing.id}` : "/api/association/bureau";
      const res = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { member?: BureauMember; error?: string };
      if (!res.ok || !data.member) {
        refuse(data.error, "Échec de l'enregistrement.");
        return;
      }

      if (editing) {
        setMembers((prev) => prev.map((m) => (m.id === data.member!.id ? data.member! : m)));
        showSuccess("Membre du bureau mis à jour.");
      } else {
        // Si on partait du bureau de secours, on bascule sur la liste réelle.
        setMembers((prev) => [...prev.filter((m) => m.id > 0), data.member!]);
        showSuccess("Membre du bureau ajouté.");
      }
      close();
    } catch {
      showError("Erreur réseau, réessaye.");
    } finally {
      setBusy(false);
    }
  }

  // Déplace un membre d'un cran (direction -1 = vers le haut, +1 = vers le bas)
  // et persiste le nouvel ordre. Mise à jour optimiste avec rollback en cas d'échec.
  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= members.length) return;

    const previous = members;
    const reordered = [...members];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setMembers(reordered);

    setBusy(true);
    try {
      const res = await fetch("/api/association/bureau/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: reordered.map((m) => m.id) }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        showError(data.error ? `Échec : ${data.error}` : "Échec du réordonnancement.");
        setMembers(previous);
        return;
      }
      showSuccess("Ordre du bureau mis à jour.");
    } catch {
      showError("Erreur réseau, réessaye.");
      setMembers(previous);
    } finally {
      setBusy(false);
    }
  }

  const [pendingRemoval, setPendingRemoval] = useState<BureauMember | null>(null);

  async function remove(member: BureauMember): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(`/api/association/bureau/${member.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        showError(data.error ? `Échec : ${data.error}` : "Échec de la suppression.");
        return false;
      }
      // Si plus aucun membre réel, réafficher le bureau de secours — c'est ce
      // que renverrait un rechargement (table vide → FALLBACK_BUREAU).
      setMembers((prev) => {
        const next = prev.filter((m) => m.id !== member.id);
        return next.length === 0 ? FALLBACK_BUREAU : next;
      });
      showSuccess("Membre du bureau supprimé.");
      return true;
    } catch {
      showError("Erreur réseau, réessaye.");
    } finally {
      setBusy(false);
    }
    return false;
  }

  const submitLabel = editing ? "Enregistrer" : "Ajouter";

  return (
    <section className={styles.section}>
      <header className={styles.head}>
        <div>
          <span className="eyebrow">{t("eyebrow")}</span>
          <h2 className={styles.sectionTitle}>{t("title")}</h2>
        </div>
        <div className={styles.bureauHeadActions}>
          <span className={styles.meta}>{t("meta", { count: shown.length })}</span>
          {isAdmin && (
            <CyberButton variant="primary" onClick={openCreate} lang={staffLang}>
              + Ajouter
            </CyberButton>
          )}
        </div>
      </header>

      <div className={styles.bureauGrid}>
        {shown.map(({ member: b, role, index }) => (
          <CyberCard key={b.id} lift className={styles.bureauCard}>
            <div className={styles.bureauSigil}>
              <TeamSigil label={b.initials} color={b.color} size={40} />
            </div>
            <div className={styles.bureauDivider} />
            <div>
              <h3 className={styles.bureauName}>{b.name}</h3>
              <p className={styles.bureauRole}>{role}</p>
            </div>
            {canManage(b) && (
              <div className={styles.bureauCardActions} data-tap-zone lang={staffLang}>
                {/* Ordre réglé en français seulement : sous /en, des voisins sans anglais sont masqués. */}
                {locale === DEFAULT_LOCALE && (
                  <>
                    <button
                      type="button"
                      className={`${styles.bureauAction} ${styles.moveAction}`}
                      onClick={() => move(index, -1)}
                      disabled={busy || index === 0}
                      aria-label={`Déplacer ${b.name} vers le haut`}
                      title="Monter"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className={`${styles.bureauAction} ${styles.moveAction}`}
                      onClick={() => move(index, 1)}
                      disabled={busy || index === members.length - 1}
                      aria-label={`Déplacer ${b.name} vers le bas`}
                      title="Descendre"
                    >
                      ↓
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className={styles.bureauAction}
                  onClick={() => openEdit(b)}
                  disabled={busy}
                  aria-label={withEnglishMissing(`Modifier ${b.name}`, !hasEnglish(b.roleEn))}
                >
                  Modifier
                  {!hasEnglish(b.roleEn) && <EnglishMissingMark />}
                </button>
                <button
                  type="button"
                  className={`${styles.bureauAction} ${styles.bureauActionDanger}`}
                  onClick={() => setPendingRemoval(b)}
                  disabled={busy}
                  aria-label={`Supprimer ${b.name}`}
                >
                  Supprimer
                </button>
              </div>
            )}
          </CyberCard>
        ))}
      </div>

      {open && (
        <LandingDialog
          onClose={close}
          busy={busy}
          className={styles.modal}
          lang={staffLang}
          label={editing ? "Modifier un membre du bureau" : "Ajouter un membre du bureau"}
        >
          <h3 className={styles.modalTitle}>
            {editing ? "Modifier le membre" : "Ajouter un membre"}
          </h3>

          <div className={styles.modalPreview}>
            <TeamSigil label={previewInitials} color={form.color || "var(--blue-500)"} size={40} />
            <button
              type="button"
              className={styles.bureauAction}
              onClick={() => setForm((f) => ({ ...f, color: randomBureauColor() }))}
            >
              Couleur aléatoire
            </button>
          </div>

          <label className={styles.modalField}>
            <span className={styles.modalLabel}>Nom</span>
            <input
              data-autofocus
              className={styles.modalInput}
              value={form.name}
              maxLength={120}
              placeholder="Léo Perreaut"
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>

          <div className={styles.modalField}>
            <BilingualField
              label="Rôle"
              ids={{ fr: ROLE_FIELD_IDS.role, en: ROLE_FIELD_IDS.roleEn }}
              fields={{ fr: "role", en: "roleEn" }}
              errors={fieldErrors}
              values={{ fr: form.role, en: form.roleEn }}
              onChange={(lang, value) => setForm((f) => (lang === "fr" ? { ...f, role: value } : { ...f, roleEn: value }))}
              maxLength={BUREAU_ROLE_MAX}
              placeholders={{ fr: "Président", en: "President" }}
              enMissing={editing !== null && !hasEnglish(editing.roleEn)}
              inputClassName={styles.modalInput}
              labelClassName={styles.modalLabel}
            />
          </div>

          <label className={styles.modalField}>
            <span className={styles.modalLabel}>Initiales (auto si vide)</span>
            <input
              className={styles.modalInput}
              value={form.initials}
              maxLength={4}
              placeholder={computeInitials(form.name) || "LP"}
              onChange={(e) => setForm((f) => ({ ...f, initials: e.target.value }))}
            />
          </label>

          <div className={styles.modalActions}>
            <CyberButton variant="ghost" onClick={close} disabled={busy}>
              Annuler
            </CyberButton>
            <CyberButton variant="primary" onClick={submit} disabled={busy}>
              {busy ? "…" : submitLabel}
            </CyberButton>
          </div>
        </LandingDialog>
      )}
      {pendingRemoval ? (
        <ConfirmActionDialog
          title={`Retirer ${pendingRemoval.name} du bureau ?`}
          confirmLabel="Retirer du bureau"
          pendingLabel="Retrait…"
          contentLang={staffLang}
          onClose={() => setPendingRemoval(null)}
          onConfirm={() => remove(pendingRemoval)}
        >
          <p>
            {pendingRemoval.name} disparaît de la page Association, avec son rôle et sa présentation.
            La fiche ne se restaure pas : il faudrait la saisir à nouveau.
          </p>
        </ConfirmActionDialog>
      ) : null}
    </section>
  );
}
