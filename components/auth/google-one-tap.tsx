"use client";

/**
 * Google One Tap : invite automatique de connexion, rendue par le script
 * `accounts.google.com/gsi/client` — chargé ici, jamais ailleurs, pour qu'il
 * n'y ait qu'un seul endroit à revoir si Google en change les termes.
 *
 * Le composant n'est monté que par **`/connexion`**, pour un visiteur **sans
 * session** et **après** son consentement (`app/connexion/_components/LoginForm.tsx`).
 * Il était auparavant monté par la mise en page racine, donc chargé sur chaque
 * page pour tout visiteur anonyme : Google recevait l'IP et la page consultée,
 * et pouvait poser son cookie `g_state` sur notre domaine, sans que personne
 * n'ait rien demandé. Ne pas le remonter ailleurs sans repasser par `/rgpd`.
 *
 * Le jeton (`credential`) que Google rend au navigateur est un JWT signé, pas
 * une preuve pour notre serveur : il doit être vérifié avant d'ouvrir quoi que
 * ce soit (`verifyGoogleOneTapCredential`, côté serveur). Ce composant ne fait
 * que le transmettre à `/api/auth/google/one-tap` et réagir à la réponse.
 */
import Script from "next/script";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

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
  cancel: () => void;
};

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

export function GoogleOneTap({
  clientId,
  nonce,
  redirect,
}: {
  clientId: string;
  nonce?: string;
  /** Destination d'après connexion, **déjà filtrée** par `safeRedirectPath`. */
  redirect: string;
}) {
  const router = useRouter();
  // Relue au moment de la réponse de Google, pas figée à l'`initialize` : la
  // page lit son `?redirect=` dans un effet, et l'invite ne s'initialise qu'une fois.
  const redirectRef = useRef(redirect);
  redirectRef.current = redirect;
  const { showError, showSuccess } = useToast();
  // Un seul `initialize` par montage : le script peut se recharger sur une
  // navigation client sans que l'effet ne reparte. Le nettoyage le remet à
  // `false` après avoir retiré l'invite, si bien que le second passage de
  // `StrictMode` en développement la repose au lieu de la laisser retirée.
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
            if (!res.ok) {
              // Un jeton qui échoue la vérification ne casse rien : le joueur
              // garde les portes habituelles de `/connexion`. On le dit quand
              // même — même règle que les trois autres portes — plutôt que de
              // laisser l'invite disparaître sans explication.
              showError("La connexion via Google n'a pas pu être vérifiée. Réessaie, ou utilise un autre moyen de connexion.");
              return;
            }

            showSuccess("Connexion réussie via Google.");
            // Même destination que les trois autres portes de la page.
            router.push(redirectRef.current);
            router.refresh();
          } catch {
            // Échec réseau : même silence que la panne d'un bouton OAuth
            // classique — rien à afficher tant qu'on ne sait pas si la requête
            // a seulement échoué à partir.
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
      // Le script survit à une navigation client, et son invite avec : sans ce
      // retrait, elle suivrait le visiteur hors de `/connexion`, sur des pages
      // où le site ne doit plus rien afficher de Google.
      if (initialized.current) {
        window.google?.accounts.id.cancel();
        initialized.current = false;
      }
    };
  }, [clientId, router, showError, showSuccess]);

  return <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" nonce={nonce} />;
}
