"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LogoWithGlow } from "@/components/logo-with-glow";
import type { TeamDetailResponse } from "@/lib/shared/types";
import { useToast } from "@/components/ui/toast";
import { TEAM_TAG_MAX_LENGTH, TEAM_TAG_MIN_LENGTH, checkTeamTag, normalizeTeamTag } from "@/lib/shared/team-tag";
import { TEAM_NAME_MAX_LENGTH, TEAM_NAME_MIN_LENGTH, checkTeamName } from "@/lib/shared/team-name";
import { teamErrorMessage } from "../../_lib/team-errors";
import { precheckImageUpload } from "@/lib/shared/image-upload-errors";
import { IMAGE_UPLOAD_MAX_BYTES, IMAGE_UPLOAD_MIME_TYPES } from "@/lib/shared/uploads";
import { LOGO_RIGHTS_FIELD, LOGO_RIGHTS_LABEL, LOGO_RIGHTS_TERMS_ANCHOR } from "@/lib/shared/terms-of-use";
import Link from "next/link";
import { jsonRequest, teamApi } from "../_lib/team-api";
import { TransferOwnershipDialog } from "./TransferOwnershipDialog";
import { ClaimGhostTeamDialog } from "./ClaimGhostTeamDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import styles from "../team.module.css";
import { TEAM_IDENTITY_FIELD_ERRORS } from "@/lib/shared/field-errors";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { FieldErrorText } from "@/components/ui/field-error-text";

const FIELD_IDS = { name: "team-meta-name", tag: "team-meta-tag" } as const;

interface TeamSettingsProps {
  team: TeamDetailResponse;
  onChanged: () => void;
}

/**
 * Paramètres de l'équipe, pour qui la gère.
 *
 * Deux publics, et le partage est celui du serveur (`docs/AUTHORIZATION_RULES.md`
 * §3) : l'**identité** — nom, sigle, description — et l'existence de l'équipe
 * (transfert, dissolution) sont au propriétaire ; le **logo** est à toute la
 * gestion. Le formulaire complet s'affichait pourtant à un manager, dont chaque
 * « Mettre à jour » finissait en `FORBIDDEN` : il voit désormais le logo, et une
 * phrase qui dit à qui s'adresser pour le reste.
 */
