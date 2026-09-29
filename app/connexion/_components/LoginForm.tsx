"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { CyberButton } from "@/components/cyber/CyberButton";
import { CyberCard } from "@/components/cyber/CyberCard";
import { RgpdConsentModal } from "@/components/cyber/RgpdConsentModal";
import { DEFAULT_REDIRECT, safeRedirectPath } from "@/lib/shared/safe-redirect";
import { loginErrorMessage, oauthErrorMessage } from "../_lib/login-errors";
import {
  detectLoginEnvironment,
  loginEnvironmentNotice,
  readLoginEnvironmentSignals,
  type LoginEnvironment,
} from "@/lib/shared/login-environment";
import { OAuthButtons } from "./OAuthButtons";
import { DISCORD_INVITE_URL } from "@/lib/shared/discord";
import { TERMS_VERSION } from "@/lib/shared/terms-of-use";
import { isCertifiableDiscordHandle } from "@/lib/shared/discord-identity";
import { DISCORD_TAG_AUDIENCE } from "@/lib/shared/identity-sharing";
import { CodedError, LOGIN_FIELD_ERRORS, errorCode } from "@/lib/shared/field-errors";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { FieldErrorText } from "@/components/ui/field-error-text";
import { LOGIN_HELP_TEXT_STYLE } from "../_lib/login-styles";

/**
 * Information d'entrée **lue** dans ce navigateur, à sa version. Ce n'est plus un
 * consentement (le compte repose sur l'exécution du service) : la clé garde son
 * nom historique.
 */
const CONSENT_STORAGE_KEY = "bg_rgpd_consent";
const NOTICE_VERSION = "2";
/**
 * Accord à l'invite Google One Tap, retirée depuis : la valeur restée dans un
 * navigateur est effacée au passage, rien ne la relit plus (le cookie `g_state`
 * de Google, lui, est effacé par `middleware.ts`, sur toutes les pages).
 */
const LEGACY_ONE_TAP_STORAGE_KEY = "bg_one_tap_consent";
/**
 * Version des conditions d'utilisation acceptée dans ce navigateur, gardée à
 * côté du consentement RGPD : une nouvelle version fait réapparaître la
 * modale, là où une simple case « déjà vu » l'aurait tue pour toujours.
 */
const TERMS_STORAGE_KEY = "bg_terms_consent";

/**
 * Contrôles de la connexion par code. Le compte Discord garde le même `id` sur
 * les deux étapes : c'est le champ saisi à la première, montré figé à la
 * seconde, et le refus qui le désigne (tag introuvable) tombe toujours à la
 * première.
 */
const LOGIN_FIELD_IDS = { handle: "login-discord-handle", code: "login-discord-code" } as const;

