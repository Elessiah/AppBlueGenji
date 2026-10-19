"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import { CyberButton } from "@/components/cyber/CyberButton";
import { VerifiedBadge } from "@/components/discord-tag";
import { useToast } from "@/components/ui/toast";
import { FieldErrorText } from "@/components/ui/field-error-text";
import { DISCORD_VERIFICATION_FIELD_ERRORS } from "@/lib/shared/field-errors";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { oauthStartPath } from "@/lib/shared/oauth-providers";
import { formatExpiryTime } from "@/lib/shared/dates";
import { visibleText } from "@/lib/shared/visible-text";
import { richNodes } from "@/components/i18n/shell-text";
import { useProfileText } from "@/components/i18n/profile-text";
import { useAppLocale } from "@/components/i18n/locale-context";
import { DiscordInviteLink } from "./_components/DiscordInviteLink";
import { discordVerificationErrorMessage } from "./discord-errors";
import { ScrollArea } from "@/components/cyber";

/** Les lignes de l'exposition, dans l'ordre du registre (`DISCORD_VERIFICATION_EXPOSURE`, testé). */
export const EXPOSURE_KEYS = ["admins", "referees", "match", "players", "undo"] as const;

const FIELD_IDS = { handle: "discord-verify-handle", code: "discord-verify-code" } as const;

/**
 * Certification du tag Discord, en une ou deux étapes.
 *
 * **L'exposition se lit avant le clic, pas après.** La certification ouvre le
 * tag à l'administration et à l'arbitrage : le dialogue l'énonce publiquement
 * par public et par portée (`DISCORD_VERIFICATION_EXPOSURE`, écrit à côté de la
 * règle qui l'applique), et le bouton de confirmation ne vient qu'après. C'est un
 * consentement, pas une formalité.
 *
 * **Trois parcours, selon ce que le compte a déjà prouvé.** Un compte sans
 * Discord rattaché envoie son tag au bot, qui le retrouve parmi les membres des
 * serveurs qu'il partage avec lui, puis confirme par le code reçu en message
 * privé. Un compte **déjà relié** dont Discord a nommé le pseudo à la connexion
 * certifie **d'un clic** : la preuve est faite, il ne manque que le
 * consentement — ni bot, ni code, ni aller-retour. Un compte relié sans pseudo
 * nommé par Discord (retiré, ou tapé à la main avant le rattachement) repart
 * chez Discord (`/api/auth/discord/start?intent=link`), qui le nomme ; il revient
 * ensuite le certifier.
 */
export type DiscordVerificationDialogProps = {
  /** Tag actuellement saisi dans le formulaire, proposé d'emblée. */
  initialTag: string;
  /** Un identifiant Discord est-il déjà rattaché au compte ? */
  linked: boolean;
  /**
   * Le tag enregistré a-t-il été nommé par Discord ? Un compte rattaché le
   * certifie alors d'un clic ; sinon il repasse par Discord pour qu'il le nomme.
   */
  attested: boolean;
  onClose: () => void;
  /** Appelé avec le tag certifié, pour que la page se remette à jour. */
  onVerified: (tag: string) => void;
};

