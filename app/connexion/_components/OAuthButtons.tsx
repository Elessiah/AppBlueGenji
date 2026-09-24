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
 * **Discord en tête, et ce n'est pas décoratif** : c'est la seule porte qui
 * certifie le tag au passage, donc celle qui évite au joueur une démarche
 * ultérieure sur `/profil`. La phrase sous le bouton le dit avant le clic —
 * annoncer l'exposition après coup serait la subir.
 */
import { CyberButton } from "@/components/cyber/CyberButton";
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
  DISCORD: "Certifie ton tag Discord : l'organisation peut te joindre pendant un tournoi.",
  BLIZZARD: "Renseigne ton BattleTag automatiquement.",
};

export function OAuthButtons({
  redirect,
  termsAccepted,
}: {
  redirect: string;
  /** Conditions d'utilisation acceptées dans la modale d'entrée de la page. */
  termsAccepted: boolean;
}): React.ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {LOGIN_ORDER.map((provider, index) => {
        const note = PROVIDER_NOTES[provider];
        const noteId = `oauth-note-${OAUTH_PROVIDER_SLUGS[provider]}`;
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
                aria-describedby={note ? noteId : undefined}
              >
                Continuer avec {OAUTH_PROVIDER_LABELS[provider]}
              </a>
            </CyberButton>
            {note ? (
              <p
                className="mono"
                id={noteId}
                style={{
                  fontSize: 10,
                  color: "var(--ink-dim)",
                  letterSpacing: "0.08em",
                  lineHeight: 1.5,
                  margin: "6px 0 0",
                }}
              >
                {note}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
