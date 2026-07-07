"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { CyberButton, CyberCard, Pill } from "@/components/cyber";
import { useToast } from "@/components/ui/toast";
import {
  type RecruiterContactDefaults,
  type RecruitmentAd,
  type RecruitmentContactChannel,
  type RecruitmentDomain,
  type RecruitmentHighlight,
  RECRUITMENT_CONTACT_CHANNELS,
  RECRUITMENT_CONTACT_CHANNEL_LABELS,
  RECRUITMENT_DISCORD_MAX,
  RECRUITMENT_DOMAINS,
  RECRUITMENT_DOMAIN_LABELS,
  RECRUITMENT_HIGHLIGHTS,
  RECRUITMENT_HIGHLIGHT_LABELS,
} from "@/lib/shared/recruitment";
import styles from "./page.module.css";

interface RecruitmentSectionProps {
  initialAds: RecruitmentAd[];
  isAdmin: boolean;
  contactDefaults?: RecruiterContactDefaults;
}

interface FormState {
  title: string;
  teamName: string;
  domain: RecruitmentDomain;
  roles: string;
  body: string;
  contactUrl: string;
  contactDiscord: string;
  contactPreferred: RecruitmentContactChannel;
  highlight: RecruitmentHighlight;
  active: boolean;
}

const EMPTY_FORM: FormState = {
  title: "",
  teamName: "",
  domain: "AUTRE",
  roles: "",
  body: "",
  contactUrl: "",
  contactDiscord: "",
  contactPreferred: "AUTO",
  highlight: "NONE",
  active: true,
};

// Un contact Discord fourni sous forme d'URL (invitation, lien profil) devient un
// lien ; sinon c'est un pseudo à copier.
function isUrl(value: string): boolean {
  return /^(https?:\/\/|discord\.gg\/)/i.test(value.trim());
}

// Normalise une URL Discord/lien pour l'attribut href (préfixe le schéma si absent).
function toHref(value: string): string {
  const v = value.trim();
  return v.startsWith("http") ? v : `https://${v}`;
}

/* Icônes de canal — Discord en glyphe de marque (fill), le reste en trait (stroke)
   pour rester cohérent avec l'iconographie « cyber minimal » du site. */
