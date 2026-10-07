"use client";

import { useEffect, useState } from "react";
import { CyberButton } from "@/components/cyber";
import { useToast } from "@/components/ui/toast";
import { browserAudienceOptOut } from "@/components/visit-tracker";
import {
  audienceOptOutCookieString,
  strongerAudienceOptOut,
  type AudienceOptOutReason,
} from "@/lib/shared/site-visits";

/**
 * Textes du contrôle, dans la langue de la page (`legal.audience`, lot 7b-2).
 * Le français est inclus ici (page française, aucun dictionnaire envoyé) ;
 * `/en/rgpd` passe l'anglais en prop. Égalité avec `messages/fr/legal.json` testée.
 */
export type AudienceOptOutText = {
  status: { GPC: string; DNT: string; CHOICE: string; measured: string };
  fieldset: string;
  optOut: string;
  reactivate: string;
  optedOut: string;
  reactivated: string;
  blocked: string;
};

export const AUDIENCE_OPT_OUT_TEXT_FR: AudienceOptOutText = {
  status: {
    GPC: "Votre navigateur envoie le signal Global Privacy Control : vos visites ne sont pas mesurées. Ce signal se règle dans votre navigateur, pas sur le site.",
    DNT: "Votre navigateur envoie le signal Do Not Track : vos visites ne sont pas mesurées. Ce signal se règle dans votre navigateur, pas sur le site.",
    CHOICE: "Vous vous êtes opposé à la mesure d'audience : vos visites ne sont ni signalées au serveur, ni enregistrées, depuis ce navigateur.",
    measured: "Vos visites sont actuellement mesurées, comme décrit ci-dessus.",
  },
  fieldset: "Mesure d'audience",
  optOut: "M'opposer à la mesure d'audience",
  reactivate: "Réactiver la mesure d'audience",
  optedOut: "Vos visites ne seront plus mesurées.",
  reactivated: "La mesure d'audience est réactivée.",
  blocked: "Votre navigateur bloque les cookies : le choix n'a pas pu être retenu.",
};

/** Phrase d'état, une par situation : ce qui est mesuré, et ce qui le décide. */
export function audienceOptOutStatus(reason: AudienceOptOutReason | null, text: AudienceOptOutText = AUDIENCE_OPT_OUT_TEXT_FR): string {
  switch (reason) {
    case "GPC":
      return text.status.GPC;
    case "DNT":
      return text.status.DNT;
    case "CHOICE":
      return text.status.CHOICE;
    default:
      return text.status.measured;
  }
}

/**
 * Bouton d'opposition à la mesure d'audience (`/rgpd#audience`), et de retour
 * sur ce choix. Le choix vit dans un cookie sans identifiant
 * (`bg_audience_optout`), que le serveur relit aussi. Un signal du navigateur
 * (GPC, DNT) l'emporte et ne se lève pas d'ici : le bouton disparaît alors, la
 * phrase dit où se règle le signal.
 *
 * @param initialReason État lu par le serveur sur la requête de la page, pour
 * que la phrase soit juste dès le premier affichage.
 * @param text Textes de la langue de la page — le français par défaut.
 */
export function AudienceOptOutControl({
  initialReason,
  text = AUDIENCE_OPT_OUT_TEXT_FR,
}: Readonly<{ initialReason: AudienceOptOutReason | null; text?: AudienceOptOutText }>) {
  const [reason, setReason] = useState<AudienceOptOutReason | null>(initialReason);
  const { showError, showSuccess } = useToast();

  // Le navigateur peut exposer un signal que la requête ne portait pas — mais
  // ne fait que renforcer : un `Sec-GPC` envoyé sans `navigator.globalPrivacyControl`
  // (extension qui ne pose que l'en-tête), ou un cookie illisible d'ici, reste
  // un refus côté serveur, et un simple cookie ne l'éclipse pas.
  // Un signal lu par le serveur dans les en-têtes, que la page ne voit peut-être
  // pas : il reste en vigueur quoi que dise le navigateur.
  const headerSignal = initialReason === "GPC" || initialReason === "DNT" ? initialReason : null;

  useEffect(() => {
    setReason((current) => strongerAudienceOptOut(current, browserAudienceOptOut()));
  }, []);

  const toggle = (optOut: boolean) => {
    try {
      document.cookie = audienceOptOutCookieString(optOut, window.location.protocol === "https:");
    } catch {
      showError(text.blocked);
      return;
    }
    const read = browserAudienceOptOut();
    setReason(strongerAudienceOptOut(headerSignal, read));
    // Relu dans les deux sens : un cookie qui ne se pose pas, ou qui ne s'efface
    // pas (écriture ignorée par le navigateur), ne doit pas être annoncé fait.
    if ((optOut && read === null) || (!optOut && read === "CHOICE")) {
      showError(text.blocked);
      return;
    }
    showSuccess(optOut ? text.optedOut : text.reactivated);
  };

  const browserSignal = reason === "GPC" || reason === "DNT";
  return (
    <fieldset className="native-group" aria-label={text.fieldset} style={{ display: "grid", gap: 12, justifyItems: "start" }}>
      <p id="audience-opt-out-status" aria-live="polite" style={{ margin: 0 }}>
        {audienceOptOutStatus(reason, text)}
      </p>
      {!browserSignal && (
        <CyberButton
          type="button"
          variant="ghost"
          aria-describedby="audience-opt-out-status"
          onClick={() => toggle(reason !== "CHOICE")}
        >
          {reason === "CHOICE" ? text.reactivate : text.optOut}
        </CyberButton>
      )}
    </fieldset>
  );
}
