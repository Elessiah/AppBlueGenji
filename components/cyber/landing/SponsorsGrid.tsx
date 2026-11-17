"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { CyberButton } from "@/components/cyber";
import { BusyButton } from "@/components/ui/busy-button";
import { BusyLabel } from "@/components/ui/busy-label";
import { BilingualField, EnglishMissingMark, withEnglishMissing } from "@/components/ui/bilingual-field";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { FieldErrorText } from "@/components/ui/field-error-text";
import { useToast } from "@/components/ui/toast";
import { appendCroppedImage, useImageCropper, preloadImageCropDialog } from "@/components/ui/image-crop-dialog";
import {
  type Sponsor,
  type SponsorTier,
  FALLBACK_SPONSORS,
  SPONSOR_DESCRIPTION_MAX,
  SPONSOR_FIELD_ERRORS,
  SPONSOR_TIERS,
  SPONSOR_TIER_LABELS,
  sponsorDescription,
  sponsorEnglishMissing,
  validateSponsorInput,
} from "@/lib/shared/sponsors";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { useArrowRefocus } from "@/lib/shared/hooks/useArrowRefocus";
import { useBusyGuard } from "@/lib/shared/hooks/useBusyGuard";
import { arrowKey } from "@/lib/shared/arrow-refocus";
import { withRequestKey, type KeyedBody } from "@/lib/shared/request-key";
import { englishErrorMessage } from "@/lib/shared/staff-translation";
import {
  sponsorCardMedia,
  sponsorInitial,
  sponsorWebsiteHref,
  sponsorWebsiteLabel,
} from "@/lib/shared/sponsor-card";
import type { SiteCopy } from "@/lib/shared/site-copy";
import { toServedUploadUrl } from "@/lib/shared/uploads";
import { EditableCopy } from "./EditableCopy";
import { useLandingText } from "@/components/i18n/landing-text";
import { LandingDialog } from "./LandingDialog";
import { BUSY_REFUSED_MESSAGE } from "@/lib/shared/busy-refused-message";
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
  descriptionEn: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  tier: "PARTNER",
  websiteUrl: "",
  logoUrl: "",
  bannerUrl: "",
  description: "",
  descriptionEn: "",
};

/** `id` des champs de la description, cibles de `useFieldErrors`. */
const DESCRIPTION_FIELD_IDS = {
  description: "sponsor-description",
  descriptionEn: "sponsor-description-en",
  websiteUrl: "sponsor-website-url",
} as const;

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
    case "INVALID_WEBSITE_URL":
      return "Le site web doit être une adresse http(s):// complète, hors route d'API du site.";
    case "INVALID_LOGO_URL":
      return "Ce logo est une image d'une autre partie du site : importe-le ou colle une adresse externe.";
    default:
      return englishErrorMessage(code) ?? `Échec : ${code}`;
  }
}

const ACCEPTED_LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_LOGO_BYTES = 5 * 1024 * 1024;

// Tri par palier (GOLD → PARTNER), comme côté serveur. `sort` est stable :
// l'ordre relatif au sein d'un même palier est préservé (un nouvel élément
// ajouté en fin reste donc en fin de son palier, cohérent avec display_order).
function sortByTier(list: Sponsor[]): Sponsor[] {
  return [...list].sort((a, b) => SPONSOR_TIERS.indexOf(a.tier) - SPONSOR_TIERS.indexOf(b.tier));
}

