"use client";

import { useState, type ComponentType, type CSSProperties } from "react";
import { useLocalePathname } from "@/components/i18n/locale-navigation";
import { useShellText } from "@/components/i18n/shell-text";
import { CyberButton } from "@/components/cyber";
import { useOptionalToast } from "@/components/ui/toast";
import type { ReportCategory } from "@/lib/shared/content-reports";
import { REPORT_FORM_NAME } from "@/lib/shared/legal-contact";
import { isChunkLoadError, reloadAfterChunkError } from "@/lib/shared/lazy-component";
import type { ReportProblemDialogProps } from "./ReportProblemDialog";

/**
 * Le formulaire, chargé **au clic** (lot 9-2) : le bouton est au pied de chaque
 * page, et le formulaire porte ses deux langues (`reports-text.ts`) — les
 * importer ici les aurait mises dans le premier chargement de tout le site.
 *
 * Chargement à la main plutôt que `next/dynamic` : un échec ne doit pas rester
 * en mémoire sous la forme d'un composant vide (le bouton ne ferait plus rien).
 * Le morceau part dès le survol ou le focus du bouton ; le bouton se dit occupé
 * (`aria-busy`) tant qu'il n'est pas arrivé ; un échec le dit (toast), se
 * retente au clic suivant, et un morceau disparu (déploiement entre la page et
 * le clic) recharge la page quand c'est sûr (`reloadAfterChunkError`).
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
  const { t } = useShellText();
  const toast = useOptionalToast();
  const openDialog = () => {
    if (ReportProblemDialog) {
      setOpen(true);
      return;
    }
    if (pending) return;
    setPending(true);
    loadDialog()
      .then((loaded) => {
        setDialog(() => loaded);
        setOpen(true);
      })
      .catch((error: unknown) => {
        if (isChunkLoadError(error)) reloadAfterChunkError();
        toast?.showError(t("footer.reportLoadFailed"));
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
  // Route sans préfixe de langue : la cible se reconnaît sous `/en/equipes/5`
  // comme sous `/equipes/5`, et le journal retient une seule adresse par page.
  const { path: pathname } = useLocalePathname();

  return (
    <>
      {cyber ? (
        <CyberButton variant="ghost" {...triggerProps}>
          {icon && <span aria-hidden="true">⚑</span>}
          {label}
        </CyberButton>
      ) : (
        <button {...triggerProps}>
          {icon && <span aria-hidden="true">⚑</span>}
          {label}
        </button>
      )}
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
