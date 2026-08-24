"use client";

import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ui/toast";
import {
  type AboutPillar,
  ABOUT_PILLAR_TEXT_MAX,
  ABOUT_PILLAR_TITLE_MAX,
  FALLBACK_ABOUT_PILLARS,
} from "@/lib/shared/about-pillars";
import styles from "./AboutPillars.module.css";

interface AboutPillarsProps {
  initialPillars: AboutPillar[];
  isAdmin: boolean;
}

interface FormState {
  title: string;
  text: string;
}

const EMPTY_FORM: FormState = { title: "", text: "" };

export function AboutPillars({ initialPillars, isAdmin }: AboutPillarsProps) {
  const { showError, showSuccess } = useToast();
  const [pillars, setPillars] = useState<AboutPillar[]>(initialPillars);
  const [editing, setEditing] = useState<AboutPillar | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Les cartes de secours (id négatif) ne sont pas en base : non modifiables.
  const canManage = (p: AboutPillar) => isAdmin && p.id > 0;

  // Fermeture au clavier (Échap) + focus initial sur le champ Titre à l'ouverture.
  useEffect(() => {
    if (!open) return;
    titleInputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, busy]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  }

  function openEdit(pillar: AboutPillar) {
    setEditing(pillar);
    setForm({ title: pillar.title, text: pillar.text });
    setOpen(true);
  }

  function close() {
    if (busy) return;
    setOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  async function submit() {
    if (!form.title.trim()) {
      showError("Le titre est requis.");
      return;
    }
    if (!form.text.trim()) {
      showError("Le texte est requis.");
      return;
    }

    setBusy(true);
    const payload = { title: form.title.trim(), text: form.text.trim() };

    try {
      const url = editing ? `/api/association/about-pillars/${editing.id}` : "/api/association/about-pillars";
      const res = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { pillar?: AboutPillar; error?: string };
      if (!res.ok || !data.pillar) {
        showError(data.error ? `Échec : ${data.error}` : "Échec de l'enregistrement.");
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

  async function remove(pillar: AboutPillar) {
    if (!window.confirm(`Supprimer la carte « ${pillar.title} » ?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/association/about-pillars/${pillar.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        showError(data.error ? `Échec : ${data.error}` : "Échec de la suppression.");
        return;
      }
      // Si plus aucune carte réelle, réafficher les cartes de secours — c'est ce
      // que renverrait un rechargement (table vide → FALLBACK_ABOUT_PILLARS).
      setPillars((prev) => {
        const next = prev.filter((p) => p.id !== pillar.id);
        return next.length === 0 ? FALLBACK_ABOUT_PILLARS : next;
      });
      showSuccess("Carte supprimée.");
    } catch {
      showError("Erreur réseau, réessaye.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {pillars.map((p, index) => (
        <article key={p.id} className={styles.pillar}>
          <span className="mono">{String(index + 1).padStart(2, "0")}</span>
          <div>
            <h3>{p.title}</h3>
            <p>{p.text}</p>
          </div>
          {canManage(p) && (
            <div className={styles.pillarActions}>
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
              <button
                type="button"
                className={styles.action}
                onClick={() => openEdit(p)}
                disabled={busy}
                aria-label={`Modifier la carte ${p.title}`}
              >
                Modifier
              </button>
              <button
                type="button"
                className={`${styles.action} ${styles.actionDanger}`}
                onClick={() => remove(p)}
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
        <button type="button" className={styles.addBtn} onClick={openCreate} disabled={busy}>
          + Ajouter une carte
        </button>
      )}

      {open && (
        <div className={styles.modalOverlay} onClick={close} role="presentation">
          <div
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="about-pillar-modal-title"
          >
            <h3 id="about-pillar-modal-title" className={styles.modalTitle}>
              {editing ? "Modifier la carte" : "Ajouter une carte"}
            </h3>

            <label className={styles.modalField}>
              <span className={styles.modalLabel}>Titre</span>
              <input
                ref={titleInputRef}
                className={styles.modalInput}
                value={form.title}
                maxLength={ABOUT_PILLAR_TITLE_MAX}
                placeholder="Accessible"
                enterKeyHint="next"
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </label>

            <label className={styles.modalField}>
              <span className={styles.modalLabel}>Texte</span>
              <textarea
                className={styles.modalInput}
                value={form.text}
                maxLength={ABOUT_PILLAR_TEXT_MAX}
                placeholder="Inscription gratuite, matchmaking par niveau…"
                rows={3}
                onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))}
              />
            </label>

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
                {busy ? "…" : editing ? "Enregistrer" : "Ajouter"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
