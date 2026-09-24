"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { CyberButton } from "@/components/cyber/CyberButton";
import { CyberCard } from "@/components/cyber/CyberCard";
import { RgpdConsentModal } from "@/components/cyber/RgpdConsentModal";
import { DEFAULT_REDIRECT, safeRedirectPath } from "@/lib/shared/safe-redirect";
import { GoogleOneTap } from "@/components/auth/google-one-tap";
import { loginErrorMessage, oauthErrorMessage } from "../_lib/login-errors";
import { OAuthButtons } from "./OAuthButtons";
import { DISCORD_INVITE_URL } from "@/lib/shared/discord";
import { isCertifiableDiscordHandle } from "@/lib/shared/discord-identity";
import {
  DISCORD_CERTIFICATION_UNDO,
  DISCORD_TAG_AUDIENCE,
} from "@/lib/shared/identity-sharing";

const CONSENT_STORAGE_KEY = "bg_rgpd_consent";

/** Ce qu'il faut à l'invite Google One Tap, résolu côté serveur par `page.tsx`. */
export type OneTapConfig = { clientId: string; nonce?: string };

/**
 * Formulaire de connexion.
 *
 * `oneTap` vaut `null` quand l'invite n'a pas lieu d'être (visiteur déjà
 * connecté, `GOOGLE_CLIENT_ID` absent). Sinon l'invite n'est montée qu'une fois
 * le consentement **lu et accordé** : c'est la seule page du site qui fasse
 * charger un script de Google, et elle ne le fait qu'à qui est venu se
 * connecter et l'a accepté.
 */
