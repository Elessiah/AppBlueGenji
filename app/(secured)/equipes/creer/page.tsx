"use client";

import { ChangeEvent, FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useToast } from "@/components/ui/toast";
import { CyberCard, CyberButton } from "@/components/cyber";
import { TEAM_TAG_MAX_LENGTH, TEAM_TAG_MIN_LENGTH, normalizeTeamTag } from "@/lib/shared/team-tag";
import { TEAM_NAME_MAX_LENGTH, TEAM_NAME_MIN_LENGTH, checkTeamName } from "@/lib/shared/team-name";
import { membershipErrorMessage, teamErrorMessage } from "../_lib/team-errors";
import { precheckImageUpload } from "@/lib/shared/image-upload-errors";
import { IMAGE_UPLOAD_MAX_BYTES, IMAGE_UPLOAD_MIME_TYPES } from "@/lib/shared/uploads";
import {
  LOGO_RIGHTS_FIELD,
  LOGO_RIGHTS_LABEL,
  LOGO_RIGHTS_TERMS_ANCHOR,
  TERMS_CHECKBOX_LABEL,
  TERMS_PATH,
} from "@/lib/shared/terms-of-use";
import { CodedError, TEAM_IDENTITY_FIELD_ERRORS, errorCode } from "@/lib/shared/field-errors";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { FieldErrorText } from "@/components/ui/field-error-text";

const FIELD_IDS = { name: "team-name", tag: "team-tag" } as const;

