"use client";

import { FormEvent, useEffect, useState } from "react";
import { LocaleLink, useLocaleRouter } from "@/components/i18n/locale-navigation";
import { useLoginText } from "@/components/i18n/login-text";
import { richNodes } from "@/components/i18n/shell-text";
import { useToast } from "@/components/ui/toast";
import { CyberButton } from "@/components/cyber/CyberButton";
import { CyberCard } from "@/components/cyber/CyberCard";
import { RgpdConsentModal } from "@/components/cyber/RgpdConsentModal";
import { DEFAULT_REDIRECT, loginDestination } from "@/lib/shared/safe-redirect";
import { codeExpiryTime, suspendedLoginText } from "@/lib/shared/login-text";
import { loginErrorMessage, oauthErrorMessage } from "../_lib/login-errors";
import {
  detectLoginEnvironment,
  loginEnvironmentNotice,
  readLoginEnvironmentSignals,
  type LoginEnvironment,
} from "@/lib/shared/login-environment";
import { OAuthButtons } from "./OAuthButtons";
import { SuspensionNoticeDialog } from "./SuspensionNoticeDialog";
import { ACCOUNT_SUSPENDED, parseSuspensionNotice, type SuspensionNotice } from "@/lib/shared/account-suspension";
import { DISCORD_INVITE_URL } from "@/lib/shared/discord";
import { TERMS_VERSION } from "@/lib/shared/terms-of-use";
import { isCertifiableDiscordHandle } from "@/lib/shared/discord-identity";
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
/** « 3 » : la case porte la déclaration d'âge (`TERMS_AGE_DECLARATION`), qu'un navigateur à « 2 » n'a jamais vue. */
const NOTICE_VERSION = "3";
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

/**
 * Formulaire de connexion.
 *
 * `suspensionNotice` : l'exposé d'une suspension, relu par la page dans le
 * cookie que pose un retour OAuth refusé (`lib/server/oauth-flow.ts`).
 */
