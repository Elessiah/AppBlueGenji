"use client";

import { useEffect, useRef, useState } from "react";
import { CyberButton } from "@/components/cyber";
import { useToast } from "@/components/ui/toast";
import {
  type Sponsor,
  type SponsorTier,
  FALLBACK_SPONSORS,
  SPONSOR_TIERS,
  SPONSOR_TIER_LABELS,
} from "@/lib/shared/sponsors";
import styles from "./SponsorsGrid.module.css";

type SponsorsGridProps = {
  sponsors: Sponsor[];
  isAdmin?: boolean;
};

interface FormState {
  name: string;
  tier: SponsorTier;
  websiteUrl: string;
  logoUrl: string;
  description: string;
}

const EMPTY_FORM: FormState = { name: "", tier: "PARTNER", websiteUrl: "", logoUrl: "", description: "" };

// Tri par palier (GOLD → PARTNER), comme côté serveur. `sort` est stable :
// l'ordre relatif au sein d'un même palier est préservé (un nouvel élément
// ajouté en fin reste donc en fin de son palier, cohérent avec display_order).
function sortByTier(list: Sponsor[]): Sponsor[] {
  return [...list].sort((a, b) => SPONSOR_TIERS.indexOf(a.tier) - SPONSOR_TIERS.indexOf(b.tier));
}

