"use client";

import { useMemo, useState } from "react";
import { BilingualField, EnglishMissingMark, withEnglishMissing } from "@/components/ui/bilingual-field";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { useToast } from "@/components/ui/toast";
import {
  type AboutPillar,
  ABOUT_PILLAR_FIELD_ERRORS,
  ABOUT_PILLAR_TEXT_MAX,
  ABOUT_PILLAR_TITLE_MAX,
  aboutPillarErrorMessage,
  aboutPillarHasEnglish,
  FALLBACK_ABOUT_PILLARS,
  localizedAboutPillars,
  validateAboutPillarInput,
} from "@/lib/shared/about-pillars";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { DEFAULT_LOCALE, type Locale } from "@/lib/shared/locales";
import { LandingDialog } from "./LandingDialog";
import styles from "./AboutPillars.module.css";

interface AboutPillarsProps {
  initialPillars: AboutPillar[];
  isAdmin: boolean;
  /** Langue de la page : sous `/en`, seules les cartes traduites sont rendues. */
  locale?: Locale;
}

interface FormState {
  title: string;
  text: string;
  titleEn: string;
  textEn: string;
}

const EMPTY_FORM: FormState = { title: "", text: "", titleEn: "", textEn: "" };

/** `id` des champs du formulaire, cibles de `useFieldErrors`. */
const PILLAR_FIELD_IDS = {
  title: "about-pillar-title",
  titleEn: "about-pillar-title-en",
  text: "about-pillar-text",
  textEn: "about-pillar-text-en",
} as const;