export function LoginForm({ suspensionNotice = null }: Readonly<{ suspensionNotice?: SuspensionNotice | null }> = {}) {
  // Navigation dans la langue de la page : une destination restée française
  // (route pas encore traduite) se rejoint par un chargement complet.
  const router = useLocaleRouter();
  const text = useLoginText();
  const { t } = text;
  const { showError, showSuccess } = useToast();
  const fieldErrors = useFieldErrors(LOGIN_FIELD_ERRORS, LOGIN_FIELD_IDS);
  // Destination d'après connexion. Toujours **filtrée** : la valeur vient de
  // l'URL, et une redirection ouverte est l'appât classique du hameçonnage
  // (`lib/shared/safe-redirect.ts`). Rendue dans la langue de la page : partie
  // de `/en/connexion`, elle ramène sur `/en/…` (lot 6).
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
  // Exposé d'une suspension à afficher : retour OAuth (cookie relu par la
  // page) ou refus du code Discord (corps de la réponse).
  const [suspension, setSuspension] = useState<SuspensionNotice | null>(null);
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
    setRedirect(loginDestination(params.get("redirect"), text.locale));
    // Le refus vient du module partagé, qui compose la phrase depuis le motif
    // (`?error=`) et le fournisseur (`?provider=`). Les cinq codes écrits ici en
    // dur ne parlaient que de Google : la troisième porte en aurait fait quinze.
    // Sur l'icône d'écran d'accueil d'iOS ou dans le navigateur intégré d'une
    // application, l'aller-retour perd ses cookies : le refus le dit, et
    // nomme les sorties (autre navigateur, code Discord).
    const signals = readLoginEnvironmentSignals();
    const environment = signals ? detectLoginEnvironment(signals) : "BROWSER";
    setEnvironment(environment);
    // Compte suspendu : l'exposé complet s'il a voyagé jusqu'ici, sinon (cookie
    // expiré, page rechargée plus tard) la phrase générique.
    if (params.get("error") === "suspended" && suspensionNotice) {
      setSuspension(suspensionNotice);
      return;
    }
    const message = oauthErrorMessage(params.get("error"), params.get("provider"), environment, text);
    if (message) showError(message);
  }, [showError, suspensionNotice, text]);

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
        throw new CodedError(code, loginErrorMessage(code, text));
      }
      setChallenge(typeof payload.challenge === "string" ? payload.challenge : null);
      setRequested(true);
      showSuccess(t("page.codeSent", { time: codeExpiryTime(text.locale, payload.expiresAt) }));
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
      const payload = (await response.json()) as { error?: string; suspension?: unknown };
      if (!response.ok) {
        const code = payload.error || "FAILED";
        const notice = code === ACCOUNT_SUSPENDED ? parseSuspensionNotice(payload.suspension) : null;
        if (notice) {
          setSuspension(notice);
          return;
        }
        throw new CodedError(code, code === ACCOUNT_SUSPENDED ? suspendedLoginText(text, null) : loginErrorMessage(code, text));
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
        style={{
          padding: "clamp(24px, 6vw, 48px)",
          width: "min(480px, calc(100vw - 32px))",
          borderColor: "rgba(var(--blue-500-rgb), 0.3)",
          boxShadow: "0 30px 80px -40px rgba(var(--violet-400-rgb), 0.6), 0 0 40px -24px var(--blue-glow)",
        }}
      >
        {/*
          La page n'a pas d'en-tête : ce lien est la seule sortie vers le site.
          Il était en bas de carte, en mono 11 px — sous le pli sur mobile, et
          une cible minuscule. En tête, en texte courant, 44 px de haut.
        */}
        <LocaleLink
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: 44,
            fontSize: 14,
            color: "var(--ink-mute)",
          }}
        >
          {t("page.backHome")}
        </LocaleLink>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <h1 className="display" style={{ fontSize: 36, marginTop: 20, marginBottom: 8 }}>
            <span className="text-gradient">{t("page.title")}</span>
          </h1>
          <p className="mono" style={{ color: "var(--blue-300)", letterSpacing: "0.18em", fontSize: 11, margin: 0 }}>
            {t("page.eyebrow")}
          </p>
        </div>

        {!requested ? (
          <>
            <OAuthButtons
              redirect={redirect}
              termsAccepted={termsAccepted}
              environmentNotice={loginEnvironmentNotice(environment, text)}
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
              <span className="mono" style={{ fontSize: 11, letterSpacing: "0.14em", whiteSpace: "nowrap" }}>
                {t("page.codeSeparator")}
              </span>
              <div style={{ flex: 1, height: 1, background: "var(--line-soft)" }} />
            </div>

            <form onSubmit={requestCode} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="field">
                <label htmlFor={LOGIN_FIELD_IDS.handle}>{t("page.handleLabel")}</label>
                <input
                  id={LOGIN_FIELD_IDS.handle}
                  type="text"
                  name="handle"
                  value={handle}
                  onChange={(e) => {
                    setHandle(e.target.value);
                    fieldErrors.clear("handle");
                  }}
                  placeholder={t("page.handlePlaceholder")}
                  required
                  {...fieldErrors.aria("handle", "login-discord-handle-help")}
                />
                <FieldErrorText fieldId={LOGIN_FIELD_IDS.handle} message={fieldErrors.message("handle")} />
                <span id="login-discord-handle-help" style={{ ...LOGIN_HELP_TEXT_STYLE, marginTop: 4 }}>
                  {richNodes(
                    text.rich("page.handleHelp", {}, {
                      join: (children) => (
                        <a
                          href={DISCORD_INVITE_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: "var(--blue-300)", textDecoration: "underline" }}
                        >
                          {richNodes(children)}
                        </a>
                      ),
                    }),
                  )}
                </span>
              </div>
              <CyberButton
                variant="ghost"
                type="submit"
                disabled={loading}
                style={{ width: "100%" }}
              >
                {loading ? t("page.sending") : t("page.requestCode")}
              </CyberButton>
            </form>
          </>
        ) : (
          <>
            <OAuthButtons
              redirect={redirect}
              termsAccepted={termsAccepted}
              environmentNotice={loginEnvironmentNotice(environment, text)}
            />

            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "24px 0 16px", color: "var(--ink-dim)" }}>
              <div style={{ flex: 1, height: 1, background: "var(--line-soft)" }} />
              <span className="mono" style={{ fontSize: 11, letterSpacing: "0.14em", whiteSpace: "nowrap" }}>
                {t("page.codeSeparator")}
              </span>
              <div style={{ flex: 1, height: 1, background: "var(--line-soft)" }} />
            </div>

            <form onSubmit={verifyCode} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="field">
                <label htmlFor={LOGIN_FIELD_IDS.handle}>{t("page.accountLabel")}</label>
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
                    {richNodes(
                      text.rich("page.tagNotice", { audience: t("oauth.tagAudience") }, {
                        strong: (children) => <strong>{richNodes(children)}</strong>,
                      }),
                    )}
                  </span>
                )}
              </div>
              <div className="field">
                <label htmlFor={LOGIN_FIELD_IDS.code}>{t("page.codeLabel")}</label>
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
                  {t("page.pseudoLabel")} <span style={{ color: "var(--ink-mute)", fontWeight: 400 }}>{t("page.pseudoOptional")}</span>
                </label>
                <input
                  id="login-site-pseudo"
                  type="text"
                  name="pseudo"
                  value={pseudo}
                  onChange={(e) => setPseudo(e.target.value)}
                  placeholder={t("page.pseudoPlaceholder")}
                  aria-describedby="login-site-pseudo-help"
                />
                <span id="login-site-pseudo-help" style={{ ...LOGIN_HELP_TEXT_STYLE, marginTop: 4 }}>
                  {t("page.pseudoHelp")}
                </span>
              </div>
              <CyberButton
                variant="ghost"
                type="submit"
                disabled={loading}
                style={{ width: "100%" }}
              >
                {loading ? t("page.verifying") : t("page.submit")}
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
                {t("page.changeAccount")}
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
      {suspension && <SuspensionNoticeDialog notice={suspension} onClose={() => setSuspension(null)} />}
    </main>
  );
}