export function DiscordVerificationDialog({
  initialTag,
  linked,
  attested,
  onClose,
  onVerified,
}: Readonly<DiscordVerificationDialogProps>) {
  const { showError, showSuccess } = useToast();
  const text = useProfileText();
  const { t } = text;
  // Monté après l'hydratation : le portail vise `document.body`, qui n'existe
  // pas au rendu serveur.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [handle, setHandle] = useState(initialTag);
  const [challenge, setChallenge] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);
  // Langue de l'adresse, pas du texte (repli français possible) : le retour OAuth reste sur `/en/profil`.
  const pageLocale = useAppLocale();
  const fieldErrors = useFieldErrors(DISCORD_VERIFICATION_FIELD_ERRORS, FIELD_IDS);

  /**
   * Refus d'une des deux étapes : dit en notification, et rattaché au champ
   * qu'il désigne (tag introuvable, code faux). Traduit ici et non au `throw` :
   * une coupure réseau lève un `TypeError` dont le message anglais partait
   * sinon tel quel dans la notification — et il ne désigne aucun champ.
   */
  const refuse = (e: unknown) => {
    const code = (e as Error).message;
    const message = discordVerificationErrorMessage(code, text);
    showError(message);
    fieldErrors.report(code, message);
  };

  const requestVerification = async (event: FormEvent) => {
    event.preventDefault();
    // Bouton en `aria-disabled` pendant l'envoi (le focus reste dans la modale) : la garde est ici,
    // par une référence lue sans attendre de rendu — Entrée puis clic dans le même instant
    // enverraient sinon deux demandes (un essai du code brûlé ; revue de sécurité du lot 9-2).
    if (inFlight.current) return;
    inFlight.current = true;
    fieldErrors.clear();
    setLoading(true);
    try {
      const response = await fetch("/api/profile/discord", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle }),
      });
      const payload = (await response.json()) as {
        error?: string;
        status?: "VERIFIED" | "CODE_SENT";
        tag?: string;
        challenge?: string;
        expiresAt?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "");

      if (payload.status === "VERIFIED") {
        showSuccess(t("verify.certified"));
        onVerified(payload.tag ?? handle);
        return;
      }

      setChallenge(payload.challenge ?? "");
      showSuccess(
        t("verify.codeSent", {
          time: formatExpiryTime(payload.expiresAt, text.locale),
        }),
      );
    } catch (e) {
      refuse(e);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  const confirmVerification = async (event: FormEvent) => {
    event.preventDefault();
    // Bouton en `aria-disabled` pendant l'envoi (le focus reste dans la modale) : la garde est ici,
    // par une référence lue sans attendre de rendu — Entrée puis clic dans le même instant
    // enverraient sinon deux demandes (un essai du code brûlé ; revue de sécurité du lot 9-2).
    if (inFlight.current) return;
    inFlight.current = true;
    fieldErrors.clear();
    setLoading(true);
    try {
      const response = await fetch("/api/profile/discord", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challenge, code }),
      });
      const payload = (await response.json()) as { error?: string; tag?: string };
      if (!response.ok) throw new Error(payload.error ?? "");
      showSuccess(t("verify.certified"));
      onVerified(payload.tag ?? handle);
    } catch (e) {
      // Ces refus arrivent code **consommé** : le retaper ne rendrait plus que
      // « code invalide ou expiré ». Le Discord détenu par un autre compte n'est
      // dit qu'ici (la demande ne doit rien révéler d'un tiers) ; comme un
      // rattachement changé entre-temps ou un défi sans tag, il se lève au tag.
      const reason = (e as Error).message;
      if (
        reason === "DISCORD_ALREADY_LINKED" ||
        reason === "DISCORD_ID_MISMATCH" ||
        reason === "INVALID_DISCORD_HANDLE"
      ) {
        restartVerification();
      }
      refuse(e);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  const awaitingCode = challenge !== "";

  // Changer d'étape démonte le bouton qui vient d'être activé : sans ce relais,
  // le focus tomberait sur `<body>` et le champ de la nouvelle étape ne serait
  // jamais annoncé. Rien au montage — `useDialogBehavior` y pose le focus.
  const previousStep = useRef(awaitingCode);
  useEffect(() => {
    if (previousStep.current === awaitingCode) return;
    previousStep.current = awaitingCode;
    document.getElementById(awaitingCode ? FIELD_IDS.code : FIELD_IDS.handle)?.focus();
  }, [awaitingCode]);

  /** Retour à la demande de code, tag conservé : le précédent est perdu. */
  const restartVerification = () => {
    setChallenge("");
    setCode("");
    fieldErrors.clear();
  };
  // Comportement commun des modales du site : `Échap` ferme (sauf pendant une
  // écriture), le défilement de l'arrière-plan est verrouillé, le focus entre
  // dans la boîte et y reste, puis retourne d'où il venait. Le `locked` n'est
  // pas décoratif : une certification en cours d'envoi ne doit pas se faire
  // interrompre par une touche.
  const dialogRef = useDialogBehavior({ open: mounted, onClose, locked: loading });
  // Les boutons suivent la même règle, sans `disabled` : le focus n'en tombe
  // pas hors de la modale pendant l'envoi (`aria-disabled`, clic ignoré).
  const cancel = () => {
    if (!loading) onClose();
  };
  const backdrop = useBackdropDismiss(onClose, loading);

  if (!mounted) return null;

  // Étape du dialogue : confirmation d'un tag déjà nommé par Discord, passage
  // par Discord, demande d'un code, puis saisie du code.
  const renderStep = () => {
    if (linked && attested && initialTag) {
      return (
        <form onSubmit={requestVerification} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Le pseudo a déjà été nommé par Discord à ta connexion : la preuve
              est faite, ce clic ne donne que le consentement. Le tag est
              montré tel qu'il sera exposé — c'est lui, et rien d'autre. */}
          <p style={{ fontSize: 12.5, color: "var(--ink-mute)", margin: 0, lineHeight: 1.6 }}>
            {richNodes(text.rich("verify.attested", { tag: visibleText(initialTag) }, { strong: (chunks) => <strong>{chunks}</strong> }))}
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <CyberButton variant="ghost" type="button" aria-disabled={loading || undefined} onClick={cancel}>
              {t("verify.cancel")}
            </CyberButton>
            <CyberButton variant="primary" type="submit" aria-disabled={loading || undefined} aria-busy={loading || undefined}>
              {loading ? t("verify.certifying") : t("verify.certifyThis")}
            </CyberButton>
          </div>
        </form>
      );
    }
    if (linked) {
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* `--ink-mute` et non `--ink-dim` : c'est la seule phrase qui dit
              pourquoi le bouton quitte la page, elle doit se lire avant le
              clic. */}
          <p style={{ fontSize: 12.5, color: "var(--ink-mute)", margin: 0, lineHeight: 1.6 }}>
            {t("verify.linkedNoTag")}
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <CyberButton variant="ghost" type="button" aria-disabled={loading || undefined} onClick={cancel}>
              {t("verify.cancel")}
            </CyberButton>
            {/* Une navigation et non un appel de fond : l'aller-retour OAuth
                quitte la page. Un `<a>` plutôt qu'un `<Link>` — la route
                répond par une redirection vers Discord, rien que le routeur
                client puisse précharger ou rendre. */}
            <CyberButton variant="primary" asChild>
              <a href={oauthStartPath("DISCORD", { intent: "LINK", locale: pageLocale })}>{t("verify.continueWithDiscord")}</a>
            </CyberButton>
          </div>
        </div>
      );
    }
    if (!awaitingCode) {
      return (
        <form onSubmit={requestVerification} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="field">
            <label htmlFor="discord-verify-handle">{t("verify.tag")}</label>
            <input
              id={FIELD_IDS.handle}
              value={handle}
              onChange={(e) => {
                setHandle(e.target.value);
                fieldErrors.clear("handle");
              }}
              placeholder={t("verify.tagPlaceholder")}
              required
              {...fieldErrors.aria("handle", "discord-verify-handle-help")}
            />
            <FieldErrorText fieldId={FIELD_IDS.handle} message={fieldErrors.message("handle")} />
            <p
              id="discord-verify-handle-help"
              style={{ fontSize: 11, color: "var(--ink-dim)", margin: "6px 0 0", lineHeight: 1.6 }}
            >
              {richNodes(
                text.rich("verify.tagHelp", {}, {
                  join: (chunks) => <DiscordInviteLink>{richNodes(chunks)}</DiscordInviteLink>,
                }),
              )}
            </p>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <CyberButton variant="ghost" type="button" aria-disabled={loading || undefined} onClick={cancel}>
              {t("verify.cancel")}
            </CyberButton>
            <CyberButton variant="primary" type="submit" aria-disabled={loading || undefined} aria-busy={loading || undefined}>
              {loading ? t("verify.checking") : t("verify.requestCode")}
            </CyberButton>
          </div>
        </form>
      );
    }
    return (
      <form onSubmit={confirmVerification} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="field">
          <label htmlFor="discord-verify-code">{t("verify.code")}</label>
          <input
            id={FIELD_IDS.code}
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              fieldErrors.clear("code");
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            placeholder={t("verify.codePlaceholder")}
            required
            {...fieldErrors.aria("code", "discord-verify-code-help")}
          />
          <FieldErrorText fieldId={FIELD_IDS.code} message={fieldErrors.message("code")} />
          <p id="discord-verify-code-help" style={{ fontSize: 11, color: "var(--ink-dim)", margin: "6px 0 0" }}>
            {t("verify.codeHelp")}
          </p>
        </div>
        {/* Trois boutons : à la largeur d'un téléphone ils ne tiennent pas
            sur une ligne, la rangée passe à la ligne plutôt que de déborder. */}
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 10 }}>
          <CyberButton variant="ghost" type="button" aria-disabled={loading || undefined} onClick={cancel}>
            {t("verify.cancel")}
          </CyberButton>
          {/* Un code brûlé (cinq essais) ou expiré ne se corrige pas en le
              retapant : le refus le dit (« Recommence la certification »),
              et ce retour à la première étape est le geste qu'il nomme. */}
          <CyberButton variant="ghost" type="button" aria-disabled={loading || undefined} onClick={() => !loading && restartVerification()}>
            {t("verify.newCode")}
          </CyberButton>
          <CyberButton variant="primary" type="submit" aria-disabled={loading || undefined} aria-busy={loading || undefined}>
            {loading ? t("verify.certifying") : t("verify.certifyMine")}
          </CyberButton>
        </div>
      </form>
    );
  };

  return createPortal(
    <div /* NOSONAR S6819 — voile de modale, sans équivalent natif */
      role="presentation"
      {...backdrop}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "grid",
        placeItems: "center",
        padding: 16,
        background: "rgba(4, 8, 14, 0.78)",
        backdropFilter: "blur(4px)",
      }}
    >
      <div /* NOSONAR S6819 — modale portée dans body (useDialogBehavior) : `<dialog>` changerait couche, Échap et ::backdrop */
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="discord-verify-title"
        // Le lecteur d'écran doit entendre **ce que la certification expose**
        // avant d'atteindre le champ : c'est le consentement, pas une
        // décoration.
        aria-describedby="discord-verify-match-dms discord-verify-exposure"
        tabIndex={-1}
        style={{
          width: "min(520px, calc(100vw - 32px))",
          maxHeight: "calc(100vh - 32px)",
          display: "flex",
          flexDirection: "column",
          background: "var(--cyber-bg-1)",
          border: "1px solid var(--line-strong-cy)",
          borderRadius: "var(--r-cy-lg)",
        }}
      >
        {/* Zone défilante nommée (CLAUDE.md) : le corps défile, pas la boîte. */}
        <ScrollArea orientation="y" ariaLabel={t("verify.bodyLabel")} style={{ padding: 28, minHeight: 0 }}>
        <span className="eyebrow">{t("verify.eyebrow")}</span>
        <h2
          id="discord-verify-title"
          className="display"
          style={{ fontSize: 22, margin: "12px 0 8px", display: "flex", alignItems: "center", gap: 8 }}
        >
          {t("verify.title")}
          {/* Décoratif ici (`alt` et `title` vides) : dans le titre, il ferait dire « certifié » au nom du dialogue. */}
          <VerifiedBadge size={20} labels={{ alt: "", title: "" }} />
        </h2>

        <p style={{ color: "var(--ink-mute)", fontSize: 13.5, lineHeight: 1.7, margin: "0 0 14px" }}>
          {richNodes(
            text.rich("verify.intro", { purpose: t("verify.purpose") }, { strong: (chunks) => <strong>{chunks}</strong> }),
          )}
        </p>
        {/* Seul un tag certifié reçoit les messages privés de match (portée
            `certified`) : le joueur le lit avant de renoncer. */}
        <p id="discord-verify-match-dms" style={{ color: "var(--ink-mute)", fontSize: 13.5, lineHeight: 1.7, margin: "0 0 14px" }}>
          {t("verify.matchDms")}
        </p>

        <p
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.09em",
            color: "var(--ink-mute)",
            margin: "0 0 8px",
          }}
        >
          {t("verify.exposureTitle")}
        </p>
        <ul
          id="discord-verify-exposure"
          style={{
            color: "var(--ink-mute)",
            fontSize: 13,
            lineHeight: 1.7,
            margin: "0 0 16px",
            paddingLeft: 18,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {EXPOSURE_KEYS.map((key) => (
            <li key={key}>{t(`verify.exposure.${key}`)}</li>
          ))}
        </ul>

        {renderStep()}
      </ScrollArea>
      </div>
    </div>,
    document.body,
  );
}
