"use client";

import { useEffect, useRef, useState, type ComponentType, type CSSProperties } from "react";
import { useLocalePathname } from "@/components/i18n/locale-navigation";
import { useShellText } from "@/components/i18n/shell-text";
import { CyberButton } from "@/components/cyber";
import { useOptionalToast } from "@/components/ui/toast";
import type { ReportCategory } from "@/lib/shared/content-reports";
import { REPORT_FORM_NAME } from "@/lib/shared/legal-contact";
import { isChunkLoadError } from "@/lib/shared/lazy-component";
import type { ReportProblemDialogProps } from "./ReportProblemDialog";

/**
 * Le formulaire, chargé **au clic** (lot 9-2) : le bouton est au pied de chaque
 * page, et le formulaire porte ses deux langues (`reports-text.ts`) — les
 * importer ici les aurait mises dans le premier chargement de tout le site.
 *
 * Chargement à la main plutôt que `next/dynamic` : un échec ne doit pas rester
 * en mémoire sous la forme d'un composant vide (le bouton ne ferait plus rien).
 * Le morceau part dès le survol ou le focus du bouton ; le bouton se dit occupé
 * (`aria-busy`, « … », région d'état) tant qu'il n'est pas arrivé ; un échec
 * le dit (toast) et se retente au clic suivant. Un morceau disparu (déploiement
 * entre la page et le clic) invite à recharger la page, sans la recharger
 * d'office : une saisie en cours ailleurs sur la page serait perdue.
 */
type Dialog = ComponentType<ReportProblemDialogProps>;
let loadedDialog: Dialog | null = null;
let dialogLoad: Promise<Dialog> | null = null;

/** Un seul chargement, partagé par le préchargement et l'ouverture ; un échec se retente. */
function loadDialog(): Promise<Dialog> {
  dialogLoad ??= import("./ReportProblemDialog").then(
    (module) => (loadedDialog = module.ReportProblemDialog),
    (error: unknown) => {
      dialogLoad = null;
      throw error;
    },
  );
  return dialogLoad;
}
const preloadDialog = () => {
  loadDialog().catch(() => undefined);
};
const BUSY_STYLE: CSSProperties = { cursor: "progress" };

interface ReportProblemButtonProps {
  /** Visiteur connecté : il peut désigner des cibles par leur nom. */
  authenticated: boolean;
  className?: string;
  /** Pictogramme de drapeau devant le libellé (décoratif). */
  icon?: boolean;
  /** Catégorie ouverte d'office (voir `ReportProblemDialog`). */
  initialCategory?: Exclude<ReportCategory, "CONTEST">;
  /** Libellé du bouton, « Signaler un problème » par défaut. */
  label?: string;
  /** Bouton du système de design (`CyberButton` fantôme) plutôt que le lien discret des pieds de page. */
  cyber?: boolean;
}

/**
 * Déclencheur du formulaire « Signaler un problème », posé dans les pieds de
 * page (vitrine, espace connecté, connexion) — donc présent sur toutes les
 * pages, comme la notification d'un contenu illicite doit l'être.
 *
 * Un `<button>` et non un lien : il n'y a pas de page de signalement, le
 * formulaire s'ouvre là où l'on est — et c'est cette page-là qu'il retient.
 */
export function ReportProblemButton({
  authenticated,
  className,
  icon = false,
  initialCategory,
  label = REPORT_FORM_NAME,
  cyber = false,
}: Readonly<ReportProblemButtonProps>) {
  const [open, setOpen] = useState(false);
  const [ReportProblemDialog, setDialog] = useState<Dialog | null>(() => loadedDialog);
  const [pending, setPending] = useState(false);
  // Ce que la région d'état annonce : l'attente, puis l'échec (aussi dit hors toast).
  const [status, setStatus] = useState("");
  const { t } = useShellText();
  // Toujours posé par la mise en page racine ; `null` seulement pour un pied de
  // page rendu seul (tests) : l'échec reste alors dit par la région d'état.
  const toast = useOptionalToast();
  // Route sans préfixe de langue : la cible se reconnaît sous `/en/equipes/5`
  // comme sous `/equipes/5`, et le journal retient une seule adresse par page.
  const { path: pathname } = useLocalePathname();
  // Le pied de page survit à une navigation : un formulaire arrivé après que
  // le lecteur a changé de page ne s'ouvre pas sur la nouvelle.
  const currentPath = useRef(pathname);
  useEffect(() => {
    currentPath.current = pathname;
  }, [pathname]);

  const openDialog = () => {
    // Déjà là : chargé par un autre bouton, ou préchargé au survol.
    const ready = ReportProblemDialog ?? loadedDialog;
    if (ready) {
      setDialog(() => ready);
      setOpen(true);
      return;
    }
    if (pending) return;
    setPending(true);
    setStatus(t("footer.reportLoading"));
    const clickedOn = pathname;
    loadDialog()
      .then((loaded) => {
        setDialog(() => loaded);
        setStatus("");
        // Le lecteur est passé à une autre page entre-temps : le geste est caduc
        // (le formulaire retiendrait la nouvelle page) ; le bouton, toujours au
        // pied, rouvre aussitôt le formulaire, désormais chargé.
        if (currentPath.current === clickedOn) setOpen(true);
      })
      .catch((error: unknown) => {
        const message = t(isChunkLoadError(error) ? "footer.reportReloading" : "footer.reportLoadFailed");
        setStatus(message);
        toast?.showError(message);
      })
      .finally(() => setPending(false));
  };
  const triggerProps = {
    type: "button" as const,
    className,
    onClick: openDialog,
    onPointerEnter: preloadDialog,
    onFocus: preloadDialog,
    "aria-haspopup": "dialog" as const,
    "aria-busy": pending || undefined,
    style: pending ? BUSY_STYLE : undefined,
  };
  // Le chargement se voit (points de suspension) et s'annonce (région d'état,
  // toujours présente pour qu'un lecteur d'écran lise son changement).
  const busyMark = pending ? <span aria-hidden="true">…</span> : null;

  return (
    <>
      {cyber ? (
        <CyberButton variant="ghost" {...triggerProps}>
          {icon && <span aria-hidden="true">⚑</span>}
          {label}
          {busyMark}
        </CyberButton>
      ) : (
        <button {...triggerProps}>
          {icon && <span aria-hidden="true">⚑</span>}
          {label}
          {busyMark}
        </button>
      )}
      <output className="sr-only">{status}</output>
      {open && ReportProblemDialog && (
        <ReportProblemDialog
          pathname={pathname}
          authenticated={authenticated}
          initialCategory={initialCategory}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
