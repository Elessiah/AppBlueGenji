"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { BusyButton } from "@/components/ui/busy-button";
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
import { arrowKey } from "@/lib/shared/arrow-refocus";
import { useArrowRefocus } from "@/lib/shared/hooks/useArrowRefocus";
import { useBusyGuard } from "@/lib/shared/hooks/useBusyGuard";
import { orReload } from "@/lib/shared/lazy-component";
import { DEFAULT_LOCALE, type Locale } from "@/lib/shared/locales";
import { BUSY_REFUSED_MESSAGE } from "./showcase-messages";
import styles from "./AboutStats.module.css";

// Chargée au premier clic sur « Ajouter » / « Modifier » : seul le staff
// l'ouvre, le code de ses champs ne part pas chez les autres visiteurs.
const AboutStatEditor = dynamic(
  () => orReload(import("./AboutStatEditor").then((m) => m.AboutStatEditor)),
  {
    ssr: false,
    // Retour visible pendant le chargement du morceau (réseau lent) : sans lui,
    // le clic sur « Modifier » semblait sans effet. Gestion en français (D4).
    loading: () => (
      <output className={styles.editorLoading} lang="fr">
        Ouverture de l&apos;éditeur…
      </output>
    ),
  },
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
  const showInfo = (message: string) => toast.showInfo(message, staffToast);
  const [stats, setStats] = useState<AboutStat[]>(initialStats);
  // Sous `/en`, un chiffre sans titre anglais n'est pas rendu.
  const shown = useMemo(() => localizedAboutStats(stats, locale), [stats, locale]);
  // `undefined` : modale fermée ; `null` : création ; une carte : modification.
  const [editing, setEditing] = useState<AboutStat | null | undefined>(undefined);
  // Un envoi à la fois (déplacer, supprimer) : garde synchrone, boutons
  // focalisables pendant l'attente (`BUSY_BUTTONS.md`). Un double clic sur une
  // flèche partait deux fois, chaque envoi calculé sur l'ordre d'avant l'autre.
  const { busy, isBusy, run } = useBusyGuard();
  const refocusArrow = useArrowRefocus("stat");

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

    await run(async () => {
      const previous = stats;
      const reordered = [...stats];
      [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
      const id = stats[index].id;
      const arrow = direction < 0 ? "up" : "down";
      setStats(reordered);
      refocusArrow(id, arrow);
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
          refocusArrow(id, arrow);
          return;
        }
        showSuccess("Ordre des cartes mis à jour.");
      } catch {
        showError("Erreur réseau, réessaye.");
        setStats(previous);
        refocusArrow(id, arrow);
      }
    });
  }

  const [pendingRemoval, setPendingRemoval] = useState<AboutStat | null>(null);

  async function remove(stat: AboutStat): Promise<boolean> {
    const done = await run(async () => {
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
        return false;
      }
    });
    if (done === undefined) showInfo(BUSY_REFUSED_MESSAGE);
    return done ?? false;
  }

  // Ouvrir la fenêtre ou la confirmation pendant un envoi changerait l'écran
  // sous la requête : le geste parti dans la même image est ignoré.
  const openEditor = (stat: AboutStat | null) => {
    if (!isBusy()) setEditing(stat);
  };

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
                      <BusyButton
                        busy={busy}
                        blocked={index === 0}
                        className={`${styles.action} ${styles.moveAction}`}
                        onClick={() => void move(index, -1)}
                        data-arrow={arrowKey("stat", s.id, "up")}
                        data-edge={index === 0 || undefined}
                        aria-label={`Déplacer la carte ${s.label} vers la gauche`}
                        title="Déplacer avant"
                      >
                        ↑
                      </BusyButton>
                      <BusyButton
                        busy={busy}
                        blocked={index === stats.length - 1}
                        className={`${styles.action} ${styles.moveAction}`}
                        onClick={() => void move(index, 1)}
                        data-arrow={arrowKey("stat", s.id, "down")}
                        data-edge={index === stats.length - 1 || undefined}
                        aria-label={`Déplacer la carte ${s.label} vers la droite`}
                        title="Déplacer après"
                      >
                        ↓
                      </BusyButton>
                    </>
                  )}
                  <BusyButton
                    busy={busy}
                    className={styles.action}
                    onClick={() => openEditor(s)}
                    aria-label={withEnglishMissing(`Modifier la carte ${s.label}`, needsEnglish)}
                  >
                    Modifier
                    {needsEnglish && <EnglishMissingMark />}
                  </BusyButton>
                  <BusyButton
                    busy={busy}
                    className={`${styles.action} ${styles.actionDanger}`}
                    onClick={() => {
                      if (!isBusy()) setPendingRemoval(s);
                    }}
                    aria-label={`Supprimer la carte ${s.label}`}
                  >
                    Supprimer
                  </BusyButton>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isAdmin && (
        <BusyButton busy={busy} className={styles.addBtn} onClick={() => openEditor(null)} lang={staffLang}>
          + Ajouter une carte
        </BusyButton>
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
