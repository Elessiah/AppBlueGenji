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

export default function CreateTeamPage() {
  const router = useRouter();
  const { showError } = useToast();
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [description, setDescription] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement | null>(null);

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
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const nameCheck = checkTeamName(name);
    if (!nameCheck.ok) {
      showError(teamErrorMessage(nameCheck.reason));
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
        }),
      });
      const payload = (await response.json()) as { error?: string; teamId?: number };
      if (!response.ok || !payload.teamId) throw new Error(payload.error || "TEAM_CREATE_FAILED");

      if (logoFile) {
        const formData = new FormData();
        formData.append("file", logoFile);
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
      showError(membershipErrorMessage((e as Error).message));
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
                aria-describedby="team-name-help"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Mon équipe"
              />
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
                onChange={(e) => setTag(normalizeTeamTag(e.target.value))}
                placeholder="BG"
                minLength={TEAM_TAG_MIN_LENGTH}
                maxLength={TEAM_TAG_MAX_LENGTH}
                pattern="[A-Za-z0-9]*"
                aria-describedby="team-tag-help"
                style={{ textTransform: "uppercase", letterSpacing: "0.12em", maxWidth: 160 }}
              />
              <p id="team-tag-help" style={{ fontSize: 11, color: "var(--ink-mute)", margin: "6px 0 0" }}>
                {TEAM_TAG_MIN_LENGTH} à {TEAM_TAG_MAX_LENGTH} lettres ou chiffres, unique sur le site
              </p>
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>Description (optionnel)</label>
              <textarea
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
            </div>
          </div>

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