function DiscordGlyph() {
  return (
    <svg className={styles.contactTagIcon} viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.011c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

function strokeIcon(children: ReactNode) {
  return (
    <svg
      className={styles.contactTagIcon}
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const CopyGlyph = () =>
  strokeIcon(
    <>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>,
  );
const OpenGlyph = () =>
  strokeIcon(
    <>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </>,
  );

export function RecruitmentSection({ initialAds, isAdmin, contactDefaults }: RecruitmentSectionProps) {
  const { showError, showSuccess } = useToast();
  const [ads, setAds] = useState<RecruitmentAd[]>(initialAds);
  const [editing, setEditing] = useState<RecruitmentAd | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  // Couple (pseudo, id Discord) cohérent connu au moment de l'ouverture du
  // formulaire. On ne renvoie l'`id` (deep-link) que si le pseudo n'a pas été
  // remplacé, pour éviter d'associer l'id d'un recruteur à un pseudo tiers.
  const discordSnapshot = useRef<{ pseudo: string; id: string | null }>({ pseudo: "", id: null });

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
    const discord = contactDefaults?.discord ?? "";
    // Pré-remplissage du Discord depuis le profil du recruteur — modifiable / effaçable.
    setForm({ ...EMPTY_FORM, contactDiscord: discord });
    discordSnapshot.current = { pseudo: discord, id: contactDefaults?.discordId ?? null };
    setOpen(true);
  }

  function openEdit(ad: RecruitmentAd) {
    setEditing(ad);
    setForm({
      title: ad.title,
      teamName: ad.teamName ?? "",
      domain: ad.domain,
      roles: ad.roles ?? "",
      body: ad.body ?? "",
      contactUrl: ad.contactUrl ?? "",
      contactDiscord: ad.contactDiscord ?? "",
      contactPreferred: ad.contactPreferred,
      highlight: ad.highlight,
      active: ad.active,
    });
    // L'id enregistré reste valide tant que le pseudo n'est pas modifié.
    discordSnapshot.current = { pseudo: ad.contactDiscord ?? "", id: ad.contactDiscordId };
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
    const discord = form.contactDiscord.trim();
    // On ne conserve l'id de deep-link que si le pseudo est resté celui pour
    // lequel l'id a été dérivé (profil du recruteur ou valeur enregistrée).
    const contactDiscordId =
      discord && discord === discordSnapshot.current.pseudo ? discordSnapshot.current.id : null;
    const payload = {
      title: form.title.trim(),
      teamName: form.teamName.trim() || null,
      domain: form.domain,
      roles: form.roles.trim() || null,
      body: form.body.trim() || null,
      contactUrl: form.contactUrl.trim() || null,
      contactDiscord: discord || null,
      contactDiscordId,
      contactPreferred: form.contactPreferred,
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

  // Copie une valeur dans le presse-papiers. Toast de confirmation, jamais inline.
  async function copyContact(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      showSuccess(`${label} copié : ${value}`);
    } catch {
      showError("Impossible de copier, copie manuellement.");
    }
  }

  // Copie l'ensemble des canaux de contact d'une annonce, prêt à coller en DM.
  async function copyAllContacts(ad: RecruitmentAd) {
    const lines: string[] = [];
    if (ad.contactDiscord) lines.push(`Discord : ${ad.contactDiscord}`);
    if (ad.contactUrl) lines.push(`Lien : ${ad.contactUrl}`);
    if (lines.length === 0) return;
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      showSuccess("Contacts copiés dans le presse-papiers.");
    } catch {
      showError("Impossible de copier, copie manuellement.");
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
            <p>Aucun poste à pourvoir dans le staff pour le moment.</p>
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
                    <Pill variant="blue">{RECRUITMENT_DOMAIN_LABELS[ad.domain]}</Pill>
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
                {ad.roles && <p className={styles.cardRoles}>Missions : {ad.roles}</p>}
                {ad.body && <p className={styles.cardBody}>{ad.body}</p>}

                {(ad.contactDiscord || ad.contactDiscordId) && (
                  <div className={styles.contactTags} aria-label="Contacts">
                    {ad.contactDiscord &&
                      (isUrl(ad.contactDiscord) ? (
                        <a
                          className={`${styles.contactTag} ${ad.contactPreferred === "DISCORD" ? styles.contactTagPrimary : ""}`}
                          href={toHref(ad.contactDiscord)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <DiscordGlyph />
                          <span className={styles.contactTagKey}>Discord</span>
                          <span className={styles.contactTagVal}>Rejoindre</span>
                          <OpenGlyph />
                        </a>
                      ) : (
                        <button
                          type="button"
                          className={`${styles.contactTag} ${ad.contactPreferred === "DISCORD" ? styles.contactTagPrimary : ""}`}
                          onClick={() => copyContact(ad.contactDiscord!, "Pseudo Discord")}
                          title="Copier le pseudo Discord"
                        >
                          <DiscordGlyph />
                          <span className={styles.contactTagKey}>Discord</span>
                          <span className={styles.contactTagVal}>{ad.contactDiscord}</span>
                          <CopyGlyph />
                        </button>
                      ))}
                    {ad.contactDiscordId && (
                      <a
                        className={styles.contactTag}
                        href={`https://discord.com/users/${ad.contactDiscordId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Ouvrir la conversation Discord"
                      >
                        <DiscordGlyph />
                        <span className={styles.contactTagVal}>Ouvrir</span>
                        <OpenGlyph />
                      </a>
                    )}
                    {[ad.contactDiscord, ad.contactUrl].filter(Boolean).length >= 2 && (
                      <button
                        type="button"
                        className={styles.contactTag}
                        onClick={() => copyAllContacts(ad)}
                        title="Copier tous les contacts"
                      >
                        <CopyGlyph />
                        <span className={styles.contactTagVal}>Copier les contacts</span>
                      </button>
                    )}
                  </div>
                )}

                <div className={styles.cardFooter}>
                  {ad.contactUrl && (
                    <CyberButton variant={ad.contactPreferred === "LINK" ? "primary" : "ghost"} asChild>
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
                placeholder="Recherche arbitre pour les tournois du dimanche"
                onChange={(e) => set("title", e.target.value)}
              />
            </label>

            <div className={styles.modalRow}>
              <label className={styles.modalField}>
                <span className={styles.modalLabel}>Référent / contact (optionnel)</span>
                <input
                  className={styles.modalInput}
                  value={form.teamName}
                  maxLength={120}
                  placeholder="Pôle arbitrage · Marie"
                  onChange={(e) => set("teamName", e.target.value)}
                />
              </label>
              <label className={styles.modalField}>
                <span className={styles.modalLabel}>Pôle</span>
                <select
                  className={styles.modalInput}
                  value={form.domain}
                  onChange={(e) => set("domain", e.target.value as RecruitmentDomain)}
                >
                  {RECRUITMENT_DOMAINS.map((d) => (
                    <option key={d} value={d}>
                      {RECRUITMENT_DOMAIN_LABELS[d]}
                    </option>
                  ))}
                </select>
                <span className={styles.modalHint}>Domaine de bénévolat concerné.</span>
              </label>
            </div>

            <label className={styles.modalField}>
              <span className={styles.modalLabel}>Missions / profil recherché (optionnel)</span>
              <input
                className={styles.modalInput}
                value={form.roles}
                maxLength={200}
                placeholder="Arbitrer les matchs, gérer les litiges…"
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
                placeholder="Disponibilités attendues, compétences, ambiance de l'équipe…"
                onChange={(e) => set("body", e.target.value)}
              />
            </label>

            <label className={styles.modalField}>
              <span className={styles.modalLabel}>Lien de candidature (optionnel)</span>
              <input
                className={styles.modalInput}
                value={form.contactUrl}
                maxLength={2048}
                placeholder="https://…/ticket (SpiceWorks, formulaire…)"
                onChange={(e) => set("contactUrl", e.target.value)}
              />
              <span className={styles.modalHint}>
                Bouton « Postuler → » de l'annonce. Idéal : un lien vers un ticket SpiceWorks.
              </span>
            </label>

            <label className={styles.modalField}>
              <span className={styles.modalLabel}>Contact Discord (optionnel)</span>
              <input
                className={styles.modalInput}
                value={form.contactDiscord}
                maxLength={RECRUITMENT_DISCORD_MAX}
                placeholder="pseudo#0000 ou lien d'invitation"
                onChange={(e) => set("contactDiscord", e.target.value)}
              />
              <span className={styles.modalHint}>Pseudo (copiable) ou lien d'invitation Discord.</span>
            </label>
            {!editing && contactDefaults?.discord && (
              <p className={styles.modalHint}>
                Discord pré-rempli depuis ton profil — modifie ou efface librement.
              </p>
            )}

            <label className={styles.modalField}>
              <span className={styles.modalLabel}>Canal de contact préféré</span>
              <select
                className={styles.modalInput}
                value={form.contactPreferred}
                onChange={(e) => set("contactPreferred", e.target.value as RecruitmentContactChannel)}
              >
                {RECRUITMENT_CONTACT_CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {RECRUITMENT_CONTACT_CHANNEL_LABELS[c]}
                  </option>
                ))}
              </select>
              <span className={styles.modalHint}>Le canal choisi est mis en avant sur l'annonce.</span>
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
