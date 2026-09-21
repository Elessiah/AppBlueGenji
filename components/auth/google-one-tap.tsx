"use client";

/**
 * Google One Tap : invite automatique de connexion, rendue par le script
 * `accounts.google.com/gsi/client` — chargé ici, jamais ailleurs, pour qu'il
 * n'y ait qu'un seul endroit à revoir si Google en change les termes.
 *
 * Le composant ne s'affiche que pour un visiteur **sans session** : c'est la
 * mise en page racine qui le décide (elle seule connaît `getCurrentUser()`) et
 * le rend, ou non — jamais un `if` côté client, qui laisserait le script
 * chargé pour rien à chaque visite d'un membre déjà connecté.
 *
 * Le jeton (`credential`) que Google rend au navigateur est un JWT signé, pas
 * une preuve pour notre serveur : il doit être vérifié avant d'ouvrir quoi que
 * ce soit (`verifyGoogleOneTapCredential`, côté serveur). Ce composant ne fait
 * que le transmettre à `/api/auth/google/one-tap` et réagir à la réponse.
 */
import Script from "next/script";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { safeRedirectPath } from "@/lib/shared/safe-redirect";

type CredentialResponse = { credential?: string };

type GoogleAccountsId = {
  initialize: (config: {
    client_id: string;
    callback: (response: CredentialResponse) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    itp_support?: boolean;
  }) => void;
  prompt: () => void;
};

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

export function GoogleOneTap({ clientId, nonce }: { clientId: string; nonce?: string }) {
  const router = useRouter();
  // Un seul `initialize` par montage : le script peut se recharger sur une
  // navigation client sans que l'effet ne reparte, React 18 `StrictMode` en
  // développement l'exécutant même deux fois pour un seul montage réel.
  const initialized = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let pollId: number | undefined;

    const start = () => {
      if (initialized.current || cancelled || !window.google) return;
      initialized.current = true;

      window.google.accounts.id.initialize({
        client_id: clientId,
        // Le joueur qui a fermé l'invite (ou s'est déjà déconnecté volontairement)
        // ne doit pas la revoir surgir toute seule à la visite suivante.
        auto_select: false,
        cancel_on_tap_outside: true,
        callback: async (response) => {
          if (!response.credential) return;
          try {
            const res = await fetch("/api/auth/google/one-tap", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ credential: response.credential }),
            });
            if (!res.ok) return;

            // Sur `/connexion`, un `?redirect=` attend d'être honoré, comme pour
            // les trois autres portes. Ailleurs, il n'y en a pas : on reste sur
            // la page, `router.refresh()` suffisant à y refléter la session.
            const redirectParam = new URLSearchParams(window.location.search).get("redirect");
            if (redirectParam) router.push(safeRedirectPath(redirectParam));
            router.refresh();
          } catch {
            // Échec silencieux : le joueur garde les portes habituelles de
            // `/connexion`, et rien ne doit interrompre la page qu'il consulte.
          }
        },
      });
      window.google.accounts.id.prompt();
    };

    if (window.google) {
      start();
    } else {
      // Le composant peut monter avant que le script externe n'ait fini de
      // charger (ordre de rendu, connexion lente) : on attend son arrivée
      // plutôt que de dépendre d'un ordre précis avec `<Script onLoad>`, qui ne
      // se déclenche pas de façon fiable sur une navigation client.
      pollId = window.setInterval(() => {
        if (window.google) {
          window.clearInterval(pollId);
          start();
        }
      }, 200);
    }

    return () => {
      cancelled = true;
      if (pollId !== undefined) window.clearInterval(pollId);
    };
  }, [clientId, router]);

  return <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" nonce={nonce} />;
}
