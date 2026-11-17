"use client";

import { useMemo, useRef, useState } from "react";
import { CyberCard, CyberButton, TeamSigil } from "@/components/cyber";
import { BusyButton } from "@/components/ui/busy-button";
import { BusyLabel } from "@/components/ui/busy-label";
import { BilingualField, EnglishMissingMark, withEnglishMissing } from "@/components/ui/bilingual-field";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { useToast } from "@/components/ui/toast";
import {
  type BureauMember,
  BUREAU_FIELD_ERRORS,
  BUREAU_ROLE_MAX,
  bureauErrorMessage,
  computeInitials,
  FALLBACK_BUREAU,
  localizedBureau,
  randomBureauColor,
  validateBureauInput,
} from "@/lib/shared/bureau";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { useArrowRefocus } from "@/lib/shared/hooks/useArrowRefocus";
import { useBusyGuard } from "@/lib/shared/hooks/useBusyGuard";
import { arrowKey } from "@/lib/shared/arrow-refocus";
import { withRequestKey, type KeyedBody } from "@/lib/shared/request-key";
import { DEFAULT_LOCALE, type Locale } from "@/lib/shared/locales";
import { scopedText } from "@/lib/shared/scoped-text";
import { hasEnglish } from "@/lib/shared/staff-translation";
import type frAssociation from "@/messages/fr/association.json";
import { LandingDialog } from "@/components/cyber/landing/LandingDialog";
import { BUSY_REFUSED_MESSAGE } from "@/lib/shared/busy-refused-message";
import styles from "./page.module.css";

interface BureauSectionProps {
  initialMembers: BureauMember[];
  isAdmin: boolean;
  /** Langue de la page, et les textes visiteurs de la section dans cette langue (`association.bureau`). */
  locale?: Locale;
  messages: (typeof frAssociation)["bureau"];
}

interface FormState {
  name: string;
  role: string;
  roleEn: string;
  initials: string;
  color: string;
}

const EMPTY_FORM: FormState = { name: "", role: "", roleEn: "", initials: "", color: "" };

/** `id` des deux champs du rôle, cibles de `useFieldErrors`. */
const ROLE_FIELD_IDS = { role: "bureau-role", roleEn: "bureau-role-en" } as const;