export function SponsorsGrid({ sponsors, copy, isAdmin = false }: Readonly<SponsorsGridProps>) {
  const { t, locale } = useLandingText();
  // L'administration reste en français (D4) : sous `/en`, ses contrôles le
  // disent (`lang="fr"`). La description d'un partenaire s'y lit en anglais ;
  // sans anglais (saisie avant le lot 5b), elle n'est pas rendue — le
  // partenaire, lui, reste (`sponsorDescription`).
  const staffLang = locale === "fr" ? undefined : "fr";
  // Ses notifications sont du français d'administration, lues comme tel sous `/en`.
  const toast = useToast();
  const staffToast = staffLang ? { lang: staffLang } : undefined;
  const showError = (message: string) => toast.showError(message, staffToast);
  const showSuccess = (message: string) => toast.showSuccess(message, staffToast);
  const showInfo = (message: string) => toast.showInfo(message, staffToast);
  const fieldErrors = useFieldErrors(SPONSOR_FIELD_ERRORS, DESCRIPTION_FIELD_IDS);
  // Modale portée dans body : sous `/en`, elle dit elle-même sa langue (D4).
  const { cropImage, cropDialog } = useImageCropper({ lang: staffLang });
  const [items, setItems] = useState<Sponsor[]>(sponsors);
  const [editing, setEditing] = useState<Sponsor | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [open, setOpen] = useState(false);
  // Un envoi à la fois pour la section — enregistrer, déplacer, supprimer,
  // importer une image : garde synchrone, boutons focalisables pendant
  // l'attente (`BUSY_BUTTONS.md`). L'import partage la garde : « Enregistrer »
  // pressé pendant l'envoi d'un logo partait sans lui, puis le logo importé
  // arrivait dans un formulaire déjà fermé, perdu.
  const { busy, isBusy, run } = useBusyGuard();
  // Image en cours d'envoi : son bouton dit « Envoi… ».
  const [uploadKind, setUploadKind] = useState<"logo" | "banner" | null>(null);
  const refocusArrow = useArrowRefocus("sponsor");
  // Clé de l'ajout, oubliée à chaque ouverture : un renvoi du même formulaire
  // (réponse perdue) rend le partenaire déjà créé au lieu d'en ajouter un
  // second ; un formulaire corrigé entre-temps tire une clé neuve
  // (`keyForBody`, `lib/server/idempotency.ts`).
  const createKey = useRef<KeyedBody | null>(null);
  const logoFileRef = useRef<HTMLInputElement>(null);
  const bannerFileRef = useRef<HTMLInputElement>(null);

  // Les sponsors de secours (id négatif) ne sont pas en base : non modifiables.
  const canManage = (s: Sponsor) => isAdmin && s.id > 0;
  // Vitrine publique limitée à 6 ; les admins voient/ gèrent l'ensemble.
  const displaySponsors = isAdmin ? items : items.slice(0, 6);

  function openCreate() {
    if (isBusy()) return;
    createKey.current = null;
    fieldErrors.clear();
    setEditing(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  }

  function openEdit(sponsor: Sponsor) {
    if (isBusy()) return;
    fieldErrors.clear();
    setEditing(sponsor);
    setForm({
      name: sponsor.name,
      tier: sponsor.tier,
      websiteUrl: sponsor.websiteUrl ?? "",
      logoUrl: sponsor.logoUrl ?? "",
      bannerUrl: sponsor.bannerUrl ?? "",
      description: sponsor.description ?? "",
      descriptionEn: sponsor.descriptionEn ?? "",
    });
    setOpen(true);
  }

  function closeDialog() {
    setOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  function close() {
    if (!isBusy()) closeDialog();
  }

  // Champ modifié pendant un envoi : ignoré (ce qui est affiché est ce qui part).
  const edit = (change: (f: FormState) => FormState) => {
    if (!isBusy()) setForm(change);
  };

  // Un refus désigne son champ quand il le peut (description, son anglais) :
  // rattaché à lui, focus ramené, et la même phrase en notification.
  function refuse(code: string | undefined, fallback: string) {
    const message = sponsorErrorMessage(code, fallback);
    fieldErrors.report(code, message);
    showError(message);
  }

  async function submit() {
    if (isBusy()) return;
    if (!form.name.trim()) {
      showError("Le nom est requis.");
      return;
    }

    const payload = {
      name: form.name.trim(),
      tier: form.tier,
      websiteUrl: form.websiteUrl.trim() || null,
      logoUrl: form.logoUrl.trim() || null,
      bannerUrl: form.bannerUrl.trim() || null,
      description: form.description.trim() || null,
      descriptionEn: form.descriptionEn.trim() || null,
    };
    // Même validation que le serveur, avant l'envoi : une description saisie
    // demande son anglais (D9), désigné sans aller-retour.
    const check = validateSponsorInput(payload);
    if (!check.ok) {
      refuse(check.error, "Formulaire invalide.");
      return;
    }

    await run(async () => {
      try {
        const url = editing ? `/api/landing/sponsors/${editing.id}` : "/api/landing/sponsors";
        const res = await fetch(url, {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editing ? payload : withRequestKey(createKey, payload)),
        });
        const data = (await res.json()) as { sponsor?: Sponsor; error?: string };
        if (!res.ok || !data.sponsor) {
          refuse(data.error, "Échec de l'enregistrement.");
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
        closeDialog();
      } catch {
        showError("Erreur réseau, réessaye.");
      }
    });
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

    await run(async () => {
      const previous = items;
      const reordered = [...items];
      [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
      const id = items[index].id;
      const arrow = direction < 0 ? "up" : "down";
      setItems(reordered);
      refocusArrow(id, arrow);
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
          refocusArrow(id, arrow);
          return;
        }
        showSuccess("Ordre des partenaires mis à jour.");
      } catch {
        showError("Erreur réseau, réessaye.");
        setItems(previous);
        refocusArrow(id, arrow);
      }
    });
  }

  const [pendingRemoval, setPendingRemoval] = useState<Sponsor | null>(null);

  async function remove(sponsor: Sponsor): Promise<boolean> {
    const done = await run(async () => {
      try {
        const res = await fetch(`/api/landing/sponsors/${sponsor.id}`, { method: "DELETE" });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          showError(data.error ? `Échec : ${data.error}` : "Échec de la suppression.");
          return false;
        }
        // Si plus aucun sponsor réel, réafficher la vitrine de secours — c'est ce
        // que renverrait un rechargement (table vide → FALLBACK_SPONSORS).
        setItems((prev) => {
          const next = prev.filter((s) => s.id !== sponsor.id);
          return next.length === 0 ? FALLBACK_SPONSORS : next;
        });
        showSuccess("Partenaire supprimé.");
        return true;
      } catch {
        showError("Erreur réseau, réessaye.");
        return false;
      }
    });
    if (done === undefined) showInfo(BUSY_REFUSED_MESSAGE);
    return done ?? false;
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
    if (!file || isBusy()) return;
    if (!ACCEPTED_LOGO_TYPES.has(file.type)) {
      showError("Format invalide : PNG, JPEG ou WebP uniquement.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      showError("Image trop lourde (5 Mo maximum).");
      return;
    }

    const image = await cropImage(
      file,
      kind === "logo" ? "sponsor-logo" : "sponsor-banner",
      kind === "logo" ? "Recadrer le logo" : "Recadrer le bandeau",
    );
    if (!image) return;

    const label = kind === "logo" ? "du logo" : "du bandeau";
    const started = await run(async () => {
      setUploadKind(kind);
      try {
        const data = new FormData();
        appendCroppedImage(data, image);
        const res = await fetch(`/api/landing/sponsors/${kind}`, { method: "POST", body: data });
        const payload = (await res.json()) as { logoUrl?: string; bannerUrl?: string; error?: string };
        const url = kind === "logo" ? payload.logoUrl : payload.bannerUrl;
        if (!res.ok || !url) {
          showError(payload.error ? `Échec : ${payload.error}` : `Échec de l'envoi ${label}.`);
          return true;
        }
        setForm((f) => (kind === "logo" ? { ...f, logoUrl: url } : { ...f, bannerUrl: url }));
        showSuccess(kind === "logo" ? "Logo importé." : "Bandeau importé.");
      } catch {
        showError("Erreur réseau, réessaye.");
      } finally {
        setUploadKind(null);
      }
      return true;
    });
    // Un autre envoi a pris la section pendant le recadrage : l'image n'est pas
    // partie, on le dit plutôt que de laisser croire qu'elle est importée.
    if (!started) showInfo("Image non importée : un autre envoi était en cours, réessaye.");
  }

  const submitLabel = editing ? "Enregistrer" : "Ajouter";
  const pendingLabel = editing ? "Enregistrement…" : "Ajout…";
  const bannerFileLabel = form.bannerUrl ? "Changer le fichier" : "Importer un fichier";
  const logoFileLabel = form.logoUrl ? "Changer le fichier" : "Importer un fichier";

  return (
    <section id="sponsors" className={styles.root}>
      {cropDialog}
      <div className={styles.head}>
        <div className={styles.headText}>
          <h2 className={styles.sectionTitle}>{t("sponsors.title")}</h2>
          <EditableCopy copyKey="home.sponsors.lede" value={copy["home.sponsors.lede"]} canEdit={isAdmin}>
            <p className={styles.lede}>{copy["home.sponsors.lede"]}</p>
          </EditableCopy>
        </div>
        <div className={styles.headActions}>
          <span className={styles.meta}>{t("sponsors.count", { count: displaySponsors.length })}</span>
          {isAdmin && (
            <CyberButton variant="primary" asChild>
              {/* Bloqué pendant un déplacement ou une suppression : il le dit
                  (`aria-disabled`, `aria-busy`) au lieu d'ignorer le clic. */}
              <BusyButton busy={busy} onClick={openCreate} lang={staffLang}>
                + Ajouter
              </BusyButton>
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
          const description = sponsorDescription(sponsor, locale);
          const enMissing = sponsorEnglishMissing(sponsor);
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

                  <span className={styles.tier}>{t(`sponsors.tier.${sponsor.tier}`)}</span>
                </div>

                <div className={styles.body}>
                  <h3 className={styles.name}>
                    {href ? (
                      // Lien étiré sur toute la carte (`::after`) : son nom
                      // accessible *est* le nom affiché (WCAG 2.5.3).
                      <a href={href} target="_blank" rel="noreferrer" className={styles.nameLink}>
                        {sponsor.name}
                        <span className="sr-only">{` ${t("sponsors.websiteSuffix")}`}</span>
                      </a>
                    ) : (
                      sponsor.name
                    )}
                  </h3>
                  {description && <p className={styles.description}>{description}</p>}
                  {domain && (
                    <span className={styles.domain} aria-hidden="true">
                      {domain} ↗
                    </span>
                  )}
                </div>
              </article>
              {canManage(sponsor) && (
                <div className={styles.slotActions} data-tap-zone lang={staffLang}>
                  <BusyButton
                    busy={busy}
                    blocked={!canMoveUp(index)}
                    className={`${styles.slotAction} ${styles.moveAction}`}
                    onClick={() => void move(index, -1)}
                    data-arrow={arrowKey("sponsor", sponsor.id, "up")}
                    data-edge={!canMoveUp(index) || undefined}
                    aria-label={`Déplacer ${sponsor.name} vers le haut`}
                    title="Monter"
                  >
                    ↑
                  </BusyButton>
                  <BusyButton
                    busy={busy}
                    blocked={!canMoveDown(index)}
                    className={`${styles.slotAction} ${styles.moveAction}`}
                    onClick={() => void move(index, 1)}
                    data-arrow={arrowKey("sponsor", sponsor.id, "down")}
                    data-edge={!canMoveDown(index) || undefined}
                    aria-label={`Déplacer ${sponsor.name} vers le bas`}
                    title="Descendre"
                  >
                    ↓
                  </BusyButton>
                  <BusyButton
                    busy={busy}
                    className={styles.slotAction}
                    onClick={() => openEdit(sponsor)}
                    aria-label={withEnglishMissing(`Modifier ${sponsor.name}`, enMissing)}
                  >
                    Modifier
                    {enMissing && <EnglishMissingMark />}
                  </BusyButton>
                  <BusyButton
                    busy={busy}
                    className={`${styles.slotAction} ${styles.slotActionDanger}`}
                    onClick={() => {
                      if (!isBusy()) setPendingRemoval(sponsor);
                    }}
                    aria-label={`Supprimer ${sponsor.name}`}
                  >
                    Supprimer
                  </BusyButton>
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
          lang={staffLang}
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
              readOnly={busy}
              onChange={(e) => edit((f) => ({ ...f, name: e.target.value }))}
            />
          </label>

          <div className={styles.modalField}>
            <BilingualField
              label="Brève description (optionnel)"
              ids={{ fr: DESCRIPTION_FIELD_IDS.description, en: DESCRIPTION_FIELD_IDS.descriptionEn }}
              fields={{ fr: "description", en: "descriptionEn" }}
              errors={fieldErrors}
              values={{ fr: form.description, en: form.descriptionEn }}
              onChange={(lang, value) =>
                edit((f) => (lang === "fr" ? { ...f, description: value } : { ...f, descriptionEn: value }))
              }
              readOnly={busy}
              maxLength={SPONSOR_DESCRIPTION_MAX}
              required={false}
              multiline
              rows={3}
              placeholders={{
                fr: "Boutique de jeux vidéo à prix réduits, partenaire de nos cash prizes.",
                en: "Discount video game store, partner of our cash prizes.",
              }}
              enMissing={editing !== null && sponsorEnglishMissing(editing)}
              describedBy="sponsor-description-hint"
              counter
              inputClassName={`${styles.modalInput} ${styles.modalTextarea}`}
              labelClassName={styles.modalLabel}
            />
            <span id="sponsor-description-hint" className={styles.logoHint}>
              Une ou deux phrases : qui est ce partenaire, et ce qu&apos;il apporte.
            </span>
          </div>

          <label className={styles.modalField}>
            <span className={styles.modalLabel}>Palier</span>
            {/* Liste : `aria-readonly` pendant un envoi, le choix y est ignoré (`edit`). */}
            <select
              className={styles.modalInput}
              value={form.tier}
              aria-readonly={busy || undefined}
              onChange={(e) => {
                const tier = e.target.value as SponsorTier;
                edit((f) => ({ ...f, tier }));
              }}
            >
              {SPONSOR_TIERS.map((tier) => (
                <option key={tier} value={tier}>
                  {SPONSOR_TIER_LABELS[tier]}
                </option>
              ))}
            </select>
          </label>

          <div className={styles.modalField}>
            <label className={styles.modalLabel} htmlFor={DESCRIPTION_FIELD_IDS.websiteUrl}>
              Site web (optionnel)
            </label>
            <input
              id={DESCRIPTION_FIELD_IDS.websiteUrl}
              className={styles.modalInput}
              inputMode="url"
              value={form.websiteUrl}
              maxLength={2048}
              placeholder="https://exemple.com"
              readOnly={busy}
              {...fieldErrors.aria("websiteUrl")}
              onChange={(e) => {
                const websiteUrl = e.target.value;
                edit((f) => ({ ...f, websiteUrl }));
                if (!isBusy()) fieldErrors.clear("websiteUrl");
              }}
            />
            <FieldErrorText fieldId={DESCRIPTION_FIELD_IDS.websiteUrl} message={fieldErrors.message("websiteUrl")} />
          </div>

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
                  onClick={preloadImageCropDialog}
                  accept="image/png,image/jpeg,image/webp"
                  className={styles.logoFileInput}
                  onChange={(e) => uploadImage(e, "banner")}
                />
                <BusyButton
                  busy={uploadKind === "banner"}
                  blocked={busy}
                  className={styles.logoUploadBtn}
                  onClick={() => bannerFileRef.current?.click()}
                >
                  <BusyLabel busy={uploadKind === "banner"} idle={bannerFileLabel} pending="Envoi…" />
                </BusyButton>
                {form.bannerUrl && (
                  <BusyButton
                    busy={false}
                    blocked={busy}
                    className={`${styles.logoUploadBtn} ${styles.logoUploadBtnDanger}`}
                    onClick={() => edit((f) => ({ ...f, bannerUrl: "" }))}
                  >
                    Retirer
                  </BusyButton>
                )}
              </div>
            </div>
            <span className={styles.logoHint}>
              Image large en fond de carte, recadrée en 1200 × 400 px (ratio 3:1) — tu choisis la zone gardée à l&apos;import. PNG, JPEG ou WebP, 5 Mo max.
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
                  onClick={preloadImageCropDialog}
                  accept="image/png,image/jpeg,image/webp"
                  className={styles.logoFileInput}
                  onChange={(e) => uploadImage(e, "logo")}
                />
                <BusyButton
                  busy={uploadKind === "logo"}
                  blocked={busy}
                  className={styles.logoUploadBtn}
                  onClick={() => logoFileRef.current?.click()}
                >
                  <BusyLabel busy={uploadKind === "logo"} idle={logoFileLabel} pending="Envoi…" />
                </BusyButton>
                {form.logoUrl && (
                  <BusyButton
                    busy={false}
                    blocked={busy}
                    className={`${styles.logoUploadBtn} ${styles.logoUploadBtnDanger}`}
                    onClick={() => edit((f) => ({ ...f, logoUrl: "" }))}
                  >
                    Retirer
                  </BusyButton>
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
              readOnly={busy}
              onChange={(e) => edit((f) => ({ ...f, logoUrl: e.target.value }))}
            />
          </div>

          <div className={styles.modalActions}>
            <CyberButton variant="ghost" asChild>
              <BusyButton busy={false} blocked={busy} onClick={close}>
                Annuler
              </BusyButton>
            </CyberButton>
            <CyberButton variant="primary" asChild>
              {/* Pendant l'import d'une image, l'attente est celle de l'image :
                  le libellé d'envoi n'est pas celui de l'enregistrement. */}
              <BusyButton busy={busy && uploadKind === null} blocked={busy} onClick={() => void submit()}>
                <BusyLabel busy={busy && uploadKind === null} idle={submitLabel} pending={pendingLabel} />
              </BusyButton>
            </CyberButton>
          </div>
        </LandingDialog>
      )}
      {pendingRemoval ? (
        <ConfirmActionDialog
          title={`Supprimer le partenaire « ${pendingRemoval.name} » ?`}
          confirmLabel="Supprimer le partenaire"
          pendingLabel="Suppression…"
          contentLang={staffLang}
          onClose={() => setPendingRemoval(null)}
          onConfirm={() => remove(pendingRemoval)}
        >
          <p>
            Le partenaire disparaît de l&apos;accueil, avec son texte, son lien, son logo et son
            bandeau. Il ne se restaure pas : il faudrait le saisir et réimporter ses images.
          </p>
        </ConfirmActionDialog>
      ) : null}
    </section>
  );
}
