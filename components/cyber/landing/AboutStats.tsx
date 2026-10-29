"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { EnglishMissingMark, withEnglishMissing } from "@/components/ui/bilingual-field";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { useToast } from "@/components/ui/toast";
import {
  type AboutStat,
  aboutStatNeedsEnglish,
  aboutStatValueIsFrench,
  FALLBACK_ABOUT_STATS,
  localizedAboutStats,
} from "@/lib/shared/about-stats";
import { orReload } from "@/lib/shared/lazy-component";
import { DEFAULT_LOCALE, type Locale } from "@/lib/shared/locales";
import styles from "./AboutStats.module.css";

// Chargée au premier clic sur « Ajouter » / « Modifier » : seul le staff
// l'ouvre, le code de ses champs ne part pas chez les autres visiteurs.
const AboutStatEditor = dynamic(
  () => orReload(import("./AboutStatEditor").then((m) => m.AboutStatEditor)),
  { ssr: false },
);

interface AboutStatsProps {
  initialStats: AboutStat[];
  isAdmin: boolean;
  /** Langue de la page : sous `/en`, seuls les chiffres traduits sont rendus. */
  locale?: Locale;
}

export function AboutStats({ initialStats, isAdmin, locale = DEFAULT_LOCALE }: Readonly<AboutStatsProps>) {
  // La gestion reste en français (D4) : sous `/en`, ses contrôles, sa fenêtre
  // et ses notifications le disent (`lang="fr"`).
  const staffLang = locale === DEFAULT_LOCALE ? undefined : "fr";
  const toast = useToast();
  const staffToast = staffLang ? { lang: staffLang } : undefined;
  const showError = (message: string) => toast.showError(message, staffToast);
  const showSuccess = (message: string) => toast.showSuccess(message, staffToast);
  const [stats, setStats] = useState<AboutStat[]>(initialStats);
  // Sous `/en`, un chiffre sans titre anglais n'est pas rendu.
  const shown = useMemo(() => localizedAboutStats(stats, locale), [stats, locale]);
  // `undefined` : modale fermée ; `null` : création ; une carte : modification.
  const [editing, setEditing] = useState<AboutStat | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  // Les cartes de secours (id négatif) ne sont pas en base : non modifiables.
  const canManage = (s: AboutStat) => isAdmin && s.id > 0;

  function saved(stat: AboutStat, created: boolean) {
    if (created) {
      // Si on partait des cartes de secours, on bascule sur la liste réelle.
      setStats((prev) => [...prev.filter((s) => s.id > 0), stat]);
      showSuccess("Carte ajoutée.");
    } else {
      setStats((prev) => prev.map((s) => (s.id === stat.id ? stat : s)));
      showSuccess("Carte mise à jour.");
    }
    setEditing(undefined);
  }

  // Déplace une carte d'un cran (direction -1 = vers la gauche/le haut, +1 = vers
  // la droite/le bas) et persiste le nouvel ordre. Optimiste avec rollback.
  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= stats.length) return;

    const previous = stats;
    const reordered = [...stats];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setStats(reordered);

    setBusy(true);
    try {
      const res = await fetch("/api/association/about-stats/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: reordered.map((s) => s.id) }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        showError(data.error ? `Échec : ${data.error}` : "Échec du réordonnancement.");
        setStats(previous);
        return;
      }
      showSuccess("Ordre des cartes mis à jour.");
    } catch {
      showError("Erreur réseau, réessaye.");
      setStats(previous);
    } finally {
      setBusy(false);
    }
  }

  const [pendingRemoval, setPendingRemoval] = useState<AboutStat | null>(null);

  async function remove(stat: AboutStat): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(`/api/association/about-stats/${stat.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        showError(data.error ? `Échec : ${data.error}` : "Échec de la suppression.");
        return false;
      }
      // Si plus aucune carte réelle, réafficher les cartes de secours — c'est ce
      // que renverrait un rechargement (table vide → FALLBACK_ABOUT_STATS).
      setStats((prev) => {
        const next = prev.filter((s) => s.id !== stat.id);
        return next.length === 0 ? FALLBACK_ABOUT_STATS : next;
      });
      showSuccess("Carte supprimée.");
      return true;
    } catch {
      showError("Erreur réseau, réessaye.");
    } finally {
      setBusy(false);
    }
    return false;
  }

  return (
    <>
      <div className={styles.stats}>
        {shown.map(({ stat: s, value, label, index }) => {
          // Une fois par carte et par rendu : nom accessible et marque s'en servent.
          const needsEnglish = canManage(s) && aboutStatNeedsEnglish(s);
          return (
            <div key={s.id} className={styles.stat}>
              {/* Sous /en, une valeur sans anglais qui porte des mots reste française : le lecteur d'écran la prononce en français. */}
              <div className="num" style={{ fontSize: 26 }} lang={aboutStatValueIsFrench(s, locale) ? "fr" : undefined}>
                {value}
              </div>
              <div className="mono">{label}</div>
              {canManage(s) && (
                <div className={styles.statActions} lang={staffLang}>
                  {/* Ordre réglé en français seulement : sous /en, des voisins sans anglais sont masqués. */}
                  {locale === DEFAULT_LOCALE && (
                    <>
                      <button
                        type="button"
                        className={`${styles.action} ${styles.moveAction}`}
                        onClick={() => move(index, -1)}
                        disabled={busy || index === 0}
                        aria-label={`Déplacer la carte ${s.label} vers la gauche`}
                        title="Déplacer avant"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className={`${styles.action} ${styles.moveAction}`}
                        onClick={() => move(index, 1)}
                        disabled={busy || index === stats.length - 1}
                        aria-label={`Déplacer la carte ${s.label} vers la droite`}
                        title="Déplacer après"
                      >
                        ↓
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className={styles.action}
                    onClick={() => setEditing(s)}
                    disabled={busy}
                    aria-label={withEnglishMissing(`Modifier la carte ${s.label}`, needsEnglish)}
                  >
                    Modifier
                    {needsEnglish && <EnglishMissingMark />}
                  </button>
                  <button
                    type="button"
                    className={`${styles.action} ${styles.actionDanger}`}
                    onClick={() => setPendingRemoval(s)}
                    disabled={busy}
                    aria-label={`Supprimer la carte ${s.label}`}
                  >
                    Supprimer
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isAdmin && (
        <button type="button" className={styles.addBtn} onClick={() => setEditing(null)} disabled={busy} lang={staffLang}>
          + Ajouter une carte
        </button>
      )}

      {editing !== undefined && (
        <AboutStatEditor
          key={editing?.id ?? "new"}
          editing={editing}
          staffLang={staffLang}
          onClose={() => setEditing(undefined)}
          onSaved={saved}
        />
      )}
      {pendingRemoval ? (
        <ConfirmActionDialog
          title={`Supprimer le chiffre « ${pendingRemoval.value} · ${pendingRemoval.label} » ?`}
          confirmLabel="Supprimer le chiffre"
          pendingLabel="Suppression…"
          contentLang={staffLang}
          onClose={() => setPendingRemoval(null)}
          onConfirm={() => remove(pendingRemoval)}
        >
          <p>
            Ce chiffre disparaît de la section « À propos » de l&apos;accueil. Il ne se restaure pas :
            il faudrait le saisir à nouveau.
          </p>
        </ConfirmActionDialog>
      ) : null}
    </>
  );
}