export function AboutPillars({ initialPillars, isAdmin, locale = DEFAULT_LOCALE }: Readonly<AboutPillarsProps>) {
  // La gestion reste en français (D4) : sous `/en`, ses contrôles, sa fenêtre
  // et ses notifications le disent (`lang="fr"`).
  const staffLang = locale === DEFAULT_LOCALE ? undefined : "fr";
  const toast = useToast();
  const staffToast = staffLang ? { lang: staffLang } : undefined;
  const showError = (message: string) => toast.showError(message, staffToast);
  const showSuccess = (message: string) => toast.showSuccess(message, staffToast);
  const fieldErrors = useFieldErrors(ABOUT_PILLAR_FIELD_ERRORS, PILLAR_FIELD_IDS);
  const [pillars, setPillars] = useState<AboutPillar[]>(initialPillars);
  // Sous `/en`, une carte sans anglais n'est pas rendue.
  const shown = useMemo(() => localizedAboutPillars(pillars, locale), [pillars, locale]);
  const [editing, setEditing] = useState<AboutPillar | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Les cartes de secours (id négatif) ne sont pas en base : non modifiables.
  const canManage = (p: AboutPillar) => isAdmin && p.id > 0;

  function openCreate() {
    fieldErrors.clear();
    setEditing(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  }

  function openEdit(pillar: AboutPillar) {
    fieldErrors.clear();
    setEditing(pillar);
    setForm({ title: pillar.title, text: pillar.text, titleEn: pillar.titleEn ?? "", textEn: pillar.textEn ?? "" });
    setOpen(true);
  }

  function close() {
    if (busy) return;
    setOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  // Un refus désigne son champ (titre, texte, et leur anglais) : rattaché à
  // lui, focus ramené, et la même phrase en notification.
  function refuse(code: string | undefined, fallback: string) {
    const message = aboutPillarErrorMessage(code, fallback);
    fieldErrors.report(code, message);
    showError(message);
  }

  async function submit() {
    const payload = {
      title: form.title.trim(),
      text: form.text.trim(),
      titleEn: form.titleEn.trim(),
      textEn: form.textEn.trim(),
    };
    // Même validation que le serveur, avant l'envoi : l'anglais (obligatoire,
    // D9) est désigné sans aller-retour.
    const check = validateAboutPillarInput(payload);
    if (!check.ok) {
      refuse(check.error, "Formulaire invalide.");
      return;
    }

    setBusy(true);

    try {
      const url = editing ? `/api/association/about-pillars/${editing.id}` : "/api/association/about-pillars";
      const res = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { pillar?: AboutPillar; error?: string };
      if (!res.ok || !data.pillar) {
        refuse(data.error, "Échec de l'enregistrement.");
        return;
      }

      if (editing) {
        setPillars((prev) => prev.map((p) => (p.id === data.pillar!.id ? data.pillar! : p)));
        showSuccess("Carte mise à jour.");
      } else {
        // Si on partait des cartes de secours, on bascule sur la liste réelle.
        setPillars((prev) => [...prev.filter((p) => p.id > 0), data.pillar!]);
        showSuccess("Carte ajoutée.");
      }
      close();
    } catch {
      showError("Erreur réseau, réessaye.");
    } finally {
      setBusy(false);
    }
  }

  // Déplace une carte d'un cran (direction -1 = vers le haut, +1 = vers le bas)
  // et persiste le nouvel ordre. Optimiste avec rollback.
  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= pillars.length) return;

    const previous = pillars;
    const reordered = [...pillars];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setPillars(reordered);

    setBusy(true);
    try {
      const res = await fetch("/api/association/about-pillars/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: reordered.map((p) => p.id) }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        showError(data.error ? `Échec : ${data.error}` : "Échec du réordonnancement.");
        setPillars(previous);
        return;
      }
      showSuccess("Ordre des cartes mis à jour.");
    } catch {
      showError("Erreur réseau, réessaye.");
      setPillars(previous);
    } finally {
      setBusy(false);
    }
  }

  const [pendingRemoval, setPendingRemoval] = useState<AboutPillar | null>(null);

  async function remove(pillar: AboutPillar): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(`/api/association/about-pillars/${pillar.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        showError(data.error ? `Échec : ${data.error}` : "Échec de la suppression.");
        return false;
      }
      // Si plus aucune carte réelle, réafficher les cartes de secours — c'est ce
      // que renverrait un rechargement (table vide → FALLBACK_ABOUT_PILLARS).
      setPillars((prev) => {
        const next = prev.filter((p) => p.id !== pillar.id);
        return next.length === 0 ? FALLBACK_ABOUT_PILLARS : next;
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
      {shown.map(({ pillar: p, title, text, index }, position) => (
        <article key={p.id} className={styles.pillar}>
          <span className="mono">{String(position + 1).padStart(2, "0")}</span>
          <div>
            <h3>{title}</h3>
            <p>{text}</p>
          </div>
          {canManage(p) && (
            <div className={styles.pillarActions} lang={staffLang}>
              {/* Ordre réglé en français seulement : sous /en, des voisins sans anglais sont masqués. */}
              {locale === DEFAULT_LOCALE && (
                <>
                  <button
                    type="button"
                    className={`${styles.action} ${styles.moveAction}`}
                    onClick={() => move(index, -1)}
                    disabled={busy || index === 0}
                    aria-label={`Déplacer la carte ${p.title} vers le haut`}
                    title="Déplacer avant"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={`${styles.action} ${styles.moveAction}`}
                    onClick={() => move(index, 1)}
                    disabled={busy || index === pillars.length - 1}
                    aria-label={`Déplacer la carte ${p.title} vers le bas`}
                    title="Déplacer après"
                  >
                    ↓
                  </button>
                </>
              )}
              <button
                type="button"
                className={styles.action}
                onClick={() => openEdit(p)}
                disabled={busy}
                aria-label={withEnglishMissing(`Modifier la carte ${p.title}`, !aboutPillarHasEnglish(p))}
              >
                Modifier
                {!aboutPillarHasEnglish(p) && <EnglishMissingMark />}
              </button>
              <button
                type="button"
                className={`${styles.action} ${styles.actionDanger}`}
                onClick={() => setPendingRemoval(p)}
                disabled={busy}
                aria-label={`Supprimer la carte ${p.title}`}
              >
                Supprimer
              </button>
            </div>
          )}
        </article>
      ))}

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
          labelledBy="about-pillar-modal-title"
          lang={staffLang}
        >
          <h3 id="about-pillar-modal-title" className={styles.modalTitle}>
            {editing ? "Modifier la carte" : "Ajouter une carte"}
          </h3>

          <div className={styles.modalField}>
            <BilingualField
              label="Titre"
              ids={{ fr: PILLAR_FIELD_IDS.title, en: PILLAR_FIELD_IDS.titleEn }}
              fields={{ fr: "title", en: "titleEn" }}
              errors={fieldErrors}
              values={{ fr: form.title, en: form.titleEn }}
              onChange={(lang, value) => setForm((f) => (lang === "fr" ? { ...f, title: value } : { ...f, titleEn: value }))}
              maxLength={ABOUT_PILLAR_TITLE_MAX}
              placeholders={{ fr: "Accessible", en: "Accessible" }}
              enterKeyHint="next"
              enMissing={editing !== null && !aboutPillarHasEnglish(editing)}
              inputClassName={styles.modalInput}
              labelClassName={styles.modalLabel}
            />
          </div>

          <div className={styles.modalField}>
            <BilingualField
              label="Texte"
              ids={{ fr: PILLAR_FIELD_IDS.text, en: PILLAR_FIELD_IDS.textEn }}
              fields={{ fr: "text", en: "textEn" }}
              errors={fieldErrors}
              values={{ fr: form.text, en: form.textEn }}
              onChange={(lang, value) => setForm((f) => (lang === "fr" ? { ...f, text: value } : { ...f, textEn: value }))}
              maxLength={ABOUT_PILLAR_TEXT_MAX}
              multiline
              rows={3}
              placeholders={{ fr: "Inscription gratuite, matchmaking par niveau…", en: "Free registration, skill-based matchmaking…" }}
              enMissing={editing !== null && !aboutPillarHasEnglish(editing)}
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
          title={`Supprimer la carte « ${pendingRemoval.title} » ?`}
          confirmLabel="Supprimer la carte"
          pendingLabel="Suppression…"
          contentLang={staffLang}
          onClose={() => setPendingRemoval(null)}
          onConfirm={() => remove(pendingRemoval)}
        >
          <p>
            La carte disparaît de la section « À propos » de l&apos;accueil, avec son texte. Elle ne
            se restaure pas : il faudrait la rédiger à nouveau.
          </p>
        </ConfirmActionDialog>
      ) : null}
    </>
  );
}
