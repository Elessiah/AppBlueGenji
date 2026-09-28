"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { CyberButton } from "@/components/cyber";
import { useToast } from "@/components/ui/toast";
import {
  type Sponsor,
  type SponsorTier,
  FALLBACK_SPONSORS,
  SPONSOR_DESCRIPTION_MAX,
  SPONSOR_TIERS,
  SPONSOR_TIER_LABELS,
} from "@/lib/shared/sponsors";
import {
  sponsorCardMedia,
  sponsorInitial,
  sponsorWebsiteHref,
  sponsorWebsiteLabel,
} from "@/lib/shared/sponsor-card";
import type { SiteCopy } from "@/lib/shared/site-copy";
import { toServedUploadUrl } from "@/lib/shared/uploads";
import { EditableCopy } from "./EditableCopy";
import { LandingDialog } from "./LandingDialog";
import styles from "./SponsorsGrid.module.css";

type SponsorsGridProps = {
  sponsors: Sponsor[];
  /** Textes éditables de la vitrine (introduction de la section). */
  copy: SiteCopy;
  isAdmin?: boolean;
};

interface FormState {
  name: string;
  tier: SponsorTier;
  websiteUrl: string;
  logoUrl: string;
  bannerUrl: string;
  description: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  tier: "PARTNER",
  websiteUrl: "",
  logoUrl: "",
  bannerUrl: "",
  description: "",
};

/** Traduction des refus de l'API partenaires, affichée en notification. */
function sponsorErrorMessage(code: string | undefined, fallback: string): string {
  switch (code) {
    case undefined:
    case "":
      return fallback;
    case "NAME_REQUIRED":
      return "Le nom est requis.";
    case "NAME_TOO_LONG":
      return "Nom trop long (120 caractères maximum).";
    case "DESCRIPTION_TOO_LONG":
      return `Description trop longue (${SPONSOR_DESCRIPTION_MAX} caractères maximum).`;
    case "INVALID_BANNER_URL":
      return "Le bandeau doit être un fichier importé.";
    default:
      return `Échec : ${code}`;
  }
}

const ACCEPTED_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_LOGO_BYTES = 5 * 1024 * 1024;

// Tri par palier (GOLD → PARTNER), comme côté serveur. `sort` est stable :
// l'ordre relatif au sein d'un même palier est préservé (un nouvel élément
// ajouté en fin reste donc en fin de son palier, cohérent avec display_order).
function sortByTier(list: Sponsor[]): Sponsor[] {
  return [...list].sort((a, b) => SPONSOR_TIERS.indexOf(a.tier) - SPONSOR_TIERS.indexOf(b.tier));
}