/** Formulaire de connexion. */
export function LoginForm() {
  const router = useRouter();
  const { showError, showSuccess } = useToast();
  const fieldErrors = useFieldErrors(LOGIN_FIELD_ERRORS, LOGIN_FIELD_IDS);
  // Destination d'après connexion. Toujours **filtrée** : la valeur vient de
  // l'URL, et une redirection ouverte est l'appât classique du hameçonnage
  // (`lib/shared/safe-redirect.ts`).
  const [redirect, setRedirect] = useState(DEFAULT_REDIRECT);
  // Lu au montage : le rendu serveur ne connaît ni l'agent ni le mode d'affichage.
  const [environment, setEnvironment] = useState<LoginEnvironment>("BROWSER");

  const [handle, setHandle] = useState("");
  // Jeton du défi émis : la demande de code ne rend plus l'identifiant
  // Discord résolu, ni si un compte existe déjà (c'était un oracle anonyme).
  const [challenge, setChallenge] = useState<string | null>(null);
  const [pseudo, setPseudo] = useState("");
  const [code, setCode] = useState("");
  const [requested, setRequested] = useState(false);
  const [loading, setLoading] = useState(false);
  // Information RGPD et conditions d'utilisation, avant toute création de
  // compte. Tant qu'elles ne sont pas lues et acceptées, la carte de connexion
  // est masquée derrière la popup et aucune requête d'authentification n'est
  // déclenchée.
  const [consentGiven, setConsentGiven] = useState(true);
  // `consentGiven` part à `true` pour ne pas faire clignoter la modale au
  // premier rendu : il ne dit donc rien tant que le stockage n'a pas été lu.
  const [consentRead, setConsentRead] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let stored: string | null = null;
    let terms: string | null = null;
    try {
      stored = window.localStorage.getItem(CONSENT_STORAGE_KEY);
      terms = window.localStorage.getItem(TERMS_STORAGE_KEY);
      window.localStorage.removeItem(LEGACY_ONE_TAP_STORAGE_KEY);
    } catch {
      // localStorage indisponible (mode privé) : la modale redemande.
    }
    setConsentGiven(stored === NOTICE_VERSION && terms === String(TERMS_VERSION));
    setConsentRead(true);
  }, []);

  const acceptConsent = () => {
    try {
      window.localStorage.setItem(CONSENT_STORAGE_KEY, NOTICE_VERSION);
      window.localStorage.setItem(TERMS_STORAGE_KEY, String(TERMS_VERSION));
    } catch {
      // localStorage indisponible (mode privé) : on continue en mémoire.
    }
    setConsentGiven(true);
  };

  // Les conditions ne voyagent qu'une fois le stockage **lu** et le
  // consentement **donné** : `consentGiven` part à `true` pour ne pas faire
  // clignoter la modale, il ne vaut donc acceptation qu'après la lecture.
  const termsAccepted = consentRead && consentGiven;

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
    // Sur l'icône d'écran d'accueil d'iOS ou dans le navigateur intégré d'une
    // application, l'aller-retour perd ses cookies : le refus le dit, et
    // nomme les sorties (autre navigateur, code Discord).
    const signals = readLoginEnvironmentSignals();
    const environment = signals ? detectLoginEnvironment(signals) : "BROWSER";
    setEnvironment(environment);
    const message = oauthErrorMessage(params.get("error"), params.get("provider"), environment);
    if (message) showError(message);
  }, [showError]);

  const requestCode = async (event: FormEvent) => {
    event.preventDefault();
    fieldErrors.clear();
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
        challenge?: string;
      };
      if (!response.ok) {
        const code = payload.error || "FAILED";
        throw new CodedError(code, loginErrorMessage(code));
      }
      setChallenge(typeof payload.challenge === "string" ? payload.challenge : null);
      setRequested(true);
      showSuccess(`Code envoyé en DM Discord (expiration : ${new Date(payload.expiresAt || "").toLocaleTimeString()}).`);
    } catch (e) {
      fieldErrors.report(errorCode(e), (e as Error).message);
      showError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async (event: FormEvent) => {
    event.preventDefault();
    fieldErrors.clear();
    setLoading(true);
    try {
      const response = await fetch("/api/auth/discord/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challenge,
          code,
          pseudo: pseudo.trim() ? pseudo : undefined,
          termsAccepted,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        const code = payload.error || "FAILED";
        throw new CodedError(code, loginErrorMessage(code));
      }
      router.push(redirect);
      router.refresh();
    } catch (e) {
      fieldErrors.report(errorCode(e), (e as Error).message);
      showError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", position: "relative" }}>
      <div className="fabric" />
      <CyberCard
        ticks
        style={{ padding: "clamp(24px, 6vw, 48px)", width: "min(480px, calc(100vw - 32px))" }}
      >
        {/*
          La page n'a pas d'en-tête : ce lien est la seule sortie vers le site.
          Il était en bas de carte, en mono 11 px — sous le pli sur mobile, et
          une cible minuscule. En tête, en texte courant, 44 px de haut.
        */}
        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: 44,
            fontSize: 14,
            color: "var(--ink-mute)",
          }}
        >
          ← Retour à l&apos;accueil
        </Link>
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
            <OAuthButtons
              redirect={redirect}
              termsAccepted={termsAccepted}
              environmentNotice={loginEnvironmentNotice(environment)}
            />

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
                <label htmlFor={LOGIN_FIELD_IDS.handle}>Tag Discord ou ID</label>
                <input
                  id={LOGIN_FIELD_IDS.handle}
                  type="text"
                  name="handle"
                  value={handle}
                  onChange={(e) => {
                    setHandle(e.target.value);
                    fieldErrors.clear("handle");
                  }}
                  placeholder="ton_pseudo ou 123456789012345678"
                  required
                  {...fieldErrors.aria("handle", "login-discord-handle-help")}
                />
                <FieldErrorText fieldId={LOGIN_FIELD_IDS.handle} message={fieldErrors.message("handle")} />
                <span id="login-discord-handle-help" style={{ ...LOGIN_HELP_TEXT_STYLE, marginTop: 4 }}>
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
            <OAuthButtons
              redirect={redirect}
              termsAccepted={termsAccepted}
              environmentNotice={loginEnvironmentNotice(environment)}
            />

            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "24px 0 16px", color: "var(--ink-dim)" }}>
              <div style={{ flex: 1, height: 1, background: "var(--line-soft)" }} />
              <span className="mono" style={{ fontSize: 10, letterSpacing: "0.2em", whiteSpace: "nowrap" }}>
                OU CODE PAR MESSAGE PRIVÉ
              </span>
              <div style={{ flex: 1, height: 1, background: "var(--line-soft)" }} />
            </div>

            <form onSubmit={verifyCode} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="field">
                <label htmlFor={LOGIN_FIELD_IDS.handle}>Compte Discord</label>
                <input
                  id={LOGIN_FIELD_IDS.handle}
                  type="text"
                  name="handle"
                  value={handle}
                  disabled
                />
                {/*
                  Ce que ce code fait du tag : il l'**enregistre**, sans le
                  certifier. Se connecter n'est pas consentir à l'exposition
                  (`lib/shared/discord-identity.ts`) ; la certification reste un
                  clic distinct sur `/profil`, et la phrase dit qui lirait le tag
                  une fois ce clic fait.

                  Elle ne s'affiche **que si la saisie est un tag** : un
                  identifiant numérique (qui évite la recherche du tag par le
                  bot) n'enregistre aucun pseudo. Le prédicat est celui du
                  serveur, pas une seconde lecture du même motif.
                */}
                {isCertifiableDiscordHandle(handle) && (
                  <span style={{ ...LOGIN_HELP_TEXT_STYLE, marginTop: 4 }}>
                    Te connecter par ce code <strong>enregistre ce tag</strong>, sans le certifier :
                    il reste invisible de tous, administrateurs compris. Si tu le certifies ensuite
                    dans « Mon profil », {DISCORD_TAG_AUDIENCE}
                  </span>
                )}
              </div>
              <div className="field">
                <label htmlFor={LOGIN_FIELD_IDS.code}>Code reçu en DM (6 chiffres)</label>
                <input
                  id={LOGIN_FIELD_IDS.code}
                  type="text"
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  pattern="\d{6}"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                    fieldErrors.clear("code");
                  }}
                  {...fieldErrors.aria("code")}
                  className="num"
                  style={{ fontSize: 20, letterSpacing: "0.3em", textAlign: "center" }}
                  required
                />
                <FieldErrorText fieldId={LOGIN_FIELD_IDS.code} message={fieldErrors.message("code")} />
              </div>
              {/*
                Proposé à tous : le serveur ne dit plus si le compte existe
                (la réponse de la demande de code en faisait un oracle), et ne
                lit ce pseudo qu'à la création — un compte existant garde le sien.
              */}
              <div className="field">
                <label htmlFor="login-site-pseudo">
                  Pseudo site <span style={{ color: "var(--ink-mute)", fontWeight: 400 }}>(facultatif, première connexion)</span>
                </label>
                <input
                  id="login-site-pseudo"
                  type="text"
                  name="pseudo"
                  value={pseudo}
                  onChange={(e) => setPseudo(e.target.value)}
                  placeholder="Ton pseudo"
                  aria-describedby="login-site-pseudo-help"
                />
                <span id="login-site-pseudo-help" style={{ ...LOGIN_HELP_TEXT_STYLE, marginTop: 4 }}>
                  Seulement à la création de ton compte : si tu en as déjà un, il garde son pseudo.
                </span>
              </div>
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
                  fieldErrors.clear();
                  setRequested(false);
                  setCode("");
                  setChallenge(null);
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
      </CyberCard>
      {/*
        Rendue **après** la carte, dont elle recouvre pourtant l'écran : l'ordre
        du document est celui de la lecture, et son titre (« Avant de
        continuer », un `h2`) passait avant le `h1` de la page (RGAA 9.1). La
        position fixe la met au-dessus quel que soit son rang ; le focus y est
        porté par `useDialogBehavior`, pas par l'ordre.
      */}
      {!consentGiven && (
        <RgpdConsentModal
          onAccept={acceptConsent}
          onRefuse={refuseConsent}
        />
      )}
    </main>
  );
}