export function TeamSettings({ team, onChanged }: TeamSettingsProps) {
  const { showError, showSuccess } = useToast();
  const router = useRouter();
  const managedAsGhost = team.managedAsGhost;
  const ownsIdentity = team.viewerMembership === "OWNER" || managedAsGhost;

  const saved = {
    name: team.team.name,
    tag: team.team.tag ?? "",
    description: team.team.description ?? "",
  };
  const [name, setName] = useState(saved.name);
  const [tag, setTag] = useState(saved.tag);
  const [description, setDescription] = useState(saved.description);
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const logoFileRef = useRef<HTMLInputElement | null>(null);
  // Garantie des droits sur **ce** logo : cochée avant le choix du fichier, et
  // décochée après chaque envoi — chaque image certifiée est la sienne.
  const [logoRights, setLogoRights] = useState(false);
  const logoRightsRef = useRef<HTMLInputElement | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const fieldErrors = useFieldErrors(TEAM_IDENTITY_FIELD_ERRORS, FIELD_IDS);

  // Réaligne le formulaire sur ce que le serveur a retenu (après un
  // enregistrement, il a pu retirer des espaces ou passer le sigle en
  // majuscules). Les dépendances sont les **valeurs** : un rechargement qui ne
  // les change pas n'efface pas une saisie en cours.
  useEffect(() => {
    setName(saved.name);
    setTag(saved.tag);
    setDescription(saved.description);
  }, [saved.name, saved.tag, saved.description]);

  const nameCheck = checkTeamName(name);
  const tagCheck = checkTeamTag(tag);
  const dirty =
    name.trim() !== saved.name || tag.trim() !== saved.tag || description.trim() !== saved.description.trim();
  const canSave = dirty && nameCheck.ok && tagCheck.ok && !saving;

  const saveMeta = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    fieldErrors.clear();
    setSaving(true);
    try {
      await teamApi(
        `/api/teams/${team.team.id}`,
        jsonRequest("PATCH", {
          name: name.trim(),
          description: description.trim() || null,
          tag: tag.trim() || null,
        }),
        "TEAM_UPDATE_FAILED",
      );
      showSuccess("Équipe mise à jour.");
      onChanged();
    } catch (e) {
      // `teamApi` lève le code du refus tel quel : c'est lui qui désigne le
      // champ (nom ou sigle déjà pris, que le contrôle local ne peut pas voir).
      const code = (e as Error).message;
      const message = teamErrorMessage(code);
      fieldErrors.report(code, message);
      showError(message);
    } finally {
      setSaving(false);
    }
  };

  const onLogoChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const refusal = precheckImageUpload(file);
    if (refusal) {
      showError(teamErrorMessage(refusal));
      return;
    }

    setLogoBusy(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append(LOGO_RIGHTS_FIELD, logoRights ? "1" : "0");
      await teamApi(`/api/teams/${team.team.id}/logo`, { method: "POST", body: formData }, "LOGO_UPLOAD_FAILED");
      showSuccess("Logo mis à jour.");
      setLogoRights(false);
      onChanged();
    } catch (e) {
      showError(teamErrorMessage((e as Error).message));
    } finally {
      setLogoBusy(false);
    }
  };

  const onLogoDelete = async () => {
    setLogoBusy(true);
    try {
      await teamApi(`/api/teams/${team.team.id}/logo`, { method: "DELETE" }, "LOGO_DELETE_FAILED");
      showSuccess("Logo supprimé.");
      onChanged();
    } catch (e) {
      showError(teamErrorMessage((e as Error).message));
    } finally {
      setLogoBusy(false);
    }
  };

  const deleteTeam = async (): Promise<boolean> => {
    try {
      await teamApi(`/api/teams/${team.team.id}`, { method: "DELETE" }, "TEAM_DELETE_FAILED");
      showSuccess(
        managedAsGhost ? "Équipe fantôme supprimée." : "Équipe dissoute. Ses statistiques restent consultables.",
      );
      router.push("/equipes");
      return true;
    } catch (e) {
      showError(teamErrorMessage((e as Error).message));
      return false;
    }
  };

  return (
    <section className={`ds-block ${styles.block}`} aria-labelledby="team-settings-title">
      <div className="ds-section-title orange">
        <h2 id="team-settings-title">Paramètres de l&apos;équipe</h2>
      </div>

      <div className={styles.settingsGrid}>
        {ownsIdentity ? (
          <form onSubmit={saveMeta} className={styles.fullWidth} aria-label="Identité de l'équipe">
            <div className={styles.settingsGrid}>
              <div className="field">
                <label htmlFor="team-meta-name">Nom de l&apos;équipe</label>
                <input
                  id="team-meta-name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    fieldErrors.clear("name");
                  }}
                  required
                  // Pas de `minLength`/`maxLength` : le navigateur compte des
                  // unités UTF-16, la base des caractères — un emoji en vaut
                  // deux ici, un là. `checkTeamName` fait foi et arme le bouton.
                  {...fieldErrors.aria("name", "team-meta-name-help")}
                  // Après la décomposition : le contrôle local (longueur)
                  // signale aussi, sans phrase à lire — le bouton désarmé et
                  // l'aide disent déjà la règle.
                  aria-invalid={!nameCheck.ok || fieldErrors.invalidField === "name"}
                />
                <FieldErrorText fieldId={FIELD_IDS.name} message={fieldErrors.message("name")} />
                <p id="team-meta-name-help" className={styles.help}>
                  {TEAM_NAME_MIN_LENGTH} à {TEAM_NAME_MAX_LENGTH} caractères, unique sur le site.
                </p>
              </div>
              <div className="field">
                <label htmlFor="team-meta-tag">Sigle</label>
                <input
                  id="team-meta-tag"
                  className={styles.tagInput}
                  value={tag}
                  onChange={(e) => {
                    setTag(normalizeTeamTag(e.target.value));
                    fieldErrors.clear("tag");
                  }}
                  minLength={TEAM_TAG_MIN_LENGTH}
                  maxLength={TEAM_TAG_MAX_LENGTH}
                  pattern="[A-Za-z0-9]*"
                  placeholder="BG"
                  {...fieldErrors.aria("tag", "team-meta-tag-help")}
                  aria-invalid={!tagCheck.ok || fieldErrors.invalidField === "tag"}
                />
                <FieldErrorText fieldId={FIELD_IDS.tag} message={fieldErrors.message("tag")} />
                <p id="team-meta-tag-help" className={styles.help}>
                  {TEAM_TAG_MIN_LENGTH} à {TEAM_TAG_MAX_LENGTH} lettres ou chiffres, unique sur le
                  site — laisser vide pour ne pas en avoir.
                </p>
              </div>
              <div className={`field ${styles.fullWidth}`}>
                <label htmlFor="team-meta-description">Description</label>
                <textarea
                  id="team-meta-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="Présente ton équipe…"
                />
              </div>
            </div>
            <div className={styles.formFooter}>
              {dirty && !saving ? (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    fieldErrors.clear();
                    setName(saved.name);
                    setTag(saved.tag);
                    setDescription(saved.description);
                  }}
                >
                  Annuler les modifications
                </button>
              ) : null}
              <button type="submit" className={`btn ${styles.primaryButton}`} disabled={!canSave}>
                {saving ? "Enregistrement…" : "Enregistrer"}
              </button>
            </div>
          </form>
        ) : (
          <p className={`${styles.notice} ${styles.fullWidth}`}>
            Le nom, le sigle et la description de l&apos;équipe sont réservés à son propriétaire.
          </p>
        )}

        <div className={`field ${styles.fullWidth} ${ownsIdentity ? styles.divider : ""}`}>
          <span id="team-logo-label" className={styles.roleGroupLegend}>
            Logo
          </span>
          <div className={styles.logoRow}>
            <div className={styles.logoPreview} aria-hidden>
              {team.team.logoUrl ? (
                <LogoWithGlow src={team.team.logoUrl} alt="" width={64} height={64} size="sm" borderRadius={12} />
              ) : (
                "🛡"
              )}
            </div>
            <input
              ref={logoFileRef}
              type="file"
              accept={IMAGE_UPLOAD_MIME_TYPES.join(",")}
              onChange={onLogoChange}
              className={styles.visuallyHidden}
              tabIndex={-1}
              aria-hidden
            />
            <div className={styles.actionsRow} aria-labelledby="team-logo-label" role="group">
              <button
                type="button"
                className="btn"
                disabled={logoBusy}
                onClick={() => {
                  if (!logoRights) {
                    showError(teamErrorMessage("LOGO_RIGHTS_NOT_CERTIFIED"));
                    logoRightsRef.current?.focus();
                    return;
                  }
                  logoFileRef.current?.click();
                }}
              >
                {logoBusy ? "Envoi…" : team.team.logoUrl ? "Changer le logo" : "Ajouter un logo"}
              </button>
              {team.team.logoUrl ? (
                <button type="button" className="btn ghost" disabled={logoBusy} onClick={onLogoDelete}>
                  Retirer le logo
                </button>
              ) : null}
            </div>
          </div>
          <p className={styles.help}>PNG, JPEG ou WebP — {IMAGE_UPLOAD_MAX_BYTES / (1024 * 1024)} Mo au maximum.</p>
          <label className="consent-check">
            <input
              ref={logoRightsRef}
              type="checkbox"
              checked={logoRights}
              onChange={(e) => setLogoRights(e.target.checked)}
            />
            <span>
              {LOGO_RIGHTS_LABEL}{" "}
              <Link href={LOGO_RIGHTS_TERMS_ANCHOR} target="_blank" rel="noreferrer">
                En savoir plus
              </Link>
            </span>
          </label>
        </div>

        {ownsIdentity ? (
          <div className={`${styles.dangerZone} ${styles.fullWidth}`}>
            <h3 className={styles.dangerTitle}>Zone sensible</h3>
            <p className={styles.help}>
              {managedAsGhost
                ? "Attribuer l'équipe à un joueur en fait une équipe ordinaire, dont il devient propriétaire."
                : "Pour quitter l'équipe, transfère d'abord sa propriété à un autre membre."}
            </p>
            <div className={`${styles.actionsRow} ${styles.dangerActions}`}>
              {managedAsGhost ? (
                <button type="button" className="btn ghost" onClick={() => setClaimOpen(true)}>
                  Attribuer à un joueur
                </button>
              ) : (
                <button type="button" className="btn ghost" onClick={() => setTransferOpen(true)}>
                  Transférer la propriété
                </button>
              )}
              <button type="button" className={`btn ghost ${styles.dangerButton}`} onClick={() => setDeleteOpen(true)}>
                {managedAsGhost ? "Supprimer l'équipe fantôme" : "Dissoudre l'équipe"}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {transferOpen && (
        <TransferOwnershipDialog
          teamId={team.team.id}
          members={team.members}
          onClose={() => setTransferOpen(false)}
          onChanged={onChanged}
        />
      )}

      {claimOpen && (
        <ClaimGhostTeamDialog
          teamId={team.team.id}
          teamName={team.team.name}
          onClose={() => setClaimOpen(false)}
          onChanged={onChanged}
        />
      )}

      {deleteOpen && (
        <ConfirmDialog
          title={managedAsGhost ? "Supprimer l'équipe fantôme ?" : "Dissoudre l'équipe ?"}
          confirmLabel={managedAsGhost ? "Supprimer" : "Dissoudre"}
          pendingLabel={managedAsGhost ? "Suppression…" : "Dissolution…"}
          requireText={team.team.name}
          onClose={() => setDeleteOpen(false)}
          onConfirm={deleteTeam}
        >
          <p>
            Le nom, le sigle, la description et le logo sont effacés, et tous les membres sont
            détachés. Les statistiques et l&apos;historique de tournois restent consultables.
          </p>
          <p>
            <strong>Action irréversible.</strong>
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
