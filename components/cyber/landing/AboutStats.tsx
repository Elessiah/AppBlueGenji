"use client";

import { useMemo, useState } from "react";
import { BilingualField, EnglishMissingMark, withEnglishMissing } from "@/components/ui/bilingual-field";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { FieldErrorText } from "@/components/ui/field-error-text";
import { useToast } from "@/components/ui/toast";
import {
  type AboutStat,
  ABOUT_STAT_FIELD_ERRORS,
  ABOUT_STAT_LABEL_MAX,
  ABOUT_STAT_VALUE_MAX,
  aboutStatErrorMessage,
  FALLBACK_ABOUT_STATS,
  localizedAboutStats,
  validateAboutStatInput,
} from "@/lib/shared/about-stats";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { DEFAULT_LOCALE, type Locale } from "@/lib/shared/locales";
import { hasEnglish } from "@/lib/shared/staff-translation";
import { LandingDialog } from "./LandingDialog";
import styles from "./AboutStats.module.css";

interface AboutStatsProps {
  initialStats: AboutStat[];
  isAdmin: boolean;
  /** Langue de la page : sous `/en`, seuls les chiffres traduits sont rendus. */
  locale?: Locale;
}

interface FormState {
  value: string;
  label: string;
  labelEn: string;
}

const EMPTY_FORM: FormState = { value: "", label: "", labelEn: "" };

/** `id` des champs du formulaire, cibles de `useFieldErrors`. */
const STAT_FIELD_IDS = { value: "about-stat-value", label: "about-stat-label", labelEn: "about-stat-label-en" } as const;