export function BureauSection({
  initialMembers,
  isAdmin,
  locale = DEFAULT_LOCALE,
  messages,
}: Readonly<BureauSectionProps>) {
  const { t } = scopedText(locale, messages);
  // La gestion reste en français (D4) : sous `/en`, ses contrôles, sa fenêtre
  // et ses notifications le disent (`lang="fr"`).
  const staffLang = locale === DEFAULT_LOCALE ? undefined : "fr";
  const toast = useToast();
  const staffToast = staffLang ? { lang: staffLang } : undefined;
  const showError = (message: string) => toast.showError(message, staffToast);
  const showSuccess = (message: string) => toast.showSuccess(message, staffToast);
  const showInfo = (message: string) => toast.showInfo(message, staffToast);
  const fieldErrors = useFieldErrors(BUREAU_FIELD_ERRORS, ROLE_FIELD_IDS);
  const [members, setMembers] = useState<BureauMember[]>(initialMembers);
  // Le bureau dans la langue de la page : sous `/en`, un membre dont le rôle
  // n'a pas encore d'anglais n'est pas rendu (`localizedBureau`).
  const shown = useMemo(() => localizedBureau(members, locale), [members, locale]);
  const [editing, setEditing] = useState<BureauMember | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [open, setOpen] = useState(false);
  // Un envoi à la fois pour la section (enregistrer, déplacer, supprimer) :
  // garde synchrone, boutons focalisables pendant l'attente (`BUSY_BUTTONS.md`).
  // Un double clic sur une flèche partait deux fois, chaque envoi calculé sur
  // l'ordre d'avant l'autre.
  const { busy, isBusy, run } = useBusyGuard();
  const refocusArrow = useArrowRefocus("bureau");
  // Clé de l'ajout, oubliée à chaque ouverture : un renvoi du même formulaire
  // (réponse perdue) rend le membre déjà créé au lieu d'en ajouter un second ;
  // un formulaire corrigé entre-temps tire une clé neuve (`keyForBody`).
  const createKey = useRef<KeyedBody | null>(null);

  // Les membres de secours (id négatif) ne sont pas en base : non modifiables.
  const canManage = (m: BureauMember) => isAdmin && m.id > 0;

  function openCreate() {
    if (isBusy()) return;
    createKey.current = null;
    fieldErrors.clear();
    setEditing(null);
    setForm({ name: "", role: "", roleEn: "", initials: "", color: randomBureauColor() });
    setOpen(true);
  }

  function openEdit(member: BureauMember) {
    if (isBusy()) return;
    fieldErrors.clear();
    setEditing(member);
    setForm({
      name: member.name,
      role: member.role,
      roleEn: member.roleEn ?? "",
      initials: member.initials,
      color: member.color,
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

  // Champ modifié pendant un envoi : ignoré, même avant que « readOnly » soit
  // rendu (ce qui est affiché est ce qui part).
  const edit = (change: (f: FormState) => FormState) => {
    if (!isBusy()) setForm(change);
  };

  // Un refus désigne son champ quand il le peut (rôle, anglais du rôle) :
  // rattaché à lui, focus ramené, et la même phrase en notification.
  function refuse(code: string | undefined, fallback: string) {
    const message = bureauErrorMessage(code, fallback);
    fieldErrors.report(code, message);
    showError(message);
  }

  // Initiales affichées : saisie manuelle si fournie, sinon dérivées du nom.
  const previewInitials = (form.initials.trim() || computeInitials(form.name) || "·").toUpperCase();

  async function submit() {
    if (isBusy()) return;
    if (!form.name.trim()) {
      showError("Le nom est requis.");
      return;
    }
    const payload = {
      name: form.name.trim(),
      role: form.role.trim(),
      roleEn: form.roleEn.trim(),
      initials: form.initials.trim() || computeInitials(form.name),
      color: form.color || randomBureauColor(),
    };
    // Même validation que le serveur, avant l'envoi : le rôle et son anglais
    // (obligatoire, D9) sont désignés sans aller-retour.
    const check = validateBureauInput(payload);
    if (!check.ok) {
      refuse(check.error, "Formulaire invalide.");
      return;
    }

    await run(async () => {
      try {
        const url = editing ? `/api/association/bureau/${editing.id}` : "/api/association/bureau";
        const res = await fetch(url, {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editing ? payload : withRequestKey(createKey, payload)),
        });
        const data = (await res.json()) as { member?: BureauMember; error?: string };
        if (!res.ok || !data.member) {
          refuse(data.error, "Échec de l'enregistrement.");
          return;
        }

        const saved = data.member;
        if (editing) {
          setMembers((prev) => prev.map((m) => (m.id === saved.id ? saved : m)));
          showSuccess("Membre du bureau mis à jour.");
        } else {
          // Si on partait du bureau de secours, on bascule sur la liste réelle.
          setMembers((prev) => [...prev.filter((m) => m.id > 0), saved]);
          showSuccess("Membre du bureau ajouté.");
        }
        closeDialog();
      } catch {
        showError("Erreur réseau, réessaye.");
      }
    });
  }

  // Déplace un membre d'un cran (direction -1 = vers le haut, +1 = vers le bas)
  // et persiste le nouvel ordre. Mise à jour optimiste avec rollback en cas d'échec.
  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= members.length) return;

    await run(async () => {
      const previous = members;
      const reordered = [...members];
      [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
      const id = members[index].id;
      const arrow = direction < 0 ? "up" : "down";
      setMembers(reordered);
      refocusArrow(id, arrow);
      try {
        const res = await fetch("/api/association/bureau/reorder", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: reordered.map((m) => m.id) }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          showError(data.error ? `Échec : ${data.error}` : "Échec du réordonnancement.");
          setMembers(previous);
          refocusArrow(id, arrow);
          return;
        }
        showSuccess("Ordre du bureau mis à jour.");
      } catch {
        showError("Erreur réseau, réessaye.");
        setMembers(previous);
        refocusArrow(id, arrow);
      }
    });
  }

  const [pendingRemoval, setPendingRemoval] = useState<BureauMember | null>(null);

  async function remove(member: BureauMember): Promise<boolean> {
    const done = await run(async () => {
      try {
        const res = await fetch(`/api/association/bureau/${member.id}`, { method: "DELETE" });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          showError(data.error ? `Échec : ${data.error}` : "Échec de la suppression.");
          return false;
        }
        // Si plus aucun membre réel, réafficher le bureau de secours — c'est ce
        // que renverrait un rechargement (table vide → FALLBACK_BUREAU).
        setMembers((prev) => {
          const next = prev.filter((m) => m.id !== member.id);
          return next.length === 0 ? FALLBACK_BUREAU : next;
        });
        showSuccess("Membre du bureau supprimé.");
        return true;
      } catch {
        showError("Erreur réseau, réessaye.");
        return false;
      }
    });
    if (done === undefined) showInfo(BUSY_REFUSED_MESSAGE);
    return done ?? false;
  }

  const submitLabel = editing ? "Enregistrer" : "Ajouter";
  const pendingLabel = editing ? "Enregistrement…" : "Ajout…";
  // Sous `/en`, un bureau dont aucun rôle n'est encore traduit : le dire,
  // plutôt qu'une grille vide sous « 0 MEMBERS ».
  const pendingTranslation = shown.length === 0 && members.length > 0;

  return (
    <section className={styles.section}>
      <header className={styles.head}>
        <div>
          <span className="eyebrow">{t("eyebrow")}</span>
          <h2 className={styles.sectionTitle}>{t("title")}</h2>
        </div>
        <div className={styles.bureauHeadActions}>
          {!pendingTranslation && <span className={styles.meta}>{t("meta", { count: shown.length })}</span>}
          {isAdmin && (
            <CyberButton variant="primary" asChild>
              {/* Bloqué pendant un déplacement ou une suppression : il le dit
                  (`aria-busy`) et garde son focus. */}
              <BusyButton busy={busy} onClick={openCreate} lang={staffLang}>
                + Ajouter
              </BusyButton>
            </CyberButton>
          )}
        </div>
      </header>

      {pendingTranslation && <p className={styles.bureauPending}>{t("pendingTranslation")}</p>}
      <div className={styles.bureauGrid}>
        {shown.map(({ member: b, role, index }) => (
          <CyberCard key={b.id} lift className={styles.bureauCard}>
            <div className={styles.bureauSigil}>
              <TeamSigil label={b.initials} color={b.color} size={40} />
            </div>
            <div className={styles.bureauDivider} />
            <div>
              <h3 className={styles.bureauName}>{b.name}</h3>
              <p className={styles.bureauRole}>{role}</p>
            </div>
            {canManage(b) && (
              <div className={styles.bureauCardActions} data-tap-zone lang={staffLang}>
                {/* Ordre réglé en français seulement : sous /en, des voisins sans anglais sont masqués. */}
                {locale === DEFAULT_LOCALE && (
                  <>
                    <BusyButton
                      busy={busy}
                      blocked={index === 0}
                      className={`${styles.bureauAction} ${styles.moveAction}`}
                      onClick={() => void move(index, -1)}
                      data-arrow={arrowKey("bureau", b.id, "up")}
                      data-edge={index === 0 || undefined}
                      aria-label={`Déplacer ${b.name} vers le haut`}
                      title="Monter"
                    >
                      ↑
                    </BusyButton>
                    <BusyButton
                      busy={busy}
                      blocked={index === members.length - 1}
                      className={`${styles.bureauAction} ${styles.moveAction}`}
                      onClick={() => void move(index, 1)}
                      data-arrow={arrowKey("bureau", b.id, "down")}
                      data-edge={index === members.length - 1 || undefined}
                      aria-label={`Déplacer ${b.name} vers le bas`}
                      title="Descendre"
                    >
                      ↓
                    </BusyButton>
                  </>
                )}
                <BusyButton
                  busy={busy}
                  className={styles.bureauAction}
                  onClick={() => openEdit(b)}
                  aria-label={withEnglishMissing(`Modifier ${b.name}`, !hasEnglish(b.roleEn))}
                >
                  Modifier
                  {!hasEnglish(b.roleEn) && <EnglishMissingMark />}
                </BusyButton>
                <BusyButton
                  busy={busy}
                  className={`${styles.bureauAction} ${styles.bureauActionDanger}`}
                  onClick={() => {
                    if (!isBusy()) setPendingRemoval(b);
                  }}
                  aria-label={`Supprimer ${b.name}`}
                >
                  Supprimer
                </BusyButton>
              </div>
            )}
          </CyberCard>
        ))}
      </div>

      {open && (
        <LandingDialog
          onClose={close}
          busy={busy}
          className={styles.modal}
          lang={staffLang}
          label={editing ? "Modifier un membre du bureau" : "Ajouter un membre du bureau"}
        >
          <h3 className={styles.modalTitle}>
            {editing ? "Modifier le membre" : "Ajouter un membre"}
          </h3>

          <div className={styles.modalPreview}>
            <TeamSigil label={previewInitials} color={form.color || "var(--blue-500)"} size={40} />
            {/* Refusée pendant l'envoi : la couleur affichée est celle qui part. */}
            <BusyButton
              busy={false}
              blocked={busy}
              className={styles.bureauAction}
              onClick={() => edit((f) => ({ ...f, color: randomBureauColor() }))}
            >
              Couleur aléatoire
            </BusyButton>
          </div>

          <label className={styles.modalField}>
            <span className={styles.modalLabel}>Nom</span>
            <input
              data-autofocus
              className={styles.modalInput}
              value={form.name}
              maxLength={120}
              placeholder="Léo Perreaut"
              readOnly={busy}
              onChange={(e) => edit((f) => ({ ...f, name: e.target.value }))}
            />
          </label>

          <div className={styles.modalField}>
            <BilingualField
              label="Rôle"
              ids={{ fr: ROLE_FIELD_IDS.role, en: ROLE_FIELD_IDS.roleEn }}
              fields={{ fr: "role", en: "roleEn" }}
              errors={fieldErrors}
              values={{ fr: form.role, en: form.roleEn }}
              onChange={(lang, value) => edit((f) => (lang === "fr" ? { ...f, role: value } : { ...f, roleEn: value }))}
              maxLength={BUREAU_ROLE_MAX}
              readOnly={busy}
              placeholders={{ fr: "Président", en: "President" }}
              enMissing={editing !== null && !hasEnglish(editing.roleEn)}
              inputClassName={styles.modalInput}
              labelClassName={styles.modalLabel}
            />
          </div>

          <label className={styles.modalField}>
            <span className={styles.modalLabel}>Initiales (auto si vide)</span>
            <input
              className={styles.modalInput}
              value={form.initials}
              maxLength={4}
              placeholder={computeInitials(form.name) || "LP"}
              readOnly={busy}
              onChange={(e) => edit((f) => ({ ...f, initials: e.target.value }))}
            />
          </label>

          <div className={styles.modalActions}>
            <CyberButton variant="ghost" asChild>
              <BusyButton busy={false} blocked={busy} onClick={close}>
                Annuler
              </BusyButton>
            </CyberButton>
            <CyberButton variant="primary" asChild>
              <BusyButton busy={busy} onClick={() => void submit()}>
                <BusyLabel busy={busy} idle={submitLabel} pending={pendingLabel} />
              </BusyButton>
            </CyberButton>
          </div>
        </LandingDialog>
      )}
      {pendingRemoval ? (
        <ConfirmActionDialog
          title={`Retirer ${pendingRemoval.name} du bureau ?`}
          confirmLabel="Retirer du bureau"
          pendingLabel="Retrait…"
          contentLang={staffLang}
          onClose={() => setPendingRemoval(null)}
          onConfirm={() => remove(pendingRemoval)}
        >
          <p>
            {pendingRemoval.name} disparaît de la page Association, avec son rôle et sa présentation.
            La fiche ne se restaure pas : il faudrait la saisir à nouveau.
          </p>
        </ConfirmActionDialog>
      ) : null}
    </section>
  );
}
