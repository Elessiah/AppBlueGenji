"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { CyberButton, CyberCard } from "@/components/cyber";
import { useToast } from "@/components/ui/toast";
import {
  type Benevole,
  benevoleInitials,
  formatDisplayName,
  formatJoinedAt,
  groupByCategory,
  validateBenevoleInput,
} from "@/lib/shared/benevoles";
import { toServedUploadUrl } from "@/lib/shared/uploads";
import styles from "./page.module.css";

const ACCEPTED_PHOTO_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

interface BenevoleSectionProps {
  initialBenevoles: Benevole[];
  isAdmin: boolean;
}

interface FormState {
  firstName: string;
  pseudo: string;
  lastName: string;
  category: string;
  photoUrl: string;
  joinedAt: string;
}

const EMPTY_FORM: FormState = {
  firstName: "",
  pseudo: "",
  lastName: "",
  category: "",
  photoUrl: "",
  joinedAt: "",
};

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
};

export function BenevolesSection({ initialBenevoles, isAdmin }: BenevoleSectionProps) {
  const { showError, showSuccess } = useToast();
  const [benevoles, setBenevoles] = useState<Benevole[]>(initialBenevoles);
  const groups = useMemo(() => groupByCategory(benevoles), [benevoles]);
  const [editing, setEditing] = useState<Benevole | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const pseudoRef = useRef<HTMLInputElement>(null);
  const photoFileRef = useRef<HTMLInputElement>(null);

  // Focus + Escape
  useEffect(() => {
    if (!open) return;
    pseudoRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, busy]);

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, joinedAt: new Date().toISOString().slice(0, 10) });
    setOpen(true);
  }

  function openEdit(b: Benevole) {
    setEditing(b);
    setForm({
      firstName: b.firstName,
      pseudo: b.pseudo ?? "",
      lastName: b.lastName,
      category: b.category,
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

  async function submit() {
    const validation = validateBenevoleInput({
      firstName: form.firstName,
      pseudo: form.pseudo,
      lastName: form.lastName,
      category: form.category,
      photoUrl: form.photoUrl,
      joinedAt: form.joinedAt,
    });
    if (!validation.ok) {
      showError(VALIDATION_ERROR_MESSAGES[validation.error] ?? "Formulaire invalide.");
      return;
    }
    const { firstName, pseudo, lastName, category, photoUrl, joinedAt } = validation.value;

    setBusy(true);
    const payload = {
      firstName,
      pseudo: pseudo || null,
      lastName,
      category,
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
        showError(data.error ? `Échec : ${data.error}` : "Échec de l'enregistrement.");
        return;
      }

      if (editing) {
        setBenevoles((prev) => prev.map((b) => (b.id === data.benevole!.id ? data.benevole! : b)));
        showSuccess("Bénévole mis à jour.");
      } else {
        setBenevoles((prev) => [...prev, data.benevole!]);
        showSuccess("Bénévole ajouté.");
      }
      close();
    } catch {
      showError("Erreur réseau, réessaye.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(b: Benevole) {
    if (!window.confirm(`Retirer ${formatDisplayName(b)} de la liste des bénévoles ?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/benevoles/${b.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        showError(data.error ? `Échec : ${data.error}` : "Échec de la suppression.");
        return;
      }
      setBenevoles((prev) => prev.filter((x) => x.id !== b.id));
      showSuccess("Bénévole retiré.");
    } catch {
      showError("Erreur réseau, réessaye.");
    } finally {
      setBusy(false);
    }
  }

  async function onPhotoFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Réinitialise pour permettre de re-sélectionner le même fichier ensuite.
    event.target.value = "";
    if (!file) return;
    if (!ACCEPTED_PHOTO_TYPES.includes(file.type)) {
      showError("Format invalide : PNG, JPEG ou WebP uniquement.");
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      showError("Image trop lourde (5 Mo maximum).");
      return;
    }

    setPhotoBusy(true);
    try {
      const data = new FormData();
      data.append("file", file);
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

  const totalCount = benevoles.length;

  return (
    <>
      <section className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">SECTION 01</span>
            <h2 className={styles.sectionTitle}>Bénévoles</h2>
          </div>
          <div className={styles.headActions}>
            <span className={styles.meta}>
              {totalCount} BÉNÉVOLE{totalCount > 1 ? "S" : ""} · {groups.length} CATÉGORIE{groups.length > 1 ? "S" : ""}
            </span>
            {isAdmin && (
              <CyberButton variant="primary" onClick={openCreate}>
                + Ajouter
              </CyberButton>
            )}
          </div>
        </header>

        {groups.length === 0 ? (
          <div className={styles.empty}>
            <p>Aucun bénévole pour le moment.</p>
            {isAdmin && (
              <CyberButton variant="primary" onClick={openCreate}>
                Ajouter le premier bénévole
              </CyberButton>
            )}
          </div>
        ) : (
          <div className={styles.categories}>
            {groups.map(({ category, members }, index) => (
              <div key={category} className={styles.categoryBlock}>
                <div className={styles.categoryHeader}>
                  <span className={styles.categoryTitle}>{category}</span>
                  <span className={styles.categoryCount}>{members.length}</span>
                  {isAdmin && groups.length > 1 && (
                    <div className={styles.categoryActions}>
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
                            unoptimized
                            referrerPolicy="no-referrer"
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
                          Depuis le {formatJoinedAt(b.joinedAt)}
                        </p>
                      </div>
                      {isAdmin && (
                        <div className={styles.cardActions}>
                          <button
                            type="button"
                            className={styles.action}
                            onClick={() => openEdit(b)}
                            disabled={busy}
                            aria-label={`Modifier ${formatDisplayName(b)}`}
                          >
                            Modifier
                          </button>
                          <button
                            type="button"
                            className={`${styles.action} ${styles.actionDanger}`}
                            onClick={() => remove(b)}
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
        <div className={styles.modalOverlay} onClick={close} role="presentation">
          <div
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-busy={busy || photoBusy}
            aria-label={editing ? "Modifier un bénévole" : "Ajouter un bénévole"}
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
                  unoptimized
                  referrerPolicy="no-referrer"
                  className={styles.avatar}
                />
              ) : (
                <div className={styles.avatarFallback} style={{ width: 56, height: 56, fontSize: 20 }}>
                  {benevoleInitials(form)}
                </div>
              )}
              <div className={styles.modalPreviewName}>
                {form.firstName || form.lastName
                  ? `${form.firstName || "Prénom"}${form.pseudo ? ` "${form.pseudo}"` : ""} ${form.lastName ? form.lastName.toUpperCase() : "NOM"}`
                  : (form.pseudo || "Pseudo, ou prénom et nom")}
              </div>
            </div>

            <label className={styles.modalField}>
              <span className={styles.modalLabel}>Pseudo</span>
              <input
                ref={pseudoRef}
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

            <label className={styles.modalField}>
              <span className={styles.modalLabel}>Catégorie *</span>
              <input
                className={styles.modalInput}
                value={form.category}
                maxLength={120}
                placeholder="Développeur, Arbitre, Caster…"
                onChange={(e) => set("category", e.target.value)}
                list="category-suggestions"
              />
              <datalist id="category-suggestions">
                {[...new Set(benevoles.map((b) => b.category))].map((cat) => (
                  <option key={cat} value={cat} />
                ))}
              </datalist>
            </label>

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
                  {photoBusy ? "Envoi…" : form.photoUrl ? "Changer la photo" : "Importer une image"}
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
                {busy ? "…" : editing ? "Enregistrer" : "Ajouter"}
              </CyberButton>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