export function AboutStats({ initialStats, isAdmin, locale = DEFAULT_LOCALE }: Readonly<AboutStatsProps>) {
  // La gestion reste en français (D4) : sous `/en`, ses contrôles, sa fenêtre
  // et ses notifications le disent (`lang="fr"`).
  const staffLang = locale === DEFAULT_LOCALE ? undefined : "fr";
  const toast = useToast();
  const staffToast = staffLang ? { lang: staffLang } : undefined;
  const showError = (message: string) => toast.showError(message, staffToast);
  const showSuccess = (message: string) => toast.showSuccess(message, staffToast);
  const fieldErrors = useFieldErrors(ABOUT_STAT_FIELD_ERRORS, STAT_FIELD_IDS);
  const [stats, setStats] = useState<AboutStat[]>(initialStats);
  // Sous `/en`, un chiffre sans titre anglais n'est pas rendu.
  const shown = useMemo(() => localizedAboutStats(stats, locale), [stats, locale]);
  const [editing, setEditing] = useState<AboutStat | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Les cartes de secours (id négatif) ne sont pas en base : non modifiables.
  const canManage = (s: AboutStat) => isAdmin && s.id > 0;

  function openCreate() {
    fieldErrors.clear();
    setEditing(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  }

  function openEdit(stat: AboutStat) {
    fieldErrors.clear();
    setEditing(stat);
    setForm({ value: stat.value, label: stat.label, labelEn: stat.labelEn ?? "" });
    setOpen(true);
  }

  function close() {
    if (busy) return;
    setOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  // Un refus désigne son champ (valeur, titre, anglais du titre) : rattaché à
  // lui, focus ramené, et la même phrase en notification.
  function refuse(code: string | undefined, fallback: string) {
    const message = aboutStatErrorMessage(code, fallback);
    fieldErrors.report(code, message);
    showError(message);
  }

  async function submit() {
    const payload = { value: form.value.trim(), label: form.label.trim(), labelEn: form.labelEn.trim() };
    // Même validation que le serveur, avant l'envoi : l'anglais (obligatoire,
    // D9) est désigné sans aller-retour.
    const check = validateAboutStatInput(payload);
    if (!check.ok) {
      refuse(check.error, "Formulaire invalide.");
      return;
    }

    setBusy(true);

    try {
      const url = editing ? `/api/association/about-stats/${editing.id}` : "/api/association/about-stats";
      const res = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { stat?: AboutStat; error?: string };
      if (!res.ok || !data.stat) {
        refuse(data.error, "Échec de l'enregistrement.");
        return;
      }

      if (editing) {
        setStats((prev) => prev.map((s) => (s.id === data.stat!.id ? data.stat! : s)));
        showSuccess("Carte mise à jour.");
      } else {
        // Si on partait des cartes de secours, on bascule sur la liste réelle.
        setStats((prev) => [...prev.filter((s) => s.id > 0), data.stat!]);
        showSuccess("Carte ajoutée.");
      }
      close();
    } catch {
      showError("Erreur réseau, réessaye.");
    } finally {
      setBusy(false);
    }
  }

  // Déplace une carte d'un cran (direction -1 = vers la gauche/le haut, +1 = vers
  // la droite/le bas) et persiste le nouvel ordre. Optimiste avec rollback.
  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= stats.length) return;

    const previous = stats;
    const reordered = [...stats];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setStats(reordered);

    setBusy(true);
    try {
      const res = await fetch("/api/association/about-stats/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: reordered.map((s) => s.id) }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        showError(data.error ? `Échec : ${data.error}` : "Échec du réordonnancement.");
        setStats(previous);
        return;
      }
      showSuccess("Ordre des cartes mis à jour.");
    } catch {
      showError("Erreur réseau, réessaye.");
      setStats(previous);
    } finally {
      setBusy(false);
    }
  }

  const [pendingRemoval, setPendingRemoval] = useState<AboutStat | null>(null);

  async function remove(stat: AboutStat): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(`/api/association/about-stats/${stat.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        showError(data.error ? `Échec : ${data.error}` : "Échec de la suppression.");
        return false;
      }
      // Si plus aucune carte réelle, réafficher les cartes de secours — c'est ce
      // que renverrait un rechargement (table vide → FALLBACK_ABOUT_STATS).
      setStats((prev) => {
        const next = prev.filter((s) => s.id !== stat.id);
        return next.length === 0 ? FALLBACK_ABOUT_STATS : next;
      });
      showSuccess("Carte supprimée.");
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
    <>
      <div className={styles.stats}>
        {shown.map(({ stat: s, label, index }) => (
          <div key={s.id} className={styles.stat}>
            <div className="num" style={{ fontSize: 26 }}>{s.value}</div>
            <div className="mono">{label}</div>
            {canManage(s) && (
              <div className={styles.statActions} lang={staffLang}>
                <button
                  type="button"
                  className={`${styles.action} ${styles.moveAction}`}
                  onClick={() => move(index, -1)}
                  disabled={busy || index === 0}
                  aria-label={`Déplacer la carte ${s.label} vers la gauche`}
                  title="Déplacer avant"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={`${styles.action} ${styles.moveAction}`}
                  onClick={() => move(index, 1)}
                  disabled={busy || index === stats.length - 1}
                  aria-label={`Déplacer la carte ${s.label} vers la droite`}
                  title="Déplacer après"
                >
                  ↓
                </button>
                <button
                  type="button"
                  className={styles.action}
                  onClick={() => openEdit(s)}
                  disabled={busy}
                  aria-label={withEnglishMissing(`Modifier la carte ${s.label}`, !hasEnglish(s.labelEn))}
                >
                  Modifier
                  {!hasEnglish(s.labelEn) && <EnglishMissingMark />}
                </button>
                <button
                  type="button"
                  className={`${styles.action} ${styles.actionDanger}`}
                  onClick={() => setPendingRemoval(s)}
                  disabled={busy}
                  aria-label={`Supprimer la carte ${s.label}`}
                >
                  Supprimer
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {isAdmin && (
        <button type="button" className={styles.addBtn} onClick={openCreate} disabled={busy} lang={staffLang}>
          + Ajouter une carte
        </button>
      )}

      {open && (
        <LandingDialog
          onClose={close}
          busy={busy}
          className={styles.modal}
          labelledBy="about-stat-modal-title"
          lang={staffLang}
        >
          <h3 id="about-stat-modal-title" className={styles.modalTitle}>
            {editing ? "Modifier la carte" : "Ajouter une carte"}
          </h3>

          <label className={styles.modalField}>
            <span className={styles.modalLabel}>Valeur</span>
            <input
              className={styles.modalInput}
              value={form.value}
              maxLength={ABOUT_STAT_VALUE_MAX}
              placeholder="100%"
              enterKeyHint="next"
              {...fieldErrors.aria("value")}
              onChange={(e) => {
                fieldErrors.clear("value");
                setForm((f) => ({ ...f, value: e.target.value }));
              }}
            />
            <FieldErrorText fieldId={STAT_FIELD_IDS.value} message={fieldErrors.message("value")} />
          </label>

          <div className={styles.modalField}>
            <BilingualField
              label="Titre"
              ids={{ fr: STAT_FIELD_IDS.label, en: STAT_FIELD_IDS.labelEn }}
              fields={{ fr: "label", en: "labelEn" }}
              errors={fieldErrors}
              values={{ fr: form.label, en: form.labelEn }}
              onChange={(lang, value) => setForm((f) => (lang === "fr" ? { ...f, label: value } : { ...f, labelEn: value }))}
              maxLength={ABOUT_STAT_LABEL_MAX}
              placeholders={{ fr: "Bénévole", en: "Volunteer-run" }}
              enMissing={editing !== null && !hasEnglish(editing.labelEn)}
              inputClassName={styles.modalInput}
              labelClassName={styles.modalLabel}
            />
          </div>

          <div className={styles.modalActions}>
            <button type="button" className={styles.action} onClick={close} disabled={busy}>
              Annuler
            </button>
            <button
              type="button"
              className={styles.actionPrimary}
              onClick={submit}
              disabled={busy}
              aria-busy={busy}
            >
              {busy ? "…" : submitLabel}
            </button>
          </div>
        </LandingDialog>
      )}
      {pendingRemoval ? (
        <ConfirmActionDialog
          title={`Supprimer le chiffre « ${pendingRemoval.value} · ${pendingRemoval.label} » ?`}
          confirmLabel="Supprimer le chiffre"
          pendingLabel="Suppression…"
          contentLang={staffLang}
          onClose={() => setPendingRemoval(null)}
          onConfirm={() => remove(pendingRemoval)}
        >
          <p>
            Ce chiffre disparaît de la section « À propos » de l&apos;accueil. Il ne se restaure pas :
            il faudrait le saisir à nouveau.
          </p>
        </ConfirmActionDialog>
      ) : null}
    </>
  );
}
