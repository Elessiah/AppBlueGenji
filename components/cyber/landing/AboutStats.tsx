"use client";

import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ui/toast";
import {
  type AboutStat,
  ABOUT_STAT_LABEL_MAX,
  ABOUT_STAT_VALUE_MAX,
  FALLBACK_ABOUT_STATS,
} from "@/lib/shared/about-stats";
import styles from "./AboutStats.module.css";

interface AboutStatsProps {
  initialStats: AboutStat[];
  isAdmin: boolean;
}

interface FormState {
  value: string;
  label: string;
}

const EMPTY_FORM: FormState = { value: "", label: "" };

export function AboutStats({ initialStats, isAdmin }: AboutStatsProps) {
  const { showError, showSuccess } = useToast();
  const [stats, setStats] = useState<AboutStat[]>(initialStats);
  const [editing, setEditing] = useState<AboutStat | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const valueInputRef = useRef<HTMLInputElement>(null);

  // Les cartes de secours (id négatif) ne sont pas en base : non modifiables.
  const canManage = (s: AboutStat) => isAdmin && s.id > 0;

  // Fermeture au clavier (Échap) + focus initial sur le champ Valeur à l'ouverture.
  useEffect(() => {
    if (!open) return;
    valueInputRef.current?.focus();
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

  function openEdit(stat: AboutStat) {
    setEditing(stat);
    setForm({ value: stat.value, label: stat.label });
    setOpen(true);
  }

  function close() {
    if (busy) return;
    setOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  async function submit() {
    if (!form.value.trim()) {
      showError("La valeur est requise.");
      return;
    }
    if (!form.label.trim()) {
      showError("Le titre est requis.");
      return;
    }

    setBusy(true);
    const payload = { value: form.value.trim(), label: form.label.trim() };

    try {
      const url = editing ? `/api/association/about-stats/${editing.id}` : "/api/association/about-stats";
      const res = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { stat?: AboutStat; error?: string };
      if (!res.ok || !data.stat) {
        showError(data.error ? `Échec : ${data.error}` : "Échec de l'enregistrement.");
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

  async function remove(stat: AboutStat) {
    if (!window.confirm(`Supprimer la carte « ${stat.value} · ${stat.label} » ?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/association/about-stats/${stat.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        showError(data.error ? `Échec : ${data.error}` : "Échec de la suppression.");
        return;
      }
      // Si plus aucune carte réelle, réafficher les cartes de secours — c'est ce
      // que renverrait un rechargement (table vide → FALLBACK_ABOUT_STATS).
      setStats((prev) => {
        const next = prev.filter((s) => s.id !== stat.id);
        return next.length === 0 ? FALLBACK_ABOUT_STATS : next;
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
      <div className={styles.stats}>
        {stats.map((s) => (
          <div key={s.id} className={styles.stat}>
            <div className="num" style={{ fontSize: 26 }}>{s.value}</div>
            <div className="mono">{s.label}</div>
            {canManage(s) && (
              <div className={styles.statActions}>
                <button
                  type="button"
                  className={styles.action}
                  onClick={() => openEdit(s)}
                  disabled={busy}
                  aria-label={`Modifier la carte ${s.label}`}
                >
                  Modifier
                </button>
                <button
                  type="button"
                  className={`${styles.action} ${styles.actionDanger}`}
                  onClick={() => remove(s)}
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
            aria-labelledby="about-stat-modal-title"
          >
            <h3 id="about-stat-modal-title" className={styles.modalTitle}>
              {editing ? "Modifier la carte" : "Ajouter une carte"}
            </h3>

            <label className={styles.modalField}>
              <span className={styles.modalLabel}>Valeur</span>
              <input
                ref={valueInputRef}
                className={styles.modalInput}
                value={form.value}
                maxLength={ABOUT_STAT_VALUE_MAX}
                placeholder="100%"
                enterKeyHint="next"
                onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
              />
            </label>

            <label className={styles.modalField}>
              <span className={styles.modalLabel}>Titre</span>
              <input
                className={styles.modalInput}
                value={form.label}
                maxLength={ABOUT_STAT_LABEL_MAX}
                placeholder="Bénévole"
                enterKeyHint="done"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !busy) submit();
                }}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
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
