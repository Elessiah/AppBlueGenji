"use client";

/**
 * Les portes d'entrée OAuth de la page de connexion.
 *
 * **Un seul endroit, alors que la page en affiche deux.** Le bloc était recopié
 * dans les deux états de la carte (avant et après la demande d'un code Discord),
 * et les deux copies portaient chacune leur bouton Google : ajouter une porte y
 * demandait de penser à la seconde, faute de quoi la moitié des visiteurs n'en
 * voyait qu'une partie. La liste vient d'ailleurs du registre partagé
 * (`lib/shared/oauth-providers.ts`), donc même l'oubli d'un `<a>` n'est plus
 * possible.
 *
 * **Discord en tête** : c'est la porte qui enregistre le tag Discord au
 * passage, que le joueur n'a plus qu'à certifier d'un clic sur `/profil` s'il
 * veut être joignable. La phrase sous le bouton le dit avant le clic — qu'elle
 * **ne certifie pas**, et qui lirait le tag une fois certifié.
 */
import { CyberButton } from "@/components/cyber/CyberButton";
import { DISCORD_LOGIN_TAG_NOTICE } from "@/lib/shared/identity-sharing";
import { LOGIN_HELP_TEXT_STYLE } from "../_lib/login-styles";
import {
  OAUTH_PROVIDER_LABELS,
  OAUTH_PROVIDER_SLUGS,
  oauthStartPath,
  type OAuthProvider,
} from "@/lib/shared/oauth-providers";

/** Ordre d'affichage propre à cet écran, du plus complet au plus spécialisé. */
const LOGIN_ORDER: readonly OAuthProvider[] = ["DISCORD", "GOOGLE", "BLIZZARD"];

/** Ce que chaque porte apporte en plus d'une session, dit en une ligne. */
const PROVIDER_NOTES: Partial<Record<OAuthProvider, string>> = {
  DISCORD: DISCORD_LOGIN_TAG_NOTICE,
  BLIZZARD: "Renseigne ton BattleTag automatiquement.",
};

/** Identifiant de l'avertissement de contexte, relié à chaque bouton. */
const ENVIRONMENT_NOTICE_ID = "oauth-environment-notice";

export function OAuthButtons({
  redirect,
  termsAccepted,
  environmentNotice = null,
}: {
  redirect: string;
  /** Conditions d'utilisation acceptées dans la modale d'entrée de la page. */
  termsAccepted: boolean;
  /**
   * Avertissement quand le navigateur risque de perdre l'aller-retour OAuth
   * (app installée sur iOS, navigateur intégré) — `loginEnvironmentNotice`.
   * Ce n'est pas une erreur, rien n'a échoué : une note, pas un toast.
   */
  environmentNotice?: string | null;
}): React.ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {environmentNotice ? (
        <p
          role="note"
          id={ENVIRONMENT_NOTICE_ID}
          style={{
            fontSize: 12,
            color: "var(--ink)",
            lineHeight: 1.5,
            margin: 0,
            padding: "8px 10px",
            borderLeft: "2px solid var(--amber)",
            background: "var(--cyber-bg-2)",
          }}
        >
          {environmentNotice}
        </p>
      ) : null}
      {LOGIN_ORDER.map((provider, index) => {
        const note = PROVIDER_NOTES[provider];
        const noteId = `oauth-note-${OAUTH_PROVIDER_SLUGS[provider]}`;
        const describedBy = [environmentNotice ? ENVIRONMENT_NOTICE_ID : null, note ? noteId : null]
          .filter(Boolean)
          .join(" ");
        return (
          <div key={provider}>
            <CyberButton variant={index === 0 ? "primary" : "ghost"} asChild style={{ width: "100%" }}>
              {/*
                **Un `<a>`, surtout pas un `next/link`.** Une route de départ
                OAuth n'est pas une page de l'application, et la transition
                côté client de `Link` avait une conséquence qu'aucun test ne
                pouvait voir : la redirection de retour vers
                `/connexion?error=…` changeait l'URL **sans remonter la page**,
                si bien que l'effet qui lit `window.location.search` ne se
                rejouait pas — le joueur cliquait, revenait sur la même page, et
                aucun refus ne lui était annoncé. Vrai des cinq motifs, pas
                seulement de la configuration manquante.

                Pas d'`aria-label` non plus : le nom accessible d'un lien doit
                **contenir son texte visible** (WCAG 2.5.3), et un libellé posé à
                la main le remplacerait — la commande vocale ne répondrait plus à
                ce qu'on lit dessus. Ce que la note ajoute passe par
                `aria-describedby`, qui complète le nom au lieu de l'écraser.
              */}
              <a
                href={oauthStartPath(provider, { redirect, termsAccepted })}
                aria-describedby={describedBy || undefined}
              >
                Continuer avec {OAUTH_PROVIDER_LABELS[provider]}
              </a>
            </CyberButton>
            {note ? (
              <p id={noteId} style={{ ...LOGIN_HELP_TEXT_STYLE, margin: "6px 0 0" }}>
                {note}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
