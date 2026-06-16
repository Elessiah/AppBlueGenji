"use client";

import { useEffect, useRef, useState } from "react";
import { CyberCard, CyberButton, TeamSigil } from "@/components/cyber";
import { useToast } from "@/components/ui/toast";
import {
  type BureauMember,
  computeInitials,
  FALLBACK_BUREAU,
  randomBureauColor,
} from "@/lib/shared/bureau";
import styles from "./page.module.css";

interface BureauSectionProps {
  initialMembers: BureauMember[];
  isAdmin: boolean;
}

interface FormState {
  name: string;
  role: string;
  initials: string;
  color: string;
}

const EMPTY_FORM: FormState = { name: "", role: "", initials: "", color: "" };

export function BureauSection({ initialMembers, isAdmin }: BureauSectionProps) {
  const { showError, showSuccess } = useToast();
  const [members, setMembers] = useState<BureauMember[]>(initialMembers);
  const [editing, setEditing] = useState<BureauMember | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Les membres de secours (id négatif) ne sont pas en base : non modifiables.
  const canManage = (m: BureauMember) => isAdmin && m.id > 0;

  // Fermeture au clavier (Échap) + focus initial sur le champ Nom à l'ouverture.
  useEffect(() => {
    if (!open) return;
    nameInputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, busy]);

  function openCreate() {
    setEditing(null);
    setForm({ name: "", role: "", initials: "", color: randomBureauColor() });
    setOpen(true);
  }

  function openEdit(member: BureauMember) {
    setEditing(member);
    setForm({ name: member.name, role: member.role, initials: member.initials, color: member.color });
    setOpen(true);
  }

  function close() {
    if (busy) return;
    setOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  // Initiales affichées : saisie manuelle si fournie, sinon dérivées du nom.
  const previewInitials = (form.initials.trim() || computeInitials(form.name) || "·").toUpperCase();

  async function submit() {
    if (!form.name.trim()) {
      showError("Le nom est requis.");
      return;
    }
    if (!form.role.trim()) {
      showError("Le rôle est requis.");
      return;
    }

    setBusy(true);
    const payload = {
      name: form.name.trim(),
      role: form.role.trim(),
      initials: form.initials.trim() || computeInitials(form.name),
      color: form.color || randomBureauColor(),
    };

    try {
      const url = editing ? `/api/association/bureau/${editing.id}` : "/api/association/bureau";
      const res = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { member?: BureauMember; error?: string };
      if (!res.ok || !data.member) {
        showError(data.error ? `Échec : ${data.error}` : "Échec de l'enregistrement.");
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

  async function remove(member: BureauMember) {
    if (!window.confirm(`Supprimer ${member.name} du bureau ?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/association/bureau/${member.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        showError(data.error ? `Échec : ${data.error}` : "Échec de la suppression.");
        return;
      }
      // Si plus aucun membre réel, réafficher le bureau de secours — c'est ce
      // que renverrait un rechargement (table vide → FALLBACK_BUREAU).
      setMembers((prev) => {
        const next = prev.filter((m) => m.id !== member.id);
        return next.length === 0 ? FALLBACK_BUREAU : next;
      });
      showSuccess("Membre du bureau supprimé.");
    } catch {
      showError("Erreur réseau, réessaye.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.section}>
      <header className={styles.head}>
        <div>
          <span className="eyebrow">SECTION 05</span>
          <h2 className={styles.sectionTitle}>Bureau</h2>
        </div>
        <div className={styles.bureauHeadActions}>
          <span className={styles.meta}>
            {members.length} MEMBRE{members.length > 1 ? "S" : ""} · BÉNÉVOLES
          </span>
          {isAdmin && (
            <CyberButton variant="primary" onClick={openCreate}>
              + Ajouter
            </CyberButton>
          )}
        </div>
      </header>

      <div className={styles.bureauGrid}>
        {members.map((b) => (
          <CyberCard key={b.id} lift className={styles.bureauCard}>
            <div className={styles.bureauSigil}>
              <TeamSigil letter={b.initials} color={b.color} size={40} />
            </div>
            <div className={styles.bureauDivider} />
            <div>
              <h3 className={styles.bureauName}>{b.name}</h3>
              <p className={styles.bureauRole}>{b.role}</p>
            </div>
            {canManage(b) && (
              <div className={styles.bureauCardActions}>
                <button
                  type="button"
                  className={styles.bureauAction}
                  onClick={() => openEdit(b)}
                  disabled={busy}
                  aria-label={`Modifier ${b.name}`}
                >
                  Modifier
                </button>
                <button
                  type="button"
                  className={`${styles.bureauAction} ${styles.bureauActionDanger}`}
                  onClick={() => remove(b)}
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
        <div className={styles.modalOverlay} onClick={close} role="presentation">
          <div
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={editing ? "Modifier un membre du bureau" : "Ajouter un membre du bureau"}
          >
            <h3 className={styles.modalTitle}>
              {editing ? "Modifier le membre" : "Ajouter un membre"}
            </h3>

            <div className={styles.modalPreview}>
              <TeamSigil letter={previewInitials} color={form.color || "var(--blue-500)"} size={40} />
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
                ref={nameInputRef}
                className={styles.modalInput}
                value={form.name}
                maxLength={120}
                placeholder="Léo Perreaut"
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </label>

            <label className={styles.modalField}>
              <span className={styles.modalLabel}>Rôle</span>
              <input
                className={styles.modalInput}
                value={form.role}
                maxLength={120}
                placeholder="Président"
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              />
            </label>

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
                {busy ? "…" : editing ? "Enregistrer" : "Ajouter"}
              </CyberButton>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
