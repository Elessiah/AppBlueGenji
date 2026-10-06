"use client";

import Image from "next/image";
import { useMemo, useRef, useState } from "react";
import { CyberButton, CyberCard } from "@/components/cyber";
import { LandingDialog } from "@/components/cyber/landing/LandingDialog";
import { BilingualField, EnglishMissingMark, withEnglishMissing } from "@/components/ui/bilingual-field";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { useToast } from "@/components/ui/toast";
import { appendCroppedImage, useImageCropper } from "@/components/ui/image-crop-dialog";
import {
  type Benevole,
  BENEVOLE_CATEGORY_MAX,
  BENEVOLE_FIELD_ERRORS,
  benevoleInitials,
  categoryEnglish,
  nextCategoryEnglish,
  formatDisplayName,
  formatJoinedAt,
  localizedCategories,
  validateBenevoleInput,
} from "@/lib/shared/benevoles";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { DEFAULT_LOCALE, type Locale } from "@/lib/shared/locales";
import { scopedText } from "@/lib/shared/scoped-text";
import { englishErrorMessage, hasEnglish } from "@/lib/shared/staff-translation";
import { toServedUploadUrl } from "@/lib/shared/uploads";
import type frVolunteers from "@/messages/fr/volunteers.json";
import styles from "./page.module.css";

const ACCEPTED_PHOTO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

interface BenevoleSectionProps {
  initialBenevoles: Benevole[];
  isAdmin: boolean;
  /** Langue de la page, et les textes visiteurs de la section dans cette langue (`volunteers.section`). */
  locale?: Locale;
  messages: (typeof frVolunteers)["section"];
}

/** `id` des deux champs de la catégorie, cibles de `useFieldErrors`. */
const CATEGORY_FIELD_IDS = { category: "benevole-category", categoryEn: "benevole-category-en" } as const;

interface FormState {
  firstName: string;
  pseudo: string;
  lastName: string;
  category: string;
  categoryEn: string;
  photoUrl: string;
  joinedAt: string;
}

const EMPTY_FORM: FormState = {
  firstName: "",
  pseudo: "",
  lastName: "",
  category: "",
  categoryEn: "",
  photoUrl: "",
  joinedAt: "",
};

/** Nom affiché dans l'aperçu de la modale, avec des repères pour les champs vides. */
function previewDisplayName(form: FormState): string {
  if (!form.firstName && !form.lastName) return form.pseudo || "Pseudo, ou prénom et nom";
  const pseudo = form.pseudo ? ` "${form.pseudo}"` : "";
  const lastName = form.lastName ? form.lastName.toUpperCase() : "NOM";
  return `${form.firstName || "Prénom"}${pseudo} ${lastName}`;
}

const VALIDATION_ERROR_MESSAGES: Record<string, string> = {
  FIRST_NAME_REQUIRED: "Le prénom est requis.",
  FIRST_NAME_TOO_LONG: "Le prénom est trop long.",
  LAST_NAME_REQUIRED: "Le nom est requis.",
  LAST_NAME_TOO_LONG: "Le nom est trop long.",
  NAME_REQUIRED: "Renseigne au moins un pseudo, ou un prénom et un nom.",
  PSEUDO_TOO_LONG: "Le pseudo est trop long.",
  CATEGORY_REQUIRED: "La catégorie est requise.",
  CATEGORY_TOO_LONG: "La catégorie est trop longue.",
  JOINED_AT_REQUIRED: "La date d'arrivée est requise.",
  JOINED_AT_INVALID: "La date d'arrivée est invalide.",
  PHOTO_URL_TOO_LONG: "L'URL de la photo est trop longue.",
  INVALID_PHOTO_URL: "Cette photo est une image d'une autre partie du site : importe-la.",
};

/** Phrase d'un refus de validation (staff, en français — D4). */
function validationMessage(code: string): string {
  return VALIDATION_ERROR_MESSAGES[code] ?? englishErrorMessage(code) ?? "Formulaire invalide.";
}