export function SponsorsGrid({ sponsors, copy, isAdmin = false }: SponsorsGridProps) {
  const { showError, showSuccess } = useToast();
  const [items, setItems] = useState<Sponsor[]>(sponsors);
  const [editing, setEditing] = useState<Sponsor | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [bannerBusy, setBannerBusy] = useState(false);
  const logoFileRef = useRef<HTMLInputElement>(null);
  const bannerFileRef = useRef<HTMLInputElement>(null);
  const uploading = logoBusy || bannerBusy;

  // Les sponsors de secours (id négatif) ne sont pas en base : non modifiables.
  const canManage = (s: Sponsor) => isAdmin && s.id > 0;
  // Vitrine publique limitée à 6 ; les admins voient/ gèrent l'ensemble.
  const displaySponsors = isAdmin ? items : items.slice(0, 6);

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
      bannerUrl: sponsor.bannerUrl ?? "",
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
      bannerUrl: form.bannerUrl.trim() || null,
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
        showError(sponsorErrorMessage(data.error, "Échec de l'enregistrement."));
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

  // Le tri d'affichage regroupe d'abord par palier : un déplacement n'a de sens
  // qu'entre voisins d'un même palier. Ces gardes désactivent les flèches sinon.
  const canMoveUp = (index: number) =>
    index > 0 && items[index - 1].tier === items[index].tier;
  const canMoveDown = (index: number) =>
    index < items.length - 1 && items[index + 1].tier === items[index].tier;

  // Déplace un partenaire d'un cran au sein de son palier et persiste l'ordre.
  // Mise à jour optimiste avec rollback en cas d'échec.
  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    if (items[target].tier !== items[index].tier) return;

    const previous = items;
    const reordered = [...items];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setItems(reordered);

    setBusy(true);
    try {
      const res = await fetch("/api/landing/sponsors/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: reordered.map((s) => s.id) }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        showError(data.error ? `Échec : ${data.error}` : "Échec du réordonnancement.");
        setItems(previous);
        return;
      }
      showSuccess("Ordre des partenaires mis à jour.");
    } catch {
      showError("Erreur réseau, réessaye.");
      setItems(previous);
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

  // Logo et bandeau suivent le même chemin : contrôle local (le serveur refait
  // les mêmes vérifications), envoi, puis l'URL rendue entre dans le formulaire
  // — rien n'est enregistré sur le partenaire avant « Enregistrer ».
  async function uploadImage(
    event: React.ChangeEvent<HTMLInputElement>,
    kind: "logo" | "banner",
  ) {
    const file = event.target.files?.[0];
    // Réinitialise pour permettre de re-sélectionner le même fichier ensuite.
    event.target.value = "";
    if (!file) return;
    if (!ACCEPTED_LOGO_TYPES.includes(file.type)) {
      showError("Format invalide : PNG, JPEG ou WebP uniquement.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      showError("Image trop lourde (5 Mo maximum).");
      return;
    }

    const setUploading = kind === "logo" ? setLogoBusy : setBannerBusy;
    const label = kind === "logo" ? "du logo" : "du bandeau";
    setUploading(true);
    try {
      const data = new FormData();
      data.append("file", file);
      const res = await fetch(`/api/landing/sponsors/${kind}`, { method: "POST", body: data });
      const payload = (await res.json()) as { logoUrl?: string; bannerUrl?: string; error?: string };
      const url = kind === "logo" ? payload.logoUrl : payload.bannerUrl;
      if (!res.ok || !url) {
        showError(payload.error ? `Échec : ${payload.error}` : `Échec de l'envoi ${label}.`);
        return;
      }
      setForm((f) => (kind === "logo" ? { ...f, logoUrl: url } : { ...f, bannerUrl: url }));
      showSuccess(kind === "logo" ? "Logo importé." : "Bandeau importé.");
    } catch {
      showError("Erreur réseau, réessaye.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <section id="sponsors" className={styles.root}>
      <div className={styles.head}>
        <div className={styles.headText}>
          <h2 className={styles.sectionTitle}>Partenaires et soutiens</h2>
          <EditableCopy copyKey="home.sponsors.lede" value={copy["home.sponsors.lede"]} canEdit={isAdmin}>
            <p className={styles.lede}>{copy["home.sponsors.lede"]}</p>
          </EditableCopy>
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

      <ul className={styles.grid}>
        {displaySponsors.map((sponsor, index) => {
          // Toujours des adresses du site — chemin d'upload pour un fichier
          // importé, relais pour un logo collé par le staff (`sponsor-logo.ts`,
          // `sponsor-card.ts`) — donc des images que `next/image` sait
          // redimensionner et convertir.
          const media = sponsorCardMedia(sponsor);
          const href = sponsorWebsiteHref(sponsor.websiteUrl);
          const domain = sponsorWebsiteLabel(sponsor.websiteUrl);
          return (
            <li key={sponsor.id} className={styles.slotWrap}>
              <article className={styles.card}>
                <div className={styles.media}>
                  {media.layout === "BANNER" && media.bannerSrc ? (
                    <Image
                      src={media.bannerSrc}
                      alt=""
                      fill
                      // Grille à 3 colonnes dans un conteneur de 1240 px au plus,
                      // 2 colonnes sous 900 px, une seule sous 560 px
                      // (cf. SponsorsGrid.module.css).
                      sizes="(max-width: 560px) 100vw, (max-width: 900px) 50vw, 400px"
                      className={styles.banner}
                    />
                  ) : (
                    <svg className={styles.pattern} viewBox="0 0 300 100" preserveAspectRatio="none" aria-hidden="true">
                      <defs>
                        <pattern id={`hatch-${sponsor.slug}`} width="10" height="10" patternUnits="userSpaceOnUse">
                          <path d="M-1 1 l2 -2 M0 10 l10 -10 M8 12 l4 -4" stroke="rgba(180,210,230,0.12)" strokeWidth="1" />
                        </pattern>
                      </defs>
                      <rect width="300" height="100" fill={`url(#hatch-${sponsor.slug})`} />
                    </svg>
                  )}

                  {media.layout === "LOGO" && media.logoSrc && (
                    <div className={styles.logoFrame}>
                      <Image
                        src={media.logoSrc}
                        // Le nom est écrit juste en dessous : le logo le répète.
                        alt=""
                        fill
                        sizes="(max-width: 560px) 80vw, (max-width: 900px) 40vw, 320px"
                        className={styles.logo}
                      />
                    </div>
                  )}

                  {media.layout === "PLACEHOLDER" && (
                    <span className={styles.initial} aria-hidden="true">
                      {sponsorInitial(sponsor.name)}
                    </span>
                  )}

                  {media.layout === "BANNER" && media.logoSrc && (
                    <div className={styles.emblem}>
                      <Image src={media.logoSrc} alt="" fill sizes="64px" className={styles.logo} />
                    </div>
                  )}

                  <span className={styles.tier}>{SPONSOR_TIER_LABELS[sponsor.tier]}</span>
                </div>

                <div className={styles.body}>
                  <h3 className={styles.name}>
                    {href ? (
                      // Lien étiré sur toute la carte (`::after`) : son nom
                      // accessible *est* le nom affiché (WCAG 2.5.3).
                      <a href={href} target="_blank" rel="noreferrer" className={styles.nameLink}>
                        {sponsor.name}
                        <span className="sr-only"> — site du partenaire (nouvel onglet)</span>
                      </a>
                    ) : (
                      sponsor.name
                    )}
                  </h3>
                  {sponsor.description && <p className={styles.description}>{sponsor.description}</p>}
                  {domain && (
                    <span className={styles.domain} aria-hidden="true">
                      {domain} ↗
                    </span>
                  )}
                </div>
              </article>
              {canManage(sponsor) && (
                <div className={styles.slotActions} data-tap-zone>
                  <button
                    type="button"
                    className={`${styles.slotAction} ${styles.moveAction}`}
                    onClick={() => move(index, -1)}
                    disabled={busy || !canMoveUp(index)}
                    aria-label={`Déplacer ${sponsor.name} vers le haut`}
                    title="Monter"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={`${styles.slotAction} ${styles.moveAction}`}
                    onClick={() => move(index, 1)}
                    disabled={busy || !canMoveDown(index)}
                    aria-label={`Déplacer ${sponsor.name} vers le bas`}
                    title="Descendre"
                  >
                    ↓
                  </button>
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
            </li>
          );
        })}
      </ul>

      {open && (
        <LandingDialog
          onClose={close}
          busy={busy}
          className={styles.modal}
          label={editing ? "Modifier un partenaire" : "Ajouter un partenaire"}
        >
          <h3 className={styles.modalTitle}>{editing ? "Modifier le partenaire" : "Ajouter un partenaire"}</h3>

          <label className={styles.modalField}>
            <span className={styles.modalLabel}>Nom</span>
            <input
              className={styles.modalInput}
              value={form.name}
              maxLength={120}
              placeholder="LOGITECH G"
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>

          <label className={styles.modalField}>
            <span className={styles.modalLabel}>Brève description (optionnel)</span>
            <textarea
              className={`${styles.modalInput} ${styles.modalTextarea}`}
              value={form.description}
              maxLength={SPONSOR_DESCRIPTION_MAX}
              rows={3}
              placeholder="Boutique de jeux vidéo à prix réduits, partenaire de nos cash prizes."
              aria-describedby="sponsor-description-hint"
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
            <span id="sponsor-description-hint" className={styles.logoHint}>
              Une ou deux phrases : qui est ce partenaire, et ce qu&apos;il apporte. {form.description.length} /{" "}
              {SPONSOR_DESCRIPTION_MAX}
            </span>
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

          <div className={styles.modalField}>
            <span className={styles.modalLabel}>Bandeau (optionnel)</span>
            <div className={styles.logoUpload}>
              {form.bannerUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={toServedUploadUrl(form.bannerUrl)} alt="Aperçu du bandeau" className={styles.bannerPreview} />
              ) : (
                <div className={`${styles.logoPreviewEmpty} ${styles.bannerPreviewEmpty}`} aria-hidden="true">
                  1200 × 400
                </div>
              )}
              <div className={styles.logoUploadActions}>
                <input
                  ref={bannerFileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className={styles.logoFileInput}
                  onChange={(e) => uploadImage(e, "banner")}
                />
                <button
                  type="button"
                  className={styles.logoUploadBtn}
                  onClick={() => bannerFileRef.current?.click()}
                  disabled={uploading || busy}
                >
                  {bannerBusy ? "Envoi…" : form.bannerUrl ? "Changer le fichier" : "Importer un fichier"}
                </button>
                {form.bannerUrl && (
                  <button
                    type="button"
                    className={`${styles.logoUploadBtn} ${styles.logoUploadBtnDanger}`}
                    onClick={() => setForm((f) => ({ ...f, bannerUrl: "" }))}
                    disabled={uploading || busy}
                  >
                    Retirer
                  </button>
                )}
              </div>
            </div>
            <span className={styles.logoHint}>
              Image large en fond de carte, recadrée au centre en 1200 × 400 px (ratio 3:1). PNG, JPEG ou WebP, 5 Mo max.
            </span>
          </div>

          <div className={styles.modalField}>
            <span className={styles.modalLabel}>Logo (optionnel)</span>
            <div className={styles.logoUpload}>
              {form.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={toServedUploadUrl(form.logoUrl)} alt="Aperçu du logo" className={styles.logoPreview} />
              ) : (
                <div className={styles.logoPreviewEmpty} aria-hidden="true">
                  LOGO
                </div>
              )}
              <div className={styles.logoUploadActions}>
                <input
                  ref={logoFileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className={styles.logoFileInput}
                  onChange={(e) => uploadImage(e, "logo")}
                />
                <button
                  type="button"
                  className={styles.logoUploadBtn}
                  onClick={() => logoFileRef.current?.click()}
                  disabled={uploading || busy}
                >
                  {logoBusy ? "Envoi…" : form.logoUrl ? "Changer le fichier" : "Importer un fichier"}
                </button>
                {form.logoUrl && (
                  <button
                    type="button"
                    className={`${styles.logoUploadBtn} ${styles.logoUploadBtnDanger}`}
                    onClick={() => setForm((f) => ({ ...f, logoUrl: "" }))}
                    disabled={uploading || busy}
                  >
                    Retirer
                  </button>
                )}
              </div>
            </div>
            <span className={styles.logoHint}>
              PNG ou WebP à fond transparent, carré ou horizontal, 5 Mo max. Affiché entier sans bandeau, en pastille
              sur le bandeau sinon.
            </span>
            <input
              className={styles.modalInput}
              value={form.logoUrl}
              maxLength={2048}
              placeholder="… ou colle une URL https://exemple.com/logo.png"
              aria-label="URL du logo"
              onChange={(e) => setForm((f) => ({ ...f, logoUrl: e.target.value }))}
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
        </LandingDialog>
      )}
    </section>
  );
}
