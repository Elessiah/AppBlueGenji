"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CyberButton, CyberCard, Pill } from "@/components/cyber";
import { ContactTags } from "@/components/recruitment/ContactTags";
import { UrgentPill } from "@/components/recruitment/UrgentPill";
import { useToast } from "@/components/ui/toast";
import {
  type RecruiterContactDefaults,
  type RecruitmentAd,
  type RecruitmentContactChannel,
  type RecruitmentDomain,
  type RecruitmentPriority,
  buildRecruitmentPreview,
  canMoveRecruitmentAd,
  parseRecruitmentAdAnchor,
  placeRecruitmentAd,
  recruitmentAdAnchor,
  sortRecruitmentAds,
  splitRecruitmentAds,
  RECRUITMENT_BODY_MAX,
  RECRUITMENT_CONTACT_CHANNELS,
  RECRUITMENT_CONTACT_CHANNEL_LABELS,
  RECRUITMENT_DISCORD_MAX,
  RECRUITMENT_DOMAINS,
  RECRUITMENT_DOMAIN_LABELS,
  RECRUITMENT_PRIORITIES,
  RECRUITMENT_PRIORITY_DESCRIPTIONS,
  RECRUITMENT_PRIORITY_EXPOSURE,
  RECRUITMENT_PRIORITY_LABELS,
} from "@/lib/shared/recruitment";
import { AdDetailModal } from "./AdDetailModal";
import { LandingDialog } from "@/components/cyber/landing/LandingDialog";
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
  priority: RecruitmentPriority;
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
  priority: "OPTIONAL",
  active: true,
};

/** Filtre « tous les pôles » — valeur sentinelle hors de `RecruitmentDomain`. */
const ALL_DOMAINS = "ALL" as const;
type DomainFilter = RecruitmentDomain | typeof ALL_DOMAINS;

/**
 * En deçà de ce nombre d'annonces, le filtre par pôle n'apporte rien : il
 * encombrerait l'en-tête pour trier deux cartes déjà visibles d'un coup d'œil.
 */
const FILTER_MIN_ADS = 3;

/** Classe du badge de statut, côté gestion : une teinte par statut. */
const PRIORITY_BADGE_CLASS: Record<RecruitmentPriority, string> = {
  PRIORITY: styles.priorityBadgeUrgent,
  IMPORTANT: styles.priorityBadgeImportant,
  OPTIONAL: "",
};

