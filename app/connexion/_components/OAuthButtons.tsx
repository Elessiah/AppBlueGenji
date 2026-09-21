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
import Link from "next/link";
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

export function OAuthButtons({ redirect }: { redirect: string }): React.ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {LOGIN_ORDER.map((provider, index) => (
        <div key={provider}>
          <CyberButton variant={index === 0 ? "primary" : "ghost"} asChild style={{ width: "100%" }}>
            <Link href={oauthStartPath(provider, { redirect })} prefetch={false}>
              Continuer avec {OAUTH_PROVIDER_LABELS[provider]}
            </Link>
          </CyberButton>
          {PROVIDER_NOTES[provider] ? (
            <p
              className="mono"
              id={`oauth-note-${OAUTH_PROVIDER_SLUGS[provider]}`}
              style={{
                fontSize: 10,
                color: "var(--ink-dim)",
                letterSpacing: "0.08em",
                lineHeight: 1.5,
                margin: "6px 0 0",
              }}
            >
              {PROVIDER_NOTES[provider]}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