export function BenevolesSection({
  initialBenevoles,
  isAdmin,
  locale = DEFAULT_LOCALE,
  messages,
}: Readonly<BenevoleSectionProps>) {
  const { t } = scopedText(locale, messages);
  // La gestion reste en français (D4) : sous `/en`, ses contrôles, sa fenêtre
  // et ses notifications le disent (`lang="fr"`).
  const staffLang = locale === DEFAULT_LOCALE ? undefined : "fr";
  const toast = useToast();
  const staffToast = staffLang ? { lang: staffLang } : undefined;
  const showError = (message: string) => toast.showError(message, staffToast);
  const showSuccess = (message: string) => toast.showSuccess(message, staffToast);
  const fieldErrors = useFieldErrors(BENEVOLE_FIELD_ERRORS, CATEGORY_FIELD_IDS);
  const { cropImage, cropDialog } = useImageCropper();
  const [benevoles, setBenevoles] = useState<Benevole[]>(initialBenevoles);
  // Catégories dans la langue de la page : sous `/en`, celles qui n'ont pas
  // encore d'anglais ne sont pas rendues (`localizedCategories`).
  const groups = useMemo(() => localizedCategories(benevoles, locale), [benevoles, locale]);
  const [editing, setEditing] = useState<Benevole | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoFileRef = useRef<HTMLInputElement>(null);

  function openCreate() {
    fieldErrors.clear();
    setEditing(null);
    setForm({ ...EMPTY_FORM, joinedAt: new Date().toISOString().slice(0, 10) });
    setOpen(true);
  }

  function openEdit(b: Benevole) {
    fieldErrors.clear();
    setEditing(b);
    setForm({
      firstName: b.firstName,
      pseudo: b.pseudo ?? "",
      lastName: b.lastName,
      category: b.category,
      // L'anglais de la catégorie, saisi pour un autre de ses bénévoles le cas échéant.
      categoryEn: categoryEnglishOf(b.category) ?? "",
      photoUrl: b.photoUrl ?? "",
      joinedAt: b.joinedAt,
    });
    setOpen(true);
  }

  function close() {
    if (busy) return;
    setOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  function set(field: keyof FormState, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  /** L'anglais déjà connu d'une catégorie (une catégorie se traduit en bloc). */
  function categoryEnglishOf(category: string): string | null {
    return categoryEnglish(benevoles.filter((b) => b.category === category.trim()));
  }

  // Changer de catégorie reprend son anglais s'il est connu (`nextCategoryEnglish`).
  function setCategory(lang: "fr" | "en", value: string) {
    if (lang === "en") {
      set("categoryEn", value);
      return;
    }
    setForm((f) => ({ ...f, category: value, categoryEn: nextCategoryEnglish(f, value, categoryEnglishOf) }));
  }

  function refuse(code: string | undefined, message: string) {
    fieldErrors.report(code, message);
    showError(message);
  }

  async function submit() {
    const validation = validateBenevoleInput({
      firstName: form.firstName,
      pseudo: form.pseudo,
      lastName: form.lastName,
      category: form.category,
      categoryEn: form.categoryEn,
      photoUrl: form.photoUrl,
      joinedAt: form.joinedAt,
    });
    if (!validation.ok) {
      refuse(validation.error, validationMessage(validation.error));
      return;
    }
    const { firstName, pseudo, lastName, category, categoryEn, photoUrl, joinedAt } = validation.value;

    setBusy(true);
    const payload = {
      firstName,
      pseudo: pseudo || null,
      lastName,
      category,
      categoryEn,
      photoUrl: photoUrl || null,
      joinedAt,
    };

    try {
      const url = editing ? `/api/benevoles/${editing.id}` : "/api/benevoles";
      const res = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { benevole?: Benevole; error?: string };
      if (!res.ok || !data.benevole) {
        if (data.error) {
          const code = data.error;
          refuse(code, VALIDATION_ERROR_MESSAGES[code] ?? englishErrorMessage(code) ?? `Échec : ${code}`);
        }
        else showError("Échec de l'enregistrement.");
        return;
      }

      // Le serveur recopie l'anglais sur toute la catégorie : la liste aussi.
      const saved = data.benevole;
      const shareEnglish = (b: Benevole) => (b.category === saved.category ? { ...b, categoryEn: saved.categoryEn } : b);
      if (editing) {
        setBenevoles((prev) => prev.map((b) => (b.id === saved.id ? saved : shareEnglish(b))));
        showSuccess("Bénévole mis à jour.");
      } else {
        setBenevoles((prev) => [...prev.map(shareEnglish), saved]);
        showSuccess("Bénévole ajouté.");
      }
      close();
    } catch {
      showError("Erreur réseau, réessaye.");
    } finally {
      setBusy(false);
    }
  }

  const [pendingRemoval, setPendingRemoval] = useState<Benevole | null>(null);

  async function remove(b: Benevole): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(`/api/benevoles/${b.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        showError(data.error ? `Échec : ${data.error}` : "Échec de la suppression.");
        return false;
      }
      setBenevoles((prev) => prev.filter((x) => x.id !== b.id));
      showSuccess("Bénévole retiré.");
      return true;
    } catch {
      showError("Erreur réseau, réessaye.");
    } finally {
      setBusy(false);
    }
    return false;
  }

  async function onPhotoFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Réinitialise pour permettre de re-sélectionner le même fichier ensuite.
    event.target.value = "";
    if (!file) return;
    if (!ACCEPTED_PHOTO_TYPES.has(file.type)) {
      showError("Format invalide : PNG, JPEG ou WebP uniquement.");
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      showError("Image trop lourde (5 Mo maximum).");
      return;
    }

    const image = await cropImage(file, "benevole-photo", "Recadrer la photo");
    if (!image) return;

    setPhotoBusy(true);
    try {
      const data = new FormData();
      appendCroppedImage(data, image);
      const res = await fetch("/api/benevoles/photo", { method: "POST", body: data });
      const payload = (await res.json()) as { photoUrl?: string; error?: string };
      if (!res.ok || !payload.photoUrl) {
        showError(payload.error ? `Échec : ${payload.error}` : "Échec de l'envoi de la photo.");
        return;
      }
      setForm((f) => ({ ...f, photoUrl: payload.photoUrl! }));
      showSuccess("Photo importée.");
    } catch {
      showError("Erreur réseau, réessaye.");
    } finally {
      setPhotoBusy(false);
    }
  }

  // Déplace une catégorie d'un cran (admin). Mise à jour optimiste : on réordonne
  // la liste plate pour refléter le nouvel ordre, avec rollback en cas d'échec.
  async function moveCategory(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= groups.length) return;

    const order = groups.map((g) => g.category);
    [order[index], order[target]] = [order[target], order[index]];

    const previous = benevoles;
    const reordered = order.flatMap(
      (cat) => groups.find((g) => g.category === cat)!.members,
    );
    setBenevoles(reordered);

    setBusy(true);
    try {
      const res = await fetch("/api/benevoles/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: order }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        showError(data.error ? `Échec : ${data.error}` : "Échec du réordonnancement.");
        setBenevoles(previous);
        return;
      }
      showSuccess("Ordre des catégories mis à jour.");
    } catch {
      showError("Erreur réseau, réessaye.");
      setBenevoles(previous);
    } finally {
      setBusy(false);
    }
  }

  // Ce que la page montre : sous `/en`, les bénévoles des catégories traduites.
  const totalCount = groups.reduce((count, group) => count + group.members.length, 0);
  // Sous `/en`, aucune catégorie encore traduite : ce n'est pas « aucun bénévole ».
  const pendingTranslation = groups.length === 0 && benevoles.length > 0;
  const submitLabel = editing ? "Enregistrer" : "Ajouter";
  const photoLabel = form.photoUrl ? "Changer la photo" : "Importer une image";

  return (
    <>
      {cropDialog}
      <section className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">{t("eyebrow")}</span>
            <h2 className={styles.sectionTitle}>{t("title")}</h2>
          </div>
          <div className={styles.headActions}>
            {!pendingTranslation && (
              <span className={styles.meta}>
                {t("meta", { count: totalCount, categories: groups.length })}
              </span>
            )}
            {isAdmin && (
              <CyberButton variant="primary" onClick={openCreate} lang={staffLang}>
                + Ajouter
              </CyberButton>
            )}
          </div>
        </header>

        {groups.length === 0 ? (
          <div className={styles.empty}>
            <p>{pendingTranslation ? t("pendingTranslation") : t("empty")}</p>
            {isAdmin && !pendingTranslation && (
              <CyberButton variant="primary" onClick={openCreate} lang={staffLang}>
                Ajouter le premier bénévole
              </CyberButton>
            )}
          </div>
        ) : (
          <div className={styles.categories}>
            {groups.map(({ category, label, members }, index) => (
              <div key={category} className={styles.categoryBlock}>
                <div className={styles.categoryHeader}>
                  <span className={styles.categoryTitle}>
                    {label}
                    {/* Catégorie sans anglais : absente de la page anglaise
                        jusqu'à ce qu'un de ses bénévoles soit traduit. */}
                    {isAdmin && categoryEnglish(members) === null && <EnglishMissingMark />}
                  </span>
                  <span className={styles.categoryCount}>{members.length}</span>
                  {/* L'ordre des catégories se règle sur la page française,
                      où elles sont toutes présentes. */}
                  {isAdmin && locale === DEFAULT_LOCALE && groups.length > 1 && (
                    <div className={styles.categoryActions} data-tap-zone>
                      <button
                        type="button"
                        className={styles.categoryMove}
                        onClick={() => moveCategory(index, -1)}
                        disabled={busy || index === 0}
                        aria-label={`Déplacer la catégorie ${category} vers le haut`}
                        title="Monter la catégorie"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className={styles.categoryMove}
                        onClick={() => moveCategory(index, 1)}
                        disabled={busy || index === groups.length - 1}
                        aria-label={`Déplacer la catégorie ${category} vers le bas`}
                        title="Descendre la catégorie"
                      >
                        ↓
                      </button>
                    </div>
                  )}
                </div>
                <div className={styles.grid}>
                  {members.map((b) => (
                    <CyberCard key={b.id} lift className={styles.card}>
                      <div className={styles.avatarWrap}>
                        {b.photoUrl ? (
                          <Image
                            src={toServedUploadUrl(b.photoUrl)}
                            alt={formatDisplayName(b)}
                            width={80}
                            height={80}
                            className={styles.avatar}
                          />
                        ) : (
                          <div className={styles.avatarFallback}>
                            {benevoleInitials(b)}
                          </div>
                        )}
                      </div>
                      <div className={styles.cardBody}>
                        <p className={styles.displayName}>{formatDisplayName(b)}</p>
                        <p className={styles.joinedAt}>
                          {t("since", { date: formatJoinedAt(b.joinedAt, locale) })}
                        </p>
                      </div>
                      {isAdmin && (
                        <div className={styles.cardActions} lang={staffLang}>
                          <button
                            type="button"
                            className={styles.action}
                            onClick={() => openEdit(b)}
                            disabled={busy}
                            aria-label={withEnglishMissing(`Modifier ${formatDisplayName(b)}`, !hasEnglish(b.categoryEn))}
                          >
                            Modifier
                            {!hasEnglish(b.categoryEn) && <EnglishMissingMark />}
                          </button>
                          <button
                            type="button"
                            className={`${styles.action} ${styles.actionDanger}`}
                            onClick={() => setPendingRemoval(b)}
                            disabled={busy}
                            aria-label={`Supprimer ${formatDisplayName(b)}`}
                          >
                            Supprimer
                          </button>
                        </div>
                      )}
                    </CyberCard>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {open && (
        <LandingDialog
          onClose={close}
          busy={busy}
          ariaBusy={busy || photoBusy}
          className={styles.modal}
          lang={staffLang}
          label={editing ? "Modifier un bénévole" : "Ajouter un bénévole"}
        >
          <h3 className={styles.modalTitle}>
            {editing ? "Modifier le bénévole" : "Ajouter un bénévole"}
          </h3>

          {/* Prévisualisation avatar */}
          <div className={styles.modalPreview}>
            {form.photoUrl ? (
              <Image
                src={toServedUploadUrl(form.photoUrl)}
                alt="Aperçu"
                width={56}
                height={56}
                className={styles.avatar}
              />
            ) : (
              <div className={styles.avatarFallback} style={{ width: 56, height: 56, fontSize: 20 }}>
                {benevoleInitials(form)}
              </div>
            )}
            <div className={styles.modalPreviewName}>
              {previewDisplayName(form)}
            </div>
          </div>

          <label className={styles.modalField}>
            <span className={styles.modalLabel}>Pseudo</span>
            <input
              data-autofocus
              className={styles.modalInput}
              value={form.pseudo}
              maxLength={80}
              placeholder="MarieD"
              aria-describedby="benevole-pseudo-hint"
              onChange={(e) => set("pseudo", e.target.value)}
            />
            <span id="benevole-pseudo-hint" className={styles.photoHint}>
              Pseudo seul, ou prénom + nom ci-dessous (au moins l'un des deux).
            </span>
          </label>

          <div className={styles.modalRow}>
            <label className={styles.modalField}>
              <span className={styles.modalLabel}>Prénom</span>
              <input
                className={styles.modalInput}
                value={form.firstName}
                maxLength={80}
                placeholder="Marie"
                onChange={(e) => set("firstName", e.target.value)}
              />
            </label>
            <label className={styles.modalField}>
              <span className={styles.modalLabel}>Nom</span>
              <input
                className={styles.modalInput}
                value={form.lastName}
                maxLength={80}
                placeholder="DUPONT"
                onChange={(e) => set("lastName", e.target.value)}
              />
            </label>
          </div>

          <div className={styles.modalField}>
            <BilingualField
              label="Catégorie *"
              ids={{ fr: CATEGORY_FIELD_IDS.category, en: CATEGORY_FIELD_IDS.categoryEn }}
              fields={{ fr: "category", en: "categoryEn" }}
              errors={fieldErrors}
              values={{ fr: form.category, en: form.categoryEn }}
              onChange={setCategory}
              maxLength={BENEVOLE_CATEGORY_MAX}
              placeholders={{ fr: "Développeur, Arbitre, Caster…", en: "Developer, Referee, Caster…" }}
              enMissing={editing !== null && !hasEnglish(editing.categoryEn) && categoryEnglishOf(editing.category) === null}
              inputClassName={styles.modalInput}
              labelClassName={styles.modalLabel}
              listFr="category-suggestions"
              describedBy="benevole-category-hint"
            />
            <datalist id="category-suggestions">
              {[...new Set(benevoles.map((b) => b.category))].map((cat) => (
                <option key={cat} value={cat} />
              ))}
            </datalist>
            <span id="benevole-category-hint" className={styles.photoHint}>
              Une catégorie se traduit une fois pour toutes : l&apos;anglais vaut pour tous ses bénévoles.
            </span>
          </div>

          <label className={styles.modalField}>
            <span className={styles.modalLabel}>Date d'arrivée *</span>
            <input
              className={styles.modalInput}
              type="date"
              value={form.joinedAt}
              onChange={(e) => set("joinedAt", e.target.value)}
            />
          </label>

          <div className={styles.modalField}>
            <span className={styles.modalLabel}>Photo (optionnel)</span>
            <div className={styles.photoUploadActions}>
              <input
                ref={photoFileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className={styles.photoFileInput}
                onChange={onPhotoFile}
              />
              <button
                type="button"
                className={styles.photoUploadBtn}
                onClick={() => photoFileRef.current?.click()}
                disabled={photoBusy || busy}
              >
                {photoBusy ? "Envoi…" : photoLabel}
              </button>
              {form.photoUrl && (
                <button
                  type="button"
                  className={`${styles.photoUploadBtn} ${styles.photoUploadBtnDanger}`}
                  onClick={() => set("photoUrl", "")}
                  disabled={photoBusy || busy}
                >
                  Retirer
                </button>
              )}
            </div>
            <span className={styles.photoHint}>
              Carré recadré automatiquement, PNG / JPEG / WebP, 5 Mo max.
            </span>
            <input
              className={styles.modalInput}
              value={form.photoUrl}
              maxLength={500}
              placeholder="… ou colle une URL https://example.com/avatar.jpg"
              onChange={(e) => set("photoUrl", e.target.value)}
            />
          </div>

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
          title={`Retirer ${formatDisplayName(pendingRemoval)} des bénévoles ?`}
          confirmLabel="Retirer"
          pendingLabel="Retrait…"
          contentLang={staffLang}
          onClose={() => setPendingRemoval(null)}
          onConfirm={() => remove(pendingRemoval)}
        >
          <p>
            {formatDisplayName(pendingRemoval)} disparaît de la page Bénévoles et sa photo est effacée.
            Pour le remettre, il faudra le saisir à nouveau et réimporter la photo.
          </p>
        </ConfirmActionDialog>
      ) : null}
    </>
  );
}
