"use client";

/**
 * « Applications connectées » — les portes d'entrée du compte, sur `/profil`.
 *
 * **Ce que cette section remplace.** La connexion Google revendiquait un compte
 * existant dès que l'adresse correspondait : c'était le seul moyen, pour un
 * joueur entré par Discord, de se connecter ensuite par Google. Une adresse
 * n'est pas une preuve d'identité, et le site n'a plus à en collecter. Le geste
 * se fait donc ici, où le joueur est **déjà connecté** — ce qui est une preuve
 * autrement plus solide — et où il voit ce qu'il ajoute.
 *
 * **Le rattachement quitte la page.** Ajouter une application demande un
 * aller-retour chez le fournisseur, donc une navigation, pas un appel de fond :
 * le bouton est un lien vers `/api/auth/<slug>/start?intent=link`, et le retour
 * atterrit ici avec `?connected=` ou `?connection_error=`. Le retrait, lui, est
 * un `DELETE` ordinaire.
 *
 * **Le dernier moyen de connexion ne se retire pas**, et le bouton le dit avant
 * le clic : la règle vient du module pur partagé avec la route
 * (`lib/shared/account-connections.ts`), si bien qu'un bouton actif mène
 * toujours quelque part.
 */
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ui/toast";
import {
  checkConnectionUnlink,
  discordBotRowState,
  discordButtonLinked,
  type AccountConnection,
} from "@/lib/shared/account-connections";
import {
  OAUTH_PROVIDER_HANDLE_LABELS,
  OAUTH_PROVIDER_LABELS,
  OAUTH_PROVIDER_SLUGS,
  oauthProviderFromSlug,
  oauthStartPath,
  type OAuthProvider,
} from "@/lib/shared/oauth-providers";
import { identityStep, type IdentityStep } from "@/lib/shared/identity-steps";
import { Pill, type PillVariant } from "@/components/cyber/Pill";
import { useProfileText } from "@/components/i18n/profile-text";
import { AudienceList, InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { useAppLocale } from "@/components/i18n/locale-context";
import {
  connectionMethodText,
  connectionRefusalText,
  discordBotRowText,
  hiddenBattletagAudienceText,
  type ProfileText,
} from "./_lib/profile-text";
import { DiscordBotHandleDialog } from "./DiscordBotHandleDialog";
import { connectionErrorMessage, connectionSuccessMessage, unlinkSuccessMessage } from "./connection-errors";
import { OtherSessionsPanel } from "./OtherSessionsPanel";
import s from "./profil.module.css";
import { busyAriaLabel } from "@/lib/shared/busy-aria-label";
import { visibleText } from "@/lib/shared/visible-text";


/**
 * Ce que la liste lit à la page pour dire « lié », « à certifier » ou
 * « certifié » — la certification n'est pas dans la liste des rattachements.
 */
export type IdentityContext = {
  /** L'état Discord est-il lu ? Sinon, aucun geste de certification n'est proposé. */
  discordKnown: boolean;
  discordHasTag: boolean;
  discordVerified: boolean;
  /** Le profil est-il lu ? Sinon, la provenance du BattleTag est inconnue et rien ne s'en dit. */
  battletagKnown: boolean;
  /** Le BattleTag enregistré vient de Blizzard (et non d'une saisie). */
  battletagFromBlizzard: boolean;
  /** Ouvre la fenêtre de certification du tag Discord. */
  onCertifyDiscord: () => void;
};

type StateKey = "UNLINKED" | "LINKED" | "LINKED_TO_CERTIFY" | "LINKED_NO_BATTLETAG" | "CERTIFIED";

const STAGE_PILL: Record<StateKey, PillVariant> = {
  UNLINKED: "neutral",
  LINKED_TO_CERTIFY: "warning",
  LINKED_NO_BATTLETAG: "info",
  LINKED: "info",
  CERTIFIED: "success",
};

/**
 * L'étape d'une ligne : le geste suivant, la clé du mot d'état, et si Battle.net
 * est lié sans BattleTag fourni. Tant que l'état Discord n'est pas lu, ni
 * « certifié » ni « à certifier » ne se disent.
 */
function rowStage(
  connection: AccountConnection,
  identity: IdentityContext,
): { action: IdentityStep["action"]; key: StateKey; blizzardNoTag: boolean } {
  const step = identityStep(connection.provider, {
    linked: connection.linked,
    discordHasTag: identity.discordHasTag,
    discordVerified: identity.discordVerified,
    battletagFromBlizzard: identity.battletagFromBlizzard,
  });
  const unread =
    connection.linked &&
    ((connection.provider === "DISCORD" && !identity.discordKnown) ||
      (connection.provider === "BLIZZARD" && !identity.battletagKnown));
  return {
    action: unread ? null : step.action,
    key: unread ? "LINKED" : stateKey(connection.provider, step),
    blizzardNoTag: !unread && connection.provider === "BLIZZARD" && step.stage === "LINKED",
  };
}

/** La clé de `connections.state` qui dit l'étape. */
function stateKey(provider: OAuthProvider, step: IdentityStep): StateKey {
  if (step.stage === "UNLINKED" || step.stage === "CERTIFIED") return step.stage;
  if (!step.certifiable) return "LINKED";
  if (provider === "BLIZZARD") return "LINKED_NO_BATTLETAG";
  // Sans tag à certifier, le geste est d'en poser un : « à certifier » serait faux.
  return step.action === "CERTIFY" ? "LINKED_TO_CERTIFY" : "LINKED";
}

export function ConnectedAppsSection({
  /**
   * La liste, **chargée par la page** (`useAccountConnections.ts`).
   *
   * Elle vivait ici, où elle n'avait qu'un lecteur. Elle en a un second depuis
   * que le champ « BattleTag Overwatch » se verrouille sous un compte Blizzard
   * rattaché, et deux `fetch` pour la même donnée en feraient deux vérités :
   * le temps d'un retrait, la section dirait « Rattacher » pendant que le champ
   * d'en haut resterait fermé.
   *
   * `null` = pas encore lue, ce que la section annonce plutôt que de rendre une
   * liste vide — qui se lirait « aucune application », l'inverse de la vérité.
   */
  connections,
  /** Relit la liste après une écriture, pour les **deux** lecteurs à la fois. */
  reload,
  /**
   * Appelée dès qu'un rattachement ou un retrait a abouti.
   *
   * Rattacher Discord **réécrit** le tag (et le décertifie s'il a changé), le
   * retirer **décertifie** : la pastille et le bouton « Certifier mon tag » du
   * formulaire d'à côté doivent suivre dans le même geste, sinon l'écran
   * annonce une exposition qui n'existe plus. Le profil relit son état
   * Discord, comme il le fait déjà après chaque sauvegarde.
   */
  onChanged,
  /**
   * Appelée avec le pseudo écrit par « Mettre à jour mon pseudo » (ligne du
   * bot) : le champ « Tag Discord » de la page le reprend sur-le-champ.
   */
  onDiscordTagChanged,
  /**
   * Appelée quand Discord vient d'être détaché : le serveur a retiré la
   * certification, l'écran la retire sans attendre la relecture de l'état
   * Discord (qui se tait quand elle échoue).
   */
  onDiscordUnlinked,
  /** Ce que la page sait déjà de la certification, pour dire le geste suivant. */
  identity,
  /** Le contenu qui suit la liste (les champs d'identifiants), avant les sessions. */
  children,
}: Readonly<{
  identity: IdentityContext;
  children?: React.ReactNode;
  connections: AccountConnection[] | null;
  reload: () => Promise<void>;
  onChanged?: () => void;
  onDiscordTagChanged?: (tag: string) => void;
  onDiscordUnlinked?: () => void;
}>): React.ReactElement {
  const { showError, showSuccess } = useToast();
  const text = useProfileText();
  const [busy, setBusy] = useState<OAuthProvider | null>(null);
  const unlinking = useRef(false);
  // Le dialogue « Mettre à jour mon pseudo » de la ligne du bot, s'il est ouvert.
  const [botDialog, setBotDialog] = useState<"UPDATE" | "LINK" | null>(null);
  // Un retrait ferme les autres sessions : le compte d'à côté doit être relu.
  const [sessionsVersion, setSessionsVersion] = useState(0);

  // Le retour d'un aller-retour de rattachement. L'URL est **nettoyée** dans la
  // foulée : sans cela, un rafraîchissement rejouerait le message, et un profil
  // partagé par copier-coller annoncerait un rattachement à son lecteur.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const failed = params.get("connection_error");
    if (!connected && !failed) return;

    if (connected) {
      showSuccess(
        connectionSuccessMessage(oauthProviderFromSlug(connected), params.get("refreshed") === "1", text),
      );
      onChanged?.();
    } else {
      showError(connectionErrorMessage(failed, text));
    }

    params.delete("connected");
    params.delete("connection_error");
    params.delete("provider");
    params.delete("refreshed");
    const query = params.toString();
    const search = query ? `?${query}` : "";
    window.history.replaceState(null, "", `${window.location.pathname}${search}`);
    // `onChanged` est volontairement hors des dépendances : la fonction vient du
    // parent et change à chaque rendu, ce qui rejouerait ce message à l'infini.
    // Le nettoyage de l'URL, lui, garantit qu'il ne part qu'une fois.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showError, showSuccess, text]);

  const unlink = async (provider: OAuthProvider) => {
    // Garde par référence, lue sans attendre de rendu : deux activations rapprochées
    // n'envoient qu'un retrait (revue de sécurité du lot 9-2).
    if (unlinking.current) return;
    unlinking.current = true;
    setBusy(provider);
    try {
      const res = await fetch(`/api/profile/connections/${OAUTH_PROVIDER_SLUGS[provider]}`, {
        method: "DELETE",
      });
      const payload = (await res.json()) as { error?: string; revokedSessions?: number | null };
      if (!res.ok) throw new Error(payload.error ?? "");
      showSuccess(unlinkSuccessMessage(provider, payload.revokedSessions ?? null, text));
      setSessionsVersion((version) => version + 1);
      // La certification tombe tout de suite à l'écran, et l'état Discord se
      // relit en même temps que la liste, pas après elle.
      if (provider === "DISCORD") onDiscordUnlinked?.();
      onChanged?.();
      await reload();
    } catch (e) {
      // Traduit ici et non au `throw` : une coupure réseau lève un `TypeError`
      // dont le message anglais partait sinon tel quel dans la notification.
      showError(connectionErrorMessage((e as Error).message, text));
    } finally {
      unlinking.current = false;
      setBusy(null);
    }
  };

  /*
    **Aucun cadre, aucun titre : la section les porte déjà.** Ce bloc vivait
    seul sur la page et se dessinait lui-même : son propre cadre, son propre
    titre de niveau 2. Rendu
    depuis `<ProfileSection>`, qui pose l'un et l'autre depuis le registre, il
    donnait une carte dans une carte et le titre « Applications connectées »
    écrit deux fois au même niveau. Le composant ne rend donc plus que son
    contenu ; l'ancre, le titre et la promesse viennent du registre.
  */
  return (
    <>
      <InfoHintRow>
        <h3 className={s.subTitle}>{text.t("connections.heading")}</h3>
        <InfoHint id="connections-intro-more" subject={text.t("connections.heading")}>
          <p>{text.t("connections.intro")}</p>
        </InfoHint>
      </InfoHintRow>

      {connections === null ? (
        <p style={{ fontSize: 13, color: "var(--ink-quiet)", margin: 0 }}>{text.t("connections.loading")}</p>
      ) : (
        <div className="table-like">
          {connections.map((rawConnection) => (
            <ConnectionRow
              key={rawConnection.provider}
              rawConnection={rawConnection}
              connections={connections}
              identity={identity}
              busy={busy}
              onUnlink={(provider) => void unlink(provider)}
              onBotDialog={setBotDialog}
            />
          ))}
        </div>
      )}

      {botDialog ? (
        <DiscordBotHandleDialog
          mode={botDialog}
          onClose={() => setBotDialog(null)}
          onUpdated={(tag) => {
            setBotDialog(null);
            if (tag) onDiscordTagChanged?.(tag);
            void reload();
            onChanged?.();
          }}
        />
      ) : null}

      {children ? <div className={s.accountFields}>{children}</div> : null}

      <OtherSessionsPanel version={sessionsVersion} />
    </>
  );
}

/**
 * Une ligne de la liste : un fournisseur, son état et son geste (rattacher ou
 * retirer) — suivie, pour Discord, de la ligne du bot.
 */
function ConnectionRow({
  rawConnection,
  connections,
  identity,
  busy,
  onUnlink,
  onBotDialog,
}: Readonly<{
  identity: IdentityContext;
  rawConnection: AccountConnection;
  connections: AccountConnection[];
  busy: OAuthProvider | null;
  onUnlink: (provider: OAuthProvider) => void;
  onBotDialog: (mode: "UPDATE" | "LINK") => void;
}>): React.ReactElement {
  const text = useProfileText();
  const { t } = text;
  // Discord a deux lignes pour une seule identité : la ligne du bouton
  // ne se dit rattachée que si ce n'est pas le code qui porte le
  // rattachement (`discordButtonLinked`) — sinon, c'est la ligne du bot
  // qui le porte, et celle-ci propose d'ajouter le bouton.
  const connection =
    rawConnection.provider === "DISCORD"
      ? { ...rawConnection, linked: discordButtonLinked(rawConnection) }
      : rawConnection;
  const discordByCode =
    rawConnection.provider === "DISCORD" && rawConnection.linked && !connection.linked;
  const refusal = checkConnectionUnlink(connections, connection.provider);
  const label = OAUTH_PROVIDER_LABELS[connection.provider];
  const slug = OAUTH_PROVIDER_SLUGS[connection.provider];
  const detailsId = `connection-details-${slug}`;
  const stateId = `connection-state-${slug}`;
  const methodId = `connection-method-${slug}`;
  // Calculé une fois : la condition et le rendu doivent dire la même
  // chose, et le module est la seule autorité sur « y a-t-il quelque
  // chose à dire ? ».
  const methodLabel = connection.linked ? connectionMethodText(text, connection) : null;
  const details = connectionDetails(text, connection, discordByCode);
  // L'étape se lit sur le rattachement **réel** (Discord lié par code compte), non
  // sur la porte du bouton : sinon « Non lié » côté bouton masquerait le tag à certifier.
  const { action, key, blizzardNoTag } = rowStage(rawConnection, identity);
  const stateWord = t(`connections.state.${key}`);
  const pillVariant = STAGE_PILL[key];
  return (
    <>
      <div className={`table-row ${s.connectionRow}`}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <InfoHintRow>
            <span className={s.connectionName}>
              {/* Témoin décoratif : vert d'eau lumineux si rattaché. L'état se
                  lit déjà en toutes lettres dans la ligne de détail (« Rattaché »
                  ou le pseudo) — aucun texte en double. */}
              <span
                aria-hidden="true"
                className={`${s.connectionDot} ${connection.linked ? s.connectionDotOn : ""}`}
              />
              <strong style={{ fontSize: 14 }}>{label}</strong>
              <Pill variant={pillVariant} id={stateId}>{stateWord}</Pill>
            </span>
            <ProviderHint provider={connection.provider} />
          </InfoHintRow>
          <span id={detailsId} style={{ fontSize: 11, color: "var(--ink-quiet)", lineHeight: 1.5 }}>
            {details}
          </span>
          {blizzardNoTag ? (
            <span style={{ fontSize: 11, color: "var(--ink-dim)", lineHeight: 1.5 }}>
              {t("connections.blizzardNoTag")}
            </span>
          ) : null}
          {/*
            **Ce que « Rattaché » ne disait pas.** Discord a deux portes
            — le bouton, et le code reçu en message privé — et elles ne
            laissent pas la même trace : l'une pose une autorisation
            d'application chez Discord, que le joueur peut y révoquer,
            l'autre non. C'est exactement ce qu'une liste d'applications
            connectées doit dire. La phrase vient du module pur, qui
            rend `null` quand il n'y a rien à dire — un fournisseur à
            porte unique, ou un rattachement antérieur à cette colonne,
            qui ne se classe pas après coup.
          */}
          {methodLabel ? (
            <span
              id={methodId}
              style={{ fontSize: 11, color: "var(--ink-dim)", lineHeight: 1.5 }}
            >
              {methodLabel}
            </span>
          ) : null}
          {/*
            **Le motif vit dans la colonne de texte, pas à la place du
            bouton.** Posé dans la cellule d'actions — large de la
            largeur d'un bouton —, il s'y repliait en quatre lignes de
            chasse fixe alignées à droite : une phrase qu'on déchiffre au
            lieu de la lire, à l'endroit précis où l'œil cherche un
            contrôle. Ici elle se lit d'un trait, et la cellule
            d'actions reste vide, ce qui est l'information.
          */}
          {connection.linked && refusal === "LAST_CONNECTION" ? (
            <span style={{ fontSize: 11, color: "var(--amber)", lineHeight: 1.5, marginTop: 2 }}>
              {connectionRefusalText(text, refusal, connection.provider)}
            </span>
          ) : null}
        </div>

        <ConnectionActions
          connection={connection}
          action={action}
          refusal={refusal}
          busy={busy}
          detailsId={`${stateId} ${detailsId}`}
          methodId={methodLabel ? methodId : null}
          onCertify={identity.onCertifyDiscord}
          onUnlink={onUnlink}
        />
      </div>
      {connection.provider === "DISCORD" ? (
        <DiscordBotRow
          connections={connections}
          busy={busy !== null}
          disconnecting={busy === "DISCORD"}
          onUpdate={onBotDialog}
          onDisconnect={() => onUnlink("DISCORD")}
        />
      ) : null}
    </>
  );
}

/** Les gestes d'une ligne : le geste suivant en bouton principal, puis le retrait. */
function ConnectionActions({
  connection,
  action,
  refusal,
  busy,
  detailsId,
  methodId,
  onCertify,
  onUnlink,
}: Readonly<{
  connection: AccountConnection;
  action: IdentityStep["action"];
  refusal: ReturnType<typeof checkConnectionUnlink>;
  busy: OAuthProvider | null;
  detailsId: string;
  methodId: string | null;
  onCertify: () => void;
  onUnlink: (provider: OAuthProvider) => void;
}>): React.ReactElement {
  const { t } = useProfileText();
  // La langue de l'adresse (seule l'URL dit la langue) pour l'aller-retour OAuth : si
  // l'anglais du profil n'a pas pu se charger, le texte retombe sur le français, mais
  // le lecteur de `/en/profil` doit y revenir (revue de sécurité du lot 9-2).
  const locale = useAppLocale();
  const label = OAUTH_PROVIDER_LABELS[connection.provider];
  return (
    <span style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap" }}>
      {action === "CERTIFY" || action === "REGISTER" ? (
        <button
          type="button"
          className="btn"
          onClick={onCertify}
          aria-label={t(action === "CERTIFY" ? "discord.certifyLabel" : "discord.registerLabel")}
          aria-describedby={detailsId}
          style={{ padding: "4px 12px", fontSize: 12 }}
        >
          {t(action === "CERTIFY" ? "discord.certify" : "discord.register")}
        </button>
      ) : null}
      {connection.linked && refusal !== "LAST_CONNECTION" ? (
        <button
          type="button"
          className="btn ghost"
          /* `aria-disabled`, pas `disabled` : le focus reste sur le bouton pendant le geste. */
          aria-disabled={busy !== null || undefined}
          onClick={() => busy === null && onUnlink(connection.provider)}
          aria-label={busyAriaLabel(busy === connection.provider, t("connections.unlinkLabel", { label }))}
          /* La **porte** fait partie de ce qui décrit ce bouton :
             laissée hors de la description, elle n'était lue par
             personne au clavier — un lecteur d'écran qui parcourt
             les contrôles ne rencontre jamais le texte voisin. */
          aria-describedby={methodId ? `${detailsId} ${methodId}` : detailsId}
          style={{ padding: "4px 12px", fontSize: 12 }}
        >
          {busy === connection.provider ? t("connections.unlinking") : t("connections.unlink")}
        </button>
      ) : null}
      {connection.linked ? null : (
        <a
          className={action === "LINK" ? "btn" : "btn ghost"}
          href={oauthStartPath(connection.provider, { intent: "LINK", locale })}
          aria-label={t("connections.linkLabel", { label })}
          /* Ce que le fournisseur apporte tient dans la ligne d'à
             côté : `aria-describedby` la rattache au contrôle plutôt
             que de la laisser en texte voisin, qu'un lecteur d'écran
             parcourant les liens ne rencontre jamais. */
          aria-describedby={detailsId}
          style={{ padding: "4px 12px", fontSize: 12 }}
        >
          {t("connections.link")}
        </a>
      )}
    </span>
  );
}

/**
 * Le « i » d'une ligne : pour Battle.net seulement, ce que la pastille dit et
 * qui lit encore un BattleTag masqué — rattaché ou non.
 */
function ProviderHint({ provider }: Readonly<{ provider: OAuthProvider }>): React.ReactElement | null {
  const text = useProfileText();
  if (provider !== "BLIZZARD") return null;
  return (
    <InfoHint id={`connection-more-${OAUTH_PROVIDER_SLUGS[provider]}`} subject={OAUTH_PROVIDER_LABELS[provider]}>
      <p>{text.t("connections.blizzardBadge")}</p>
      <AudienceList lines={hiddenBattletagAudienceText(text)} />
    </InfoHint>
  );
}

/** Ce que la ligne dit du rattachement, sous le nom du fournisseur. */
function connectionDetails(text: ProfileText, connection: AccountConnection, discordByCode: boolean): string {
  const { t } = text;
  if (connection.linked) {
    // Le registre dit quel fournisseur a un identifiant à montrer (Google : aucun) ;
    // chacun a son libellé traduit sous `connections.handleLabels` (testé).
    if (connection.handle && OAUTH_PROVIDER_HANDLE_LABELS[connection.provider] !== null) {
      const labelKey = `connections.handleLabels.${connection.provider}` as Parameters<typeof t>[0];
      return t("connections.handleLine", { label: t(labelKey), handle: visibleText(connection.handle) });
    }
    return t("connections.linked");
  }
  if (discordByCode) return t("connections.discordByCode");
  return t(`connections.notes.${connection.provider}`);
}

/**
 * La ligne « Bot Discord (code par message privé) ».
 *
 * Elle décrit la **même** identité Discord que la ligne du bouton — le compte
 * n'en a qu'une —, mais la porte du code : ce que la ligne affiche et permet
 * vient du module pur (`discordBotRowState`), partagé avec les tests.
 */
function DiscordBotRow({
  connections,
  busy,
  disconnecting,
  onUpdate,
  onDisconnect,
}: Readonly<{
  connections: AccountConnection[];
  busy: boolean;
  disconnecting: boolean;
  onUpdate: (mode: "UPDATE" | "LINK") => void;
  onDisconnect: () => void;
}>): React.ReactElement {
  const text = useProfileText();
  const { t } = text;
  const row = discordBotRowState(connections);
  const words = discordBotRowText(text, row);
  const detailsId = "connection-details-discord-bot";
  return (
    <div className="table-row" style={{ alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <strong style={{ fontSize: 14 }}>{t("connections.bot.label")}</strong>
        <span id={detailsId} style={{ fontSize: 11, color: "var(--ink-quiet)", lineHeight: 1.5 }}>
          {words.note}
        </span>
        {words.refusal ? (
          <span style={{ fontSize: 11, color: "var(--amber)", lineHeight: 1.5, marginTop: 2 }}>
            {words.refusal}
          </span>
        ) : null}
      </span>
      <span
        style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap" }}
      >
        <button
          type="button"
          className={row.handleAction === "LINK" ? "btn" : "btn ghost"}
          aria-disabled={busy || undefined}
          onClick={() => !busy && onUpdate(row.handleAction)}
          aria-describedby={detailsId}
          style={{ padding: "4px 12px", fontSize: 12 }}
        >
          {row.handleAction === "LINK" ? t("connections.bot.linkByCode") : t("connections.bot.updateHandle")}
        </button>
        {row.canDisconnect ? (
          <button
            type="button"
            className="btn ghost"
            aria-disabled={busy || undefined}
            onClick={() => !busy && onDisconnect()}
            aria-label={busyAriaLabel(disconnecting, t("connections.bot.disconnectLabel"))}
            aria-describedby={detailsId}
            style={{ padding: "4px 12px", fontSize: 12 }}
          >
            {disconnecting ? t("connections.bot.disconnecting") : t("connections.bot.disconnect")}
          </button>
        ) : null}
      </span>
    </div>
  );
}