export function SponsorsGrid({ sponsors, isAdmin = false }: SponsorsGridProps) {
  const { showError, showSuccess } = useToast();
  const [items, setItems] = useState<Sponsor[]>(sponsors);
  const [editing, setEditing] = useState<Sponsor | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Les sponsors de secours (id négatif) ne sont pas en base : non modifiables.
  const canManage = (s: Sponsor) => isAdmin && s.id > 0;
  // Vitrine publique limitée à 6 ; les admins voient/ gèrent l'ensemble.
  const displaySponsors = isAdmin ? items : items.slice(0, 6);

  useEffect(() => {
    if (!open) return;
    nameInputRef.current?.focus();
    // Verrouille le défilement de l'arrière-plan tant que la modale est ouverte.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, busy]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  }

  function openEdit(sponsor: Sponsor) {
    setEditing(sponsor);
    setForm({
      name: sponsor.name,
      tier: sponsor.tier,
      websiteUrl: sponsor.websiteUrl ?? "",
      logoUrl: sponsor.logoUrl ?? "",
      description: sponsor.description ?? "",
    });
    setOpen(true);
  }

  function close() {
    if (busy) return;
    setOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  async function submit() {
    if (!form.name.trim()) {
      showError("Le nom est requis.");
      return;
    }

    setBusy(true);
    const payload = {
      name: form.name.trim(),
      tier: form.tier,
      websiteUrl: form.websiteUrl.trim() || null,
      logoUrl: form.logoUrl.trim() || null,
      description: form.description.trim() || null,
    };

    try {
      const url = editing ? `/api/landing/sponsors/${editing.id}` : "/api/landing/sponsors";
      const res = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { sponsor?: Sponsor; error?: string };
      if (!res.ok || !data.sponsor) {
        showError(data.error ? `Échec : ${data.error}` : "Échec de l'enregistrement.");
        return;
      }

      if (editing) {
        setItems((prev) => sortByTier(prev.map((s) => (s.id === data.sponsor!.id ? data.sponsor! : s))));
        showSuccess("Partenaire mis à jour.");
      } else {
        // Si on partait des sponsors de secours, on bascule sur la liste réelle.
        setItems((prev) => sortByTier([...prev.filter((s) => s.id > 0), data.sponsor!]));
        showSuccess("Partenaire ajouté.");
      }
      close();
    } catch {
      showError("Erreur réseau, réessaye.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(sponsor: Sponsor) {
    if (!window.confirm(`Supprimer le partenaire « ${sponsor.name} » ?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/landing/sponsors/${sponsor.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        showError(data.error ? `Échec : ${data.error}` : "Échec de la suppression.");
        return;
      }
      // Si plus aucun sponsor réel, réafficher la vitrine de secours — c'est ce
      // que renverrait un rechargement (table vide → FALLBACK_SPONSORS).
      setItems((prev) => {
        const next = prev.filter((s) => s.id !== sponsor.id);
        return next.length === 0 ? FALLBACK_SPONSORS : next;
      });
      showSuccess("Partenaire supprimé.");
    } catch {
      showError("Erreur réseau, réessaye.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="sponsors" className={styles.root}>
      <div className={styles.head}>
        <div>
          <span className="eyebrow">SECTION 04</span>
          <h2 className={styles.sectionTitle}>Partenaires et soutiens</h2>
        </div>
        <div className={styles.headActions}>
          <span className={styles.meta}>{displaySponsors.length} PARTENAIRES</span>
          {isAdmin && (
            <CyberButton variant="primary" onClick={openCreate}>
              + Ajouter
            </CyberButton>
          )}
        </div>
      </div>

      <div className={styles.grid}>
        {displaySponsors.map((sponsor) => (
          <div key={sponsor.id} className={styles.slotWrap}>
            <a
              href={sponsor.websiteUrl ?? "#"}
              target="_blank"
              rel="noreferrer"
              className={styles.slot}
            >
              {sponsor.logoUrl ? (
                // Logos externes fournis par les admins : <img> simple (pas
                // d'allowlist de domaines requise par next/image).
                // eslint-disable-next-line @next/next/no-img-element
                <img src={sponsor.logoUrl} alt={sponsor.name} className={styles.logo} />
              ) : (
                <>
                  <svg className={styles.pattern} viewBox="0 0 300 100" preserveAspectRatio="none" aria-hidden="true">
                    <defs>
                      <pattern id={`hatch-${sponsor.slug}`} width="10" height="10" patternUnits="userSpaceOnUse">
                        <path d="M-1 1 l2 -2 M0 10 l10 -10 M8 12 l4 -4" stroke="rgba(180,210,230,0.12)" strokeWidth="1" />
                      </pattern>
                    </defs>
                    <rect width="300" height="100" fill={`url(#hatch-${sponsor.slug})`} />
                  </svg>
                  <span className="mono">{sponsor.name}</span>
                </>
              )}
            </a>
            {canManage(sponsor) && (
              <div className={styles.slotActions}>
                <button
                  type="button"
                  className={styles.slotAction}
                  onClick={() => openEdit(sponsor)}
                  disabled={busy}
                  aria-label={`Modifier ${sponsor.name}`}
                >
                  Modifier
                </button>
                <button
                  type="button"
                  className={`${styles.slotAction} ${styles.slotActionDanger}`}
                  onClick={() => remove(sponsor)}
                  disabled={busy}
                  aria-label={`Supprimer ${sponsor.name}`}
                >
                  Supprimer
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {open && (
        <div className={styles.modalOverlay} onClick={close} role="presentation">
          <div
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={editing ? "Modifier un partenaire" : "Ajouter un partenaire"}
          >
            <h3 className={styles.modalTitle}>{editing ? "Modifier le partenaire" : "Ajouter un partenaire"}</h3>

            <label className={styles.modalField}>
              <span className={styles.modalLabel}>Nom</span>
              <input
                ref={nameInputRef}
                className={styles.modalInput}
                value={form.name}
                maxLength={120}
                placeholder="LOGITECH G"
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </label>

            <label className={styles.modalField}>
              <span className={styles.modalLabel}>Palier</span>
              <select
                className={styles.modalInput}
                value={form.tier}
                onChange={(e) => setForm((f) => ({ ...f, tier: e.target.value as SponsorTier }))}
              >
                {SPONSOR_TIERS.map((tier) => (
                  <option key={tier} value={tier}>
                    {SPONSOR_TIER_LABELS[tier]}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.modalField}>
              <span className={styles.modalLabel}>Site web (optionnel)</span>
              <input
                className={styles.modalInput}
                value={form.websiteUrl}
                maxLength={2048}
                placeholder="https://exemple.com"
                onChange={(e) => setForm((f) => ({ ...f, websiteUrl: e.target.value }))}
              />
            </label>

            <label className={styles.modalField}>
              <span className={styles.modalLabel}>Logo — URL (optionnel)</span>
              <input
                className={styles.modalInput}
                value={form.logoUrl}
                maxLength={2048}
                placeholder="https://exemple.com/logo.png"
                onChange={(e) => setForm((f) => ({ ...f, logoUrl: e.target.value }))}
              />
            </label>

            <label className={styles.modalField}>
              <span className={styles.modalLabel}>Description (optionnel)</span>
              <input
                className={styles.modalInput}
                value={form.description}
                maxLength={1000}
                placeholder="Périphériques gaming"
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
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