export default function CreateTeamPage() {
  const router = useRouter();
  const { showError } = useToast();
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [description, setDescription] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  // Créer une équipe, c'est accepter les conditions d'utilisation ; envoyer son
  // logo, c'est garantir en détenir les droits. Deux cases, deux engagements.
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [logoRights, setLogoRights] = useState(false);
  const [loading, setLoading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const fieldErrors = useFieldErrors(TEAM_IDENTITY_FIELD_ERRORS, FIELD_IDS);

  const onLogoChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const refusal = precheckImageUpload(file);
    if (refusal) {
      showError(teamErrorMessage(refusal));
      return;
    }
    setLogoFile(file);
    setLogoRights(false);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const nameCheck = checkTeamName(name);
    if (!nameCheck.ok) {
      const message = teamErrorMessage(nameCheck.reason);
      fieldErrors.flag("name", message);
      showError(message);
      return;
    }
    // Le nom est bon : son signalement d'erreur tombe, même si une case manque.
    fieldErrors.clear();
    if (logoFile && !logoRights) {
      showError(teamErrorMessage("LOGO_RIGHTS_NOT_CERTIFIED"));
      return;
    }
    if (!acceptTerms) {
      showError(teamErrorMessage("TERMS_REQUIRED"));
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/teams", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          description: description.trim() || null,
          tag: tag.trim() || null,
          acceptTerms,
        }),
      });
      const payload = (await response.json()) as { error?: string; teamId?: number };
      if (!response.ok || !payload.teamId) {
        const code = payload.error || "TEAM_CREATE_FAILED";
        throw new CodedError(code, code);
      }

      if (logoFile) {
        const formData = new FormData();
        formData.append("file", logoFile);
        formData.append(LOGO_RIGHTS_FIELD, logoRights ? "1" : "0");
        const logoResponse = await fetch(`/api/teams/${payload.teamId}/logo`, {
          method: "POST",
          body: formData,
        });
        if (!logoResponse.ok) {
          const logoPayload = (await logoResponse.json().catch(() => ({}))) as { error?: string };
          // L'équipe existe : c'est le logo seul qui manque, et la fiche
          // permet de le reposer.
          showError(`Équipe créée, mais sans logo : ${teamErrorMessage(logoPayload.error || "LOGO_UPLOAD_FAILED")}`);
        }
      }

      router.push(`/equipes/${payload.teamId}`);
      router.refresh();
    } catch (e) {
      // Le créateur devient propriétaire : `USER_ALREADY_IN_TEAM` parle de lui.
      const message = membershipErrorMessage((e as Error).message);
      fieldErrors.report(errorCode(e), message);
      showError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="fade-in container">
      <Link href="/equipes" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--ink-mute)", marginBottom: 16 }}>
        ← Équipes
      </Link>
      <h1 className="display" style={{ fontSize: 48, margin: "0 0 8px" }}>
        Créer mon équipe
      </h1>
      <p style={{ color: "var(--ink-mute)", margin: "0 0 24px", fontSize: 14 }}>
        Le rôle Owner est automatiquement attribué au créateur.
      </p>

      <CyberCard ticks>
        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="team-name">Nom d&apos;équipe</label>
              <input
                id="team-name"
                required
                // Bornes contrôlées par `checkTeamName` à l'envoi, pas par
                // `minLength`/`maxLength` : le navigateur compte des unités
                // UTF-16, la base des caractères.
                {...fieldErrors.aria("name", "team-name-help")}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  fieldErrors.clear("name");
                }}
                placeholder="Mon équipe"
              />
              <FieldErrorText fieldId={FIELD_IDS.name} message={fieldErrors.message("name")} />
              <p id="team-name-help" style={{ fontSize: 12, color: "var(--text-1)", margin: "6px 0 0" }}>
                {TEAM_NAME_MIN_LENGTH} à {TEAM_NAME_MAX_LENGTH} caractères, unique sur le site.
              </p>
            </div>
            <div className="field">
              <label htmlFor="team-tag">Sigle (optionnel)</label>
              {/* Normalisé à la frappe : le champ montre déjà ce qui sera
                  enregistré, plutôt que de laisser découvrir la majuscule
                  après coup. */}
              <input
                id="team-tag"
                value={tag}
                onChange={(e) => {
                  setTag(normalizeTeamTag(e.target.value));
                  fieldErrors.clear("tag");
                }}
                placeholder="BG"
                minLength={TEAM_TAG_MIN_LENGTH}
                maxLength={TEAM_TAG_MAX_LENGTH}
                pattern="[A-Za-z0-9]*"
                {...fieldErrors.aria("tag", "team-tag-help")}
                style={{ textTransform: "uppercase", letterSpacing: "0.12em", maxWidth: 160 }}
              />
              <FieldErrorText fieldId={FIELD_IDS.tag} message={fieldErrors.message("tag")} />
              <p id="team-tag-help" style={{ fontSize: 11, color: "var(--ink-mute)", margin: "6px 0 0" }}>
                {TEAM_TAG_MIN_LENGTH} à {TEAM_TAG_MAX_LENGTH} lettres ou chiffres, unique sur le site
              </p>
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label htmlFor="team-description">Description (optionnel)</label>
              <textarea
                id="team-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Présente ton équipe, vos objectifs, votre ambiance…"
                rows={3}
              />
            </div>
            <div className="field">
              <label>Logo (optionnel)</label>
              <input
                ref={logoInputRef}
                type="file"
                accept={IMAGE_UPLOAD_MIME_TYPES.join(",")}
                onChange={onLogoChange}
                style={{ display: "none" }}
              />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => logoInputRef.current?.click()}
                  style={{ padding: "9px 18px", fontSize: 13 }}
                >
                  Choisir un logo
                </button>
                {logoFile ? (
                  <>
                    <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>{logoFile.name}</span>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => setLogoFile(null)}
                      style={{ padding: "6px 12px", fontSize: 12 }}
                    >
                      Retirer
                    </button>
                  </>
                ) : null}
              </div>
              <p style={{ fontSize: 11, color: "var(--ink-mute)", margin: "6px 0 0" }}>
                PNG, JPEG ou WebP — {IMAGE_UPLOAD_MAX_BYTES / (1024 * 1024)} Mo max
              </p>
              {logoFile ? (
                <label className="consent-check">
                  <input type="checkbox" checked={logoRights} onChange={(e) => setLogoRights(e.target.checked)} />
                  <span>
                    {LOGO_RIGHTS_LABEL}{" "}
                    <Link href={LOGO_RIGHTS_TERMS_ANCHOR} target="_blank" rel="noreferrer">
                      En savoir plus
                    </Link>
                  </span>
                </label>
              ) : null}
            </div>
          </div>

          <label className="consent-check">
            <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} />
            <span>
              {TERMS_CHECKBOX_LABEL} (
              <Link href={TERMS_PATH} target="_blank" rel="noreferrer">
                lire les conditions
              </Link>
              ) — notamment la garantie des droits sur le nom, le logo et la description de l&apos;équipe.
            </span>
          </label>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
            <CyberButton variant="ghost" asChild>
              <Link href="/equipes">Annuler</Link>
            </CyberButton>
            <CyberButton
              variant="primary"
              type="submit"
              disabled={loading}
              style={{ opacity: loading ? 0.6 : 1, cursor: loading ? "not-allowed" : "pointer" }}
            >
              {loading ? "Création..." : "Créer l'équipe"}
            </CyberButton>
          </div>
        </form>
      </CyberCard>
    </section>
  );
}