export function LoginForm({ oneTap }: { oneTap: OneTapConfig | null }) {
  const router = useRouter();
  const { showError, showSuccess } = useToast();
  // Destination d'après connexion. Toujours **filtrée** : la valeur vient de
  // l'URL, et une redirection ouverte est l'appât classique du hameçonnage
  // (`lib/shared/safe-redirect.ts`).
  const [redirect, setRedirect] = useState(DEFAULT_REDIRECT);

  const [handle, setHandle] = useState("");
  const [resolvedId, setResolvedId] = useState("");
  const [pseudo, setPseudo] = useState("");
  const [code, setCode] = useState("");
  const [requested, setRequested] = useState(false);
  // Le champ « pseudo site » ne sert qu'à la création du compte : on ne
  // l'affiche que si le compte Discord n'est pas encore rattaché au site.
  const [isNewAccount, setIsNewAccount] = useState(true);
  const [loading, setLoading] = useState(false);
  // Consentement RGPD requis avant toute création de compte. Tant qu'il n'est
  // pas accordé, la carte de connexion est masquée derrière la popup et aucune
  // requête d'authentification n'est déclenchée.
  const [consentGiven, setConsentGiven] = useState(true);
  // `consentGiven` part à `true` pour ne pas faire clignoter la modale au
  // premier rendu : il ne dit donc rien tant que le stockage n'a pas été lu.
  // L'invite Google attend cette lecture — montée sur la valeur initiale, elle
  // ferait partir le script chez Google avant même qu'on sache si le visiteur a
  // consenti.
  const [consentRead, setConsentRead] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    } catch {
      // localStorage indisponible (mode privé) : la modale redemande.
    }
    setConsentGiven(stored === "1");
    setConsentRead(true);
  }, []);

  const acceptConsent = () => {
    try {
      window.localStorage.setItem(CONSENT_STORAGE_KEY, "1");
    } catch {
      // localStorage indisponible (mode privé) : on continue en mémoire.
    }
    setConsentGiven(true);
  };

  const refuseConsent = () => {
    // Retour en arrière total : aucune donnée n'a été enregistrée.
    router.push("/");
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    setRedirect(safeRedirectPath(params.get("redirect")));
    // Le refus vient du module partagé, qui compose la phrase depuis le motif
    // (`?error=`) et le fournisseur (`?provider=`). Les cinq codes écrits ici en
    // dur ne parlaient que de Google : la troisième porte en aurait fait quinze.
    const message = oauthErrorMessage(params.get("error"), params.get("provider"));
    if (message) showError(message);
  }, [showError]);

  const requestCode = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      const response = await fetch("/api/auth/discord/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle }),
      });
      const payload = (await response.json()) as {
        error?: string;
        expiresAt?: string;
        discordId?: string;
        isNewAccount?: boolean;
      };
      if (!response.ok) throw new Error(loginErrorMessage(payload.error || "FAILED"));
      setResolvedId(payload.discordId || "");
      setIsNewAccount(payload.isNewAccount !== false);
      if (payload.isNewAccount === false) setPseudo("");
      setRequested(true);
      showSuccess(`Code envoyé en DM Discord (expiration : ${new Date(payload.expiresAt || "").toLocaleTimeString()}).`);
    } catch (e) {
      showError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      const response = await fetch("/api/auth/discord/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ discordId: resolvedId, code, pseudo: isNewAccount ? pseudo : undefined }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(loginErrorMessage(payload.error || "FAILED"));
      router.push(redirect);
      router.refresh();
    } catch (e) {
      showError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", position: "relative" }}>
      {oneTap && consentRead && consentGiven && (
        <GoogleOneTap clientId={oneTap.clientId} nonce={oneTap.nonce} redirect={redirect} />
      )}
      <div className="fabric" />
      <CyberCard ticks style={{ padding: 48, width: "min(480px, calc(100vw - 32px))" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <h1 className="display" style={{ fontSize: 36, marginTop: 20, marginBottom: 8 }}>
            Connexion
          </h1>
          <p className="mono" style={{ color: "var(--ink-mute)", letterSpacing: "0.18em", fontSize: 11, margin: 0 }}>
            BLUEGENJI · ACCÈS MEMBRE
          </p>
        </div>

        {!requested ? (
          <>
            <OAuthButtons redirect={redirect} />

            {/*
              Le séparateur **nomme** ce qui suit. « OU » seul laissait croire à
              une variante du bouton Discord juste au-dessus, alors que c'est un
              autre chemin, qui suppose un serveur commun : un bot ne peut écrire en
              message privé qu'à quelqu'un avec qui il partage un serveur — c'est
              Discord qui refuse l'envoi sinon, que la saisie soit un tag ou un ID.
            */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "24px 0 16px", color: "var(--ink-dim)" }}>
              <div style={{ flex: 1, height: 1, background: "var(--line-soft)" }} />
              <span className="mono" style={{ fontSize: 10, letterSpacing: "0.2em", whiteSpace: "nowrap" }}>
                OU CODE PAR MESSAGE PRIVÉ
              </span>
              <div style={{ flex: 1, height: 1, background: "var(--line-soft)" }} />
            </div>

            <form onSubmit={requestCode} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="field">
                <label>Tag Discord ou ID</label>
                <input
                  type="text"
                  name="handle"
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  placeholder="ton_pseudo ou 123456789012345678"
                  required
                />
                <span className="mono" style={{ fontSize: 10, color: "var(--ink-dim)", letterSpacing: "0.08em", marginTop: 4, lineHeight: 1.5 }}>
                  Le bot doit partager un serveur avec toi pour t&apos;écrire en privé, que tu
                  saisisses ton tag ou ton ID : l&apos;ID évite seulement la recherche de ton tag.
                  Pas encore sur un de ses serveurs ?{" "}
                  <Link
                    href={DISCORD_INVITE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "var(--blue-300)", textDecoration: "underline" }}
                  >
                    Rejoins-nous
                  </Link>{" "}
                  — ou passe simplement par le bouton Discord ci-dessus, qui marche sans serveur
                  commun.
                </span>
              </div>
              <CyberButton
                variant="ghost"
                type="submit"
                disabled={loading}
                style={{ width: "100%" }}
              >
                {loading ? "Envoi..." : "Recevoir un code →"}
              </CyberButton>
            </form>
          </>
        ) : (
          <>
            <OAuthButtons redirect={redirect} />

            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "24px 0 16px", color: "var(--ink-dim)" }}>
              <div style={{ flex: 1, height: 1, background: "var(--line-soft)" }} />
              <span className="mono" style={{ fontSize: 10, letterSpacing: "0.2em", whiteSpace: "nowrap" }}>
                OU CODE PAR MESSAGE PRIVÉ
              </span>
              <div style={{ flex: 1, height: 1, background: "var(--line-soft)" }} />
            </div>

            <form onSubmit={verifyCode} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="field">
                <label>Compte Discord</label>
                <input
                  type="text"
                  name="handle"
                  value={handle}
                  disabled
                />
                {/*
                  **La seule annonce de l'exposition sur ce chemin-ci.** Entrer
                  par Discord *est* la preuve que la certification demande
                  (`lib/shared/discord-identity.ts`), si bien que ce code
                  certifie le tag tout seul — sans passer par le dialogue de
                  `/profil`, qui est l'endroit où l'exposition est d'ordinaire
                  énoncée public par public. Sans cette phrase, un membre qui
                  n'avait jamais renseigné son tag le verrait s'ouvrir à
                  l'organisation sans qu'on le lui ait dit. Le geste
                  d'annulation est nommé, parce qu'il faut savoir qu'il y a
                  quelque chose à annuler.

                  Elle ne s'affiche **que si la saisie est un tag** : un
                  identifiant numérique (qui évite la recherche du tag par le
                  bot) ne certifie rien, et promettre une certification qui
                  n'aura pas lieu est pire que se taire. Le prédicat est celui
                  du serveur, pas une seconde lecture du même motif.
                */}
                {isCertifiableDiscordHandle(handle) && (
                  <span className="mono" style={{ fontSize: 10, color: "var(--ink-dim)", letterSpacing: "0.08em", marginTop: 4, lineHeight: 1.5 }}>
                    Te connecter par Discord <strong>certifie ce tag</strong> :{" "}
                    {DISCORD_TAG_AUDIENCE} {DISCORD_CERTIFICATION_UNDO}
                  </span>
                )}
              </div>
              <div className="field">
                <label>Code reçu en DM (6 chiffres)</label>
                <input
                  type="text"
                  name="code"
                  maxLength={6}
                  pattern="\d{6}"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="num"
                  style={{ fontSize: 20, letterSpacing: "0.3em", textAlign: "center" }}
                  required
                />
              </div>
              {isNewAccount && (
                <div className="field">
                  <label>Pseudo site <span style={{ color: "var(--ink-mute)", fontWeight: 400 }}>(première connexion)</span></label>
                  <input
                    type="text"
                    name="pseudo"
                    value={pseudo}
                    onChange={(e) => setPseudo(e.target.value)}
                    placeholder="Ton pseudo"
                  />
                </div>
              )}
              <CyberButton
                variant="ghost"
                type="submit"
                disabled={loading}
                style={{ width: "100%" }}
              >
                {loading ? "Vérification..." : "Se connecter"}
              </CyberButton>
            </form>

            <div style={{ marginTop: 16, textAlign: "center" }}>
              <button
                type="button"
                onClick={() => {
                  setRequested(false);
                  setCode("");
                  setIsNewAccount(true);
                }}
                className="mono"
                style={{
                  fontSize: 11,
                  color: "var(--ink-mute)",
                  letterSpacing: "0.14em",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                ← CHANGER DE COMPTE
              </button>
            </div>
          </>
        )}

        <div style={{ marginTop: 24, textAlign: "center" }}>
          <Link
            href="/"
            className="mono"
            style={{ fontSize: 11, color: "var(--ink-mute)", letterSpacing: "0.14em" }}
          >
            ← RETOUR ACCUEIL
          </Link>
        </div>
      </CyberCard>
      {/*
        Rendue **après** la carte, dont elle recouvre pourtant l'écran : l'ordre
        du document est celui de la lecture, et son titre (« Avant de
        continuer », un `h2`) passait avant le `h1` de la page (RGAA 9.1). La
        position fixe la met au-dessus quel que soit son rang ; le focus y est
        porté par `useDialogBehavior`, pas par l'ordre.
      */}
      {!consentGiven && (
        <RgpdConsentModal onAccept={acceptConsent} onRefuse={refuseConsent} />
      )}
    </main>
  );
}
