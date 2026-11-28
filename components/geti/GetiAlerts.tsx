"use client";

import { Bell } from "lucide-react";
import { useState, type ComponentType } from "react";
import { CyberButton } from "@/components/cyber";
import { useAppLocale } from "@/components/i18n/locale-context";
import { useToast } from "@/components/ui/toast";
import type { GetiAlert } from "@/lib/shared/geti/alerts";
import { getiText } from "@/lib/shared/geti/page-text";
import { isChunkLoadError, onceLoader } from "@/lib/shared/lazy-component";
import type { GetiAlertsDialogProps, GetiAlertsProps } from "./GetiAlertsDialog";
import styles from "./geti.module.css";

export type { GetiAlertsProps } from "./GetiAlertsDialog";

/** La fenêtre, chargée à la demande : une seule fois, un échec se retente au clic suivant (`onceLoader`). */
const dialogLoader = onceLoader<ComponentType<GetiAlertsDialogProps>>(() =>
  import("./GetiAlertsDialog").then((module) => module.GetiAlertsDialog),
);

/**
 * Bouton « Créer une alerte » et sa fenêtre : garder la catégorie et les
 * filtres affichés, et gérer ses alertes (pause, nom, suppression). Sans
 * compte connecté, la fenêtre mène à la connexion — une alerte est rattachée
 * au compte qui reçoit les notifications (`docs/features/GETI_INFO.md` § Alertes).
 *
 * La fenêtre (formulaire, liste, confirmation) n'est téléchargée qu'au premier
 * clic — ou dès le survol ou le focus du bouton — : la page est publique, la
 * plupart de ses lecteurs n'ouvrent jamais les alertes. Un morceau perdu
 * (déploiement entre la page et le clic) se dit par un toast, sans recharger
 * la page d'office.
 */
export function GetiAlerts(props: GetiAlertsProps) {
  const locale = useAppLocale();
  const { showError } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [alerts, setAlerts] = useState<readonly GetiAlert[]>(props.initialAlerts);
  const Dialog = open ? dialogLoader.loaded() : null;

  const openDialog = () => {
    if (dialogLoader.loaded()) {
      setOpen(true);
      return;
    }
    if (pending) return;
    setPending(true);
    dialogLoader
      .load()
      .then(() => setOpen(true))
      .catch((error: unknown) => {
        showError(getiText(locale, isChunkLoadError(error) ? props.text.reloading : props.text.loadFailed, {}));
      })
      .finally(() => setPending(false));
  };
  // Précharge au survol ou au focus (un échec ici se tait : le clic retente et le dit).
  const preload = () => void dialogLoader.load().catch(() => undefined);
  return (
    <>
      <CyberButton
        variant="ghost"
        className={styles.alertOpen}
        onClick={openDialog}
        onPointerEnter={(event) => {
          if (event.pointerType !== "touch") preload();
        }}
        onFocus={preload}
        aria-haspopup="dialog"
        aria-busy={pending || undefined}
        data-testid="geti-alert-open"
      >
        <Bell size={15} aria-hidden="true" />
        {props.text.button}
      </CyberButton>
      {Dialog ? <Dialog {...props} alerts={alerts} setAlerts={setAlerts} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
