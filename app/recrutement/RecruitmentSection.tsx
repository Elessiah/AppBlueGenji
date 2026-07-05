"use client";

import { useEffect, useRef, useState } from "react";
import { CyberButton, CyberCard, Pill } from "@/components/cyber";
import { useToast } from "@/components/ui/toast";
import {
  type RecruitmentAd,
  type RecruitmentGame,
  type RecruitmentHighlight,
  RECRUITMENT_GAMES,
  RECRUITMENT_GAME_LABELS,
  RECRUITMENT_HIGHLIGHTS,
  RECRUITMENT_HIGHLIGHT_LABELS,
} from "@/lib/shared/recruitment";
import styles from "./page.module.css";

interface RecruitmentSectionProps {
  initialAds: RecruitmentAd[];
  isAdmin: boolean;
}

interface FormState {
  title: string;
  teamName: string;
  game: RecruitmentGame;
  roles: string;
  body: string;
  contactUrl: string;
  highlight: RecruitmentHighlight;
  active: boolean;
}

const EMPTY_FORM: FormState = {
  title: "",
  teamName: "",
  game: "ANY",
  roles: "",
  body: "",
  contactUrl: "",
  highlight: "NONE",
  active: true,
};

export function RecruitmentSection({ initialAds, isAdmin }: RecruitmentSectionProps) {
  const { showError, showSuccess } = useToast();
  const [ads, setAds] = useState<RecruitmentAd[]>(initialAds);
  const [editing, setEditing] = useState<RecruitmentAd | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    titleRef.current?.focus();
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

  function openEdit(ad: RecruitmentAd) {
    setEditing(ad);
    setForm({
      title: ad.title,
      teamName: ad.teamName ?? "",
      game: ad.game,
      roles: ad.roles ?? "",
      body: ad.body ?? "",
      contactUrl: ad.contactUrl ?? "",
      highlight: ad.highlight,
      active: ad.active,
    });
    setOpen(true);
  }

  function close() {
    if (busy) return;
    setOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  function set<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function submit() {
    if (!form.title.trim()) {
      showError("Le titre est requis.");
      return;
    }

    setBusy(true);
    const payload = {
      title: form.title.trim(),
      teamName: form.teamName.trim() || null,
      game: form.game,
      roles: form.roles.trim() || null,
      body: form.body.trim() || null,
      contactUrl: form.contactUrl.trim() || null,
      highlight: form.highlight,
      active: form.active,
    };

    try {
      const url = editing ? `/api/recruitment/${editing.id}` : "/api/recruitment";
      const res = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { ad?: RecruitmentAd; error?: string };
      if (!res.ok || !data.ad) {
        showError(data.error ? `Échec : ${data.error}` : "Échec de l'enregistrement.");
        return;
      }

      if (editing) {
        setAds((prev) => prev.map((a) => (a.id === data.ad!.id ? data.ad! : a)));
        showSuccess("Annonce mise à jour.");
      } else {
        setAds((prev) => [...prev, data.ad!]);
        showSuccess("Annonce publiée.");
      }
      close();
    } catch {
      showError("Erreur réseau, réessaye.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(ad: RecruitmentAd) {
    if (!window.confirm(`Supprimer l'annonce « ${ad.title} » ?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/recruitment/${ad.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        showError(data.error ? `Échec : ${data.error}` : "Échec de la suppression.");
        return;
      }
      setAds((prev) => prev.filter((a) => a.id !== ad.id));
      showSuccess("Annonce supprimée.");
    } catch {
      showError("Erreur réseau, réessaye.");
    } finally {
      setBusy(false);
    }
  }

  // Déplace une annonce d'un cran (admin). Mise à jour optimiste avec rollback.
  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= ads.length) return;

    const previous = ads;
    const reordered = [...ads];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setAds(reordered);

    setBusy(true);
    try {
      const res = await fetch("/api/recruitment/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: reordered.map((a) => a.id) }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        showError(data.error ? `Échec : ${data.error}` : "Échec du réordonnancement.");
        setAds(previous);
        return;
      }
      showSuccess("Ordre mis à jour.");
    } catch {
      showError("Erreur réseau, réessaye.");
      setAds(previous);
    } finally {
      setBusy(false);
    }
  }

  const count = ads.length;

  return (
    <>
      <section className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">ANNONCES</span>
            <h2 className={styles.sectionTitle}>Recrutement en cours</h2>
          </div>
          <div className={styles.headActions}>
            <span className={styles.meta}>
              {count} ANNONCE{count > 1 ? "S" : ""}
            </span>
            {isAdmin && (
              <CyberButton variant="primary" onClick={openCreate}>
                + Nouvelle annonce
              </CyberButton>
            )}
          </div>
        </header>

        {count === 0 ? (
          <div className={styles.empty}>
            <p>Aucune annonce de recrutement pour le moment.</p>
            {isAdmin && (
              <CyberButton variant="primary" onClick={openCreate}>
                Publier la première annonce
              </CyberButton>
            )}
          </div>
        ) : (
          <div className={styles.list}>
            {ads.map((ad, index) => (
              <CyberCard key={ad.id} lift className={styles.card}>
                <div className={styles.cardHead}>
                  <div className={styles.cardTags}>
                    <Pill variant="blue">{RECRUITMENT_GAME_LABELS[ad.game]}</Pill>
                    {ad.highlight !== "NONE" && <Pill variant="live">Urgent</Pill>}
                    {!ad.active && <Pill>Inactif</Pill>}
                  </div>
                  {isAdmin && (
                    <div className={styles.moveActions}>
                      <button
                        type="button"
                        className={styles.move}
                        onClick={() => move(index, -1)}
                        disabled={busy || index === 0}
                        aria-label={`Monter l'annonce ${ad.title}`}
                        title="Monter"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className={styles.move}
                        onClick={() => move(index, 1)}
                        disabled={busy || index === ads.length - 1}
                        aria-label={`Descendre l'annonce ${ad.title}`}
                        title="Descendre"
                      >
                        ↓
                      </button>
                    </div>
                  )}
                </div>

                <h3 className={styles.cardTitle}>{ad.title}</h3>
                {ad.teamName && <p className={styles.cardTeam}>{ad.teamName}</p>}
                {ad.roles && <p className={styles.cardRoles}>Postes : {ad.roles}</p>}
                {ad.body && <p className={styles.cardBody}>{ad.body}</p>}

                <div className={styles.cardFooter}>
                  {ad.contactUrl && (
                    <CyberButton variant="ghost" asChild>
                      <a href={ad.contactUrl} target="_blank" rel="noopener noreferrer">
                        Postuler →
                      </a>
                    </CyberButton>
                  )}
                  {isAdmin && (
                    <div className={styles.cardActions}>
                      <button
                        type="button"
                        className={styles.action}
                        onClick={() => openEdit(ad)}
                        disabled={busy}
                        aria-label={`Modifier ${ad.title}`}
                      >
                        Modifier
                      </button>
                      <button
                        type="button"
                        className={`${styles.action} ${styles.actionDanger}`}
                        onClick={() => remove(ad)}
                        disabled={busy}
                        aria-label={`Supprimer ${ad.title}`}
                      >
                        Supprimer
                      </button>
                    </div>
                  )}
                </div>
              </CyberCard>
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
            aria-busy={busy}
            aria-label={editing ? "Modifier une annonce" : "Nouvelle annonce"}
          >
            <h3 className={styles.modalTitle}>
              {editing ? "Modifier l'annonce" : "Nouvelle annonce"}
            </h3>

            <label className={styles.modalField}>
              <span className={styles.modalLabel}>Titre *</span>
              <input
                ref={titleRef}
                className={styles.modalInput}
                value={form.title}
                maxLength={140}
                placeholder="Recherche TANK pour la Ligue BlueGenji"
                onChange={(e) => set("title", e.target.value)}
              />
            </label>

            <div className={styles.modalRow}>
              <label className={styles.modalField}>
                <span className={styles.modalLabel}>Équipe (optionnel)</span>
                <input
                  className={styles.modalInput}
                  value={form.teamName}
                  maxLength={120}
                  placeholder="Team Sakura"
                  onChange={(e) => set("teamName", e.target.value)}
                />
              </label>
              <label className={styles.modalField}>
                <span className={styles.modalLabel}>Jeu</span>
                <select
                  className={styles.modalInput}
                  value={form.game}
                  onChange={(e) => set("game", e.target.value as RecruitmentGame)}
                >
                  {RECRUITMENT_GAMES.map((g) => (
                    <option key={g} value={g}>
                      {RECRUITMENT_GAME_LABELS[g]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className={styles.modalField}>
              <span className={styles.modalLabel}>Postes recherchés (optionnel)</span>
              <input
                className={styles.modalInput}
                value={form.roles}
                maxLength={200}
                placeholder="TANK, HEAL, Coach…"
                onChange={(e) => set("roles", e.target.value)}
              />
            </label>

            <label className={styles.modalField}>
              <span className={styles.modalLabel}>Description (optionnel)</span>
              <textarea
                className={`${styles.modalInput} ${styles.modalTextarea}`}
                value={form.body}
                maxLength={2000}
                rows={4}
                placeholder="Rythme des entraînements, niveau attendu, ambiance…"
                onChange={(e) => set("body", e.target.value)}
              />
            </label>

            <label className={styles.modalField}>
              <span className={styles.modalLabel}>Lien de candidature (optionnel)</span>
              <input
                className={styles.modalInput}
                value={form.contactUrl}
                maxLength={2048}
                placeholder="https://discord.gg/…"
                onChange={(e) => set("contactUrl", e.target.value)}
              />
            </label>

            <label className={styles.modalField}>
              <span className={styles.modalLabel}>Mise en avant (annonce urgente)</span>
              <select
                className={styles.modalInput}
                value={form.highlight}
                onChange={(e) => set("highlight", e.target.value as RecruitmentHighlight)}
              >
                {RECRUITMENT_HIGHLIGHTS.map((h) => (
                  <option key={h} value={h}>
                    {RECRUITMENT_HIGHLIGHT_LABELS[h]}
                  </option>
                ))}
              </select>
              <span className={styles.modalHint}>
                Une seule annonce est mise en avant à la fois (la plus haute dans la liste).
              </span>
            </label>

            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => set("active", e.target.checked)}
              />
              <span>Annonce active (visible publiquement)</span>
            </label>

            <div className={styles.modalActions}>
              <CyberButton variant="ghost" onClick={close} disabled={busy}>
                Annuler
              </CyberButton>
              <CyberButton variant="primary" onClick={submit} disabled={busy}>
                {busy ? "…" : editing ? "Enregistrer" : "Publier"}
              </CyberButton>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
