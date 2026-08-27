"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CyberButton, CyberCard, Pill } from "@/components/cyber";
import { ContactTags } from "@/components/recruitment/ContactTags";
import { useToast } from "@/components/ui/toast";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import {
  type RecruiterContactDefaults,
  type RecruitmentAd,
  type RecruitmentContactChannel,
  type RecruitmentDomain,
  type RecruitmentHighlight,
  type RecruitmentHighlightState,
  buildRecruitmentPreview,
  parseRecruitmentAdAnchor,
  recruitmentAdAnchor,
  resolveHighlightStates,
  RECRUITMENT_BODY_MAX,
  RECRUITMENT_CONTACT_CHANNELS,
  RECRUITMENT_CONTACT_CHANNEL_LABELS,
  RECRUITMENT_DISCORD_MAX,
  RECRUITMENT_DOMAINS,
  RECRUITMENT_DOMAIN_LABELS,
  RECRUITMENT_HIGHLIGHTS,
  RECRUITMENT_HIGHLIGHT_LABELS,
  RECRUITMENT_HIGHLIGHT_SHORT_LABELS,
  selectHighlightedAd,
} from "@/lib/shared/recruitment";
import { AdDetailModal } from "./AdDetailModal";
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

/** Filtre « tous les pôles » — valeur sentinelle hors de `RecruitmentDomain`. */
const ALL_DOMAINS = "ALL" as const;
type DomainFilter = RecruitmentDomain | typeof ALL_DOMAINS;

/**
 * En deçà de ce nombre d'annonces, le filtre par pôle n'apporte rien : il
 * encombrerait l'en-tête pour trier deux cartes déjà visibles d'un coup d'œil.
 */
const FILTER_MIN_ADS = 3;

/** Table d'états vide, réutilisée pour les visiteurs (aucun badge à rendre). */
const EMPTY_HIGHLIGHT_STATES: ReadonlyMap<number, RecruitmentHighlightState> = new Map();

/**
 * Suffixe du badge de mise en avant, côté gestion. `NONE` n'est jamais rendu
 * (le badge n'apparaît pas), mais la table reste exhaustive pour rester juste
 * si un état s'ajoute.
 */
const HIGHLIGHT_STATE_SUFFIX: Record<RecruitmentHighlightState, string> = {
  NONE: "",
  LIVE: " en ligne",
  QUEUED: " en attente",
  DRAFT: " (brouillon)",
};

const HIGHLIGHT_STATE_HINTS: Record<RecruitmentHighlightState, (winner?: string) => string> = {
  NONE: () => "",
  LIVE: () => "Mise en avant actuellement affichée sur tout le site.",
  QUEUED: (winner) =>
    `Sans effet pour l'instant : « ${winner ?? "une autre annonce"} » occupe la mise en avant. Une seule annonce est affichée à la fois — remonte celle-ci au-dessus pour la faire passer.`,
  DRAFT: () => "Annonce inactive : aucune mise en avant tant qu'elle n'est pas publiée.",
};

export function RecruitmentSection({ initialAds, isAdmin, contactDefaults }: RecruitmentSectionProps) {
  const { showError, showSuccess } = useToast();
  const [ads, setAds] = useState<RecruitmentAd[]>(initialAds);
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

  // Comportement modal du formulaire de gestion : Échap, piège à focus,
  // arrière-plan figé. Le focus initial tombe sur le champ « Titre », premier
  // élément focalisable de la modale.
  const formRef = useDialogBehavior({ open, onClose: close, locked: busy });

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
      // Une annonce supprimée ne doit pas rester ouverte en lecture derrière.
      if (detailId === ad.id) closeDetail();
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

  // Une seule mise en avant est servie à la fois (la plus haute active). On dit
  // au staff laquelle est réellement en ligne, plutôt que de le laisser croire
  // que ses trois « modales à l'arrivée » s'affichent toutes. Les badges et
  // l'avertissement du formulaire étant réservés à la gestion, rien n'est
  // calculé pour un visiteur ordinaire.
  const { highlightStates, highlightedAd } = useMemo(
    () =>
      isAdmin
        ? { highlightStates: resolveHighlightStates(ads), highlightedAd: selectHighlightedAd(ads) }
        : { highlightStates: EMPTY_HIGHLIGHT_STATES, highlightedAd: null },
    [ads, isAdmin],
  );
  // Annonce qui « prend la place » de celle en cours d'édition, le cas échéant.
  const conflictingAd =
    form.highlight !== "NONE" && form.active && highlightedAd && highlightedAd.id !== editing?.id
      ? highlightedAd
      : null;

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
          <div className={styles.list}>
            {visibleAds.map((ad) => {
              // Index dans la liste complète : le réordonnancement porte toujours
              // sur l'ordre réel, jamais sur la vue filtrée.
              const index = ads.indexOf(ad);
              const preview = buildRecruitmentPreview(ad.body);
              const highlightState = highlightStates.get(ad.id) ?? "NONE";
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
                      {ad.highlight !== "NONE" && <Pill variant="live">Urgent</Pill>}
                      {!ad.active && <Pill>Inactif</Pill>}
                      {isAdmin && highlightState !== "NONE" && (
                        <span
                          className={`${styles.highlightBadge} ${highlightState === "LIVE" ? "" : styles.highlightBadgeOff}`}
                          title={HIGHLIGHT_STATE_HINTS[highlightState](highlightedAd?.title)}
                        >
                          {RECRUITMENT_HIGHLIGHT_SHORT_LABELS[ad.highlight]}
                          {HIGHLIGHT_STATE_SUFFIX[highlightState]}
                        </span>
                      )}
                    </div>
                    {isAdmin && (
                      <div className={styles.moveActions}>
                        <button
                          type="button"
                          className={styles.move}
                          onClick={() => move(index, -1)}
                          disabled={busy || filterActive || index === 0}
                          aria-label={`Monter l'annonce ${ad.title}`}
                          title={filterActive ? "Retire le filtre pour réordonner" : "Monter"}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className={styles.move}
                          onClick={() => move(index, 1)}
                          disabled={busy || filterActive || index === ads.length - 1}
                          aria-label={`Descendre l'annonce ${ad.title}`}
                          title={filterActive ? "Retire le filtre pour réordonner" : "Descendre"}
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
            })}
          </div>
        )}
      </section>

      {detailAd && <AdDetailModal key={detailAd.id} ad={detailAd} onClose={closeDetail} />}

      {open && (
        <div className={styles.modalOverlay} onClick={close} role="presentation">
          <div
            ref={formRef}
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-busy={busy}
            aria-label={editing ? "Modifier une annonce" : "Nouvelle annonce"}
            tabIndex={-1}
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
              {conflictingAd && (
                <span className={styles.modalWarn} role="status">
                  « {conflictingAd.title} » occupe déjà la mise en avant. Celle-ci restera en
                  attente tant qu&apos;elle n&apos;aura pas été remontée au-dessus.
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
          </div>
        </div>
      )}
    </>
  );
}