export function RecruitmentSection({ initialAds, isAdmin, contactDefaults }: RecruitmentSectionProps) {
  const { showError, showSuccess } = useToast();
  // Toujours rangée par statut : les flèches de réordonnancement ne se lisent
  // que sur cet ordre-là (voir `canMoveRecruitmentAd`).
  const [ads, setAds] = useState<RecruitmentAd[]>(() => sortRecruitmentAds(initialAds));
  const [editing, setEditing] = useState<RecruitmentAd | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Annonce ouverte en lecture (modale « grand format »). Mémorisée par id pour
  // rester juste après une modification : la modale relit toujours la version
  // courante de la liste.
  const [detailId, setDetailId] = useState<number | null>(null);
  const [domainFilter, setDomainFilter] = useState<DomainFilter>(ALL_DOMAINS);
  // Couple (pseudo, id Discord) cohérent connu au moment de l'ouverture du
  // formulaire. On ne renvoie l'`id` (deep-link) que si le pseudo n'a pas été
  // remplacé, pour éviter d'associer l'id d'un recruteur à un pseudo tiers.
  const discordSnapshot = useRef<{ pseudo: string; id: string | null }>({ pseudo: "", id: null });

  // Lien profond `/recrutement#annonce-<id>` : ouvre directement l'annonce en
  // lecture (partage d'une annonce, bouton « Voir l'annonce » de la mise en
  // avant site). `hashchange` couvre les liens internes à la page. Le fragment
  // fait foi dans les deux sens : s'il ne désigne plus d'annonce, la lecture se
  // referme — sinon un lien interne vers une autre ancre laisserait le lecteur
  // enfermé sur une annonce que l'URL ne nomme plus.
  useEffect(() => {
    const syncFromHash = () => setDetailId(parseRecruitmentAdAnchor(window.location.hash));
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, []);

  // Annonce visée par le lien profond : `null` si elle n'existe pas (ou plus).
  const detailAd = detailId === null ? null : (ads.find((a) => a.id === detailId) ?? null);

  // Lien partagé vers une annonce supprimée ou dépubliée : on le dit, plutôt que
  // d'ouvrir une page muette avec un fragment qui ne mène nulle part.
  useEffect(() => {
    if (detailId === null || ads.some((a) => a.id === detailId)) return;
    showError("Cette annonce n'est plus disponible.");
    setDetailId(null);
  }, [detailId, ads, showError]);

  function openDetail(ad: RecruitmentAd) {
    setDetailId(ad.id);
    try {
      // URL partageable, sans entrée d'historique supplémentaire.
      window.history.replaceState(null, "", `#${recruitmentAdAnchor(ad.id)}`);
    } catch {
      // Historique indisponible : la modale s'ouvre quand même.
    }
  }

  function closeDetail() {
    setDetailId(null);
    try {
      if (parseRecruitmentAdAnchor(window.location.hash) !== null) {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    } catch {
      // Ignore : la fermeture reste effective.
    }
  }

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
      priority: ad.priority,
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
      priority: form.priority,
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

      // Rangée comme le serveur la range : à sa place si son statut n'a pas
      // changé, en fin de son groupe sinon.
      const saved = data.ad;
      setAds((prev) => placeRecruitmentAd(prev, saved));
      showSuccess(editing ? "Annonce mise à jour." : "Annonce publiée.");
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
      // Une annonce supprimée ne doit pas rester ouverte en lecture derrière.
      if (detailId === ad.id) closeDetail();
      showSuccess("Annonce supprimée.");
    } catch {
      showError("Erreur réseau, réessaye.");
    } finally {
      setBusy(false);
    }
  }

  // Déplace une annonce d'un cran (admin), **dans son statut** seulement.
  // Mise à jour optimiste avec rollback.
  async function move(index: number, direction: -1 | 1) {
    if (!canMoveRecruitmentAd(ads, index, direction)) return;
    const target = index + direction;

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
        showError(
          data.error === "RECRUITMENT_ORDER_MIXES_PRIORITIES"
            ? "Le statut d'une annonce a changé entre-temps : recharge la page pour réordonner."
            : data.error
              ? `Échec : ${data.error}`
              : "Échec du réordonnancement.",
        );
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

  // Un seul parcours de la liste pour les pôles représentés et leurs effectifs,
  // dans l'ordre canonique du registre.
  const { presentDomains, domainCounts } = useMemo(() => {
    const counts = new Map<RecruitmentDomain, number>();
    for (const ad of ads) counts.set(ad.domain, (counts.get(ad.domain) ?? 0) + 1);
    return {
      presentDomains: RECRUITMENT_DOMAINS.filter((d) => counts.has(d)),
      domainCounts: counts,
    };
  }, [ads]);
  const showFilter = ads.length >= FILTER_MIN_ADS && presentDomains.length > 1;

  // Un filtre sur un pôle vidé par une suppression laisserait une liste vide
  // sans raison visible : on retombe sur « Tous ».
  useEffect(() => {
    if (domainFilter !== ALL_DOMAINS && !presentDomains.includes(domainFilter)) {
      setDomainFilter(ALL_DOMAINS);
    }
  }, [domainFilter, presentDomains]);

  const filterActive = showFilter && domainFilter !== ALL_DOMAINS;
  const visibleAds = filterActive ? ads.filter((ad) => ad.domain === domainFilter) : ads;

  // Deux listes, jamais mêlées : prioritaires et importantes en tête, les
  // facultatives à part sous « Autres recrutements ».
  const { featured, others } = splitRecruitmentAds(visibleAds);

  function renderCard(ad: RecruitmentAd) {
    // Index dans la liste complète : le réordonnancement porte toujours
    // sur l'ordre réel, jamais sur la vue filtrée.
    const index = ads.indexOf(ad);
    const preview = buildRecruitmentPreview(ad.body);
    const canUp = canMoveRecruitmentAd(ads, index, -1);
    const canDown = canMoveRecruitmentAd(ads, index, 1);
    // Pourquoi une flèche est grisée : le filtre, ou la limite de son statut.
    const moveTitle = (can: boolean, label: string) =>
      filterActive
        ? "Retire le filtre pour réordonner"
        : can
          ? label
          : `L'ordre se règle parmi les annonces « ${RECRUITMENT_PRIORITY_LABELS[ad.priority]} »`;
    return (
      <CyberCard
        key={ad.id}
        as="article"
        lift
        className={styles.card}
        id={recruitmentAdAnchor(ad.id)}
      >
        <div className={styles.cardHead}>
          <div className={styles.cardTags}>
            <Pill variant="blue">{RECRUITMENT_DOMAIN_LABELS[ad.domain]}</Pill>
            {RECRUITMENT_PRIORITY_EXPOSURE[ad.priority].urgent && <UrgentPill />}
            {!ad.active && <Pill>Inactif</Pill>}
            {/* Le statut ne se lit publiquement que par ses effets (pastille,
                section) : la gestion, elle, a besoin de le voir nommé. */}
            {isAdmin && (
              <span
                className={`${styles.priorityBadge} ${PRIORITY_BADGE_CLASS[ad.priority]} ${ad.active ? "" : styles.priorityBadgeDraft}`}
                title={
                  ad.active
                    ? RECRUITMENT_PRIORITY_DESCRIPTIONS[ad.priority]
                    : "Annonce inactive : elle n'apparaît nulle part tant qu'elle n'est pas publiée."
                }
              >
                {RECRUITMENT_PRIORITY_LABELS[ad.priority]}
              </span>
            )}
          </div>
          {isAdmin && (
            <div className={styles.moveActions}>
              <button
                type="button"
                className={styles.move}
                onClick={() => move(index, -1)}
                disabled={busy || filterActive || !canUp}
                aria-label={`Monter l'annonce ${ad.title}`}
                title={moveTitle(canUp, "Monter")}
              >
                ↑
              </button>
              <button
                type="button"
                className={styles.move}
                onClick={() => move(index, 1)}
                disabled={busy || filterActive || !canDown}
                aria-label={`Descendre l'annonce ${ad.title}`}
                title={moveTitle(canDown, "Descendre")}
              >
                ↓
              </button>
            </div>
          )}
        </div>

        <h3 className={styles.cardTitle}>
          <button
            type="button"
            className={styles.cardTitleButton}
            onClick={() => openDetail(ad)}
            aria-haspopup="dialog"
          >
            {ad.title}
          </button>
        </h3>
        {ad.teamName && <p className={styles.cardTeam}>{ad.teamName}</p>}
        {ad.roles && <p className={styles.cardRoles}>Missions : {ad.roles}</p>}
        {preview.text && <p className={styles.cardBody}>{preview.text}</p>}
        {preview.truncated && (
          <button
            type="button"
            className={styles.readMore}
            onClick={() => openDetail(ad)}
            aria-haspopup="dialog"
          >
            Lire l&apos;annonce complète →
          </button>
        )}

        <ContactTags ad={ad} />

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
    );
  }

  const total = ads.length;
  const shown = visibleAds.length;

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
              {filterActive ? `${shown} / ${total}` : total} ANNONCE{total > 1 ? "S" : ""}
            </span>
            {isAdmin && (
              <CyberButton variant="primary" onClick={openCreate}>
                + Nouvelle annonce
              </CyberButton>
            )}
          </div>
        </header>

        {showFilter && (
          <div className={styles.filters} role="group" aria-label="Filtrer par pôle">
            <button
              type="button"
              className={`${styles.filter} ${domainFilter === ALL_DOMAINS ? styles.filterOn : ""}`}
              onClick={() => setDomainFilter(ALL_DOMAINS)}
              aria-pressed={domainFilter === ALL_DOMAINS}
            >
              Tous les pôles
            </button>
            {presentDomains.map((d) => (
              <button
                key={d}
                type="button"
                className={`${styles.filter} ${domainFilter === d ? styles.filterOn : ""}`}
                onClick={() => setDomainFilter(d)}
                aria-pressed={domainFilter === d}
              >
                {RECRUITMENT_DOMAIN_LABELS[d]}
                <span className={styles.filterCount}>{domainCounts.get(d) ?? 0}</span>
              </button>
            ))}
          </div>
        )}

        {total === 0 ? (
          <div className={styles.empty}>
            <p>Aucun poste à pourvoir dans le staff pour le moment.</p>
            {isAdmin && (
              <CyberButton variant="primary" onClick={openCreate}>
                Publier la première annonce
              </CyberButton>
            )}
          </div>
        ) : (
          <>
            {featured.length > 0 ? (
              <div className={styles.list}>{featured.map(renderCard)}</div>
            ) : (
              <p className={styles.groupEmpty}>Aucun recrutement urgent en ce moment.</p>
            )}

            {others.length > 0 && (
              <section className={styles.others} aria-labelledby="autres-recrutements">
                <header className={styles.othersHead}>
                  <h2 id="autres-recrutements" className={styles.othersTitle}>
                    Autres recrutements
                  </h2>
                  <span className={styles.meta}>
                    {others.length} ANNONCE{others.length > 1 ? "S" : ""}
                  </span>
                </header>
                <div className={styles.list}>{others.map(renderCard)}</div>
              </section>
            )}
          </>
        )}
      </section>

      {detailAd && <AdDetailModal key={detailAd.id} ad={detailAd} onClose={closeDetail} />}

      {open && (
        <LandingDialog
          onClose={close}
          busy={busy}
          className={styles.modal}
          label={editing ? "Modifier une annonce" : "Nouvelle annonce"}
        >
          <h3 className={styles.modalTitle}>
            {editing ? "Modifier l'annonce" : "Nouvelle annonce"}
          </h3>

          <label className={styles.modalField}>
            <span className={styles.modalLabel}>Titre *</span>
            <input
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
              maxLength={RECRUITMENT_BODY_MAX}
              rows={8}
              placeholder={
                "Disponibilités attendues, compétences, ambiance de l'équipe…\n\nEn quoi consiste le rôle :\n- une mission par ligne commençant par un tiret"
              }
              onChange={(e) => set("body", e.target.value)}
            />
            <span className={styles.modalHint}>
              Une ligne courte finissant par « : » devient un intertitre, une ligne commençant
              par un tiret devient une puce. Les cartes n&apos;affichent qu&apos;un aperçu :
              l&apos;annonce complète s&apos;ouvre en grand.
            </span>
            <span
              className={`${styles.counter} ${form.body.length > RECRUITMENT_BODY_MAX * 0.9 ? styles.counterWarn : ""}`}
            >
              {form.body.length} / {RECRUITMENT_BODY_MAX}
            </span>
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
            <span className={styles.modalLabel}>Statut d&apos;importance</span>
            <select
              className={styles.modalInput}
              value={form.priority}
              onChange={(e) => set("priority", e.target.value as RecruitmentPriority)}
            >
              {RECRUITMENT_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {RECRUITMENT_PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
            <span className={styles.modalHint}>{RECRUITMENT_PRIORITY_DESCRIPTIONS[form.priority]}</span>
            {editing && editing.priority !== form.priority && (
              <span className={styles.modalHint}>
                En changeant de statut, l&apos;annonce passera en fin de son nouveau groupe.
              </span>
            )}
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
        </LandingDialog>
      )}
    </>
  );
}
