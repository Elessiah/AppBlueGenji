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
import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/toast";
import {
  checkConnectionUnlink,
  connectionMethodLabel,
  connectionUnlinkRefusalMessage,
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
import { connectionErrorMessage, connectionSuccessMessage } from "./connection-errors";
import s from "./profil.module.css";

/** Ce que chaque porte apporte au compte, en plus d'une session. */
const PROVIDER_NOTES: Record<OAuthProvider, string> = {
  GOOGLE: "Connexion en un clic. Aucune adresse n'est enregistrée.",
  DISCORD: "Connexion, certification de ton tag, et rappels de match en message privé.",
  BLIZZARD: "Connexion, et ton BattleTag tenu à jour par Blizzard.",
};

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
   * Rattacher Discord **certifie** le tag, le retirer **décertifie** : la
   * pastille du formulaire d'à côté doit tomber ou apparaître dans le même
   * geste, sinon l'écran annonce une exposition qui n'existe pas (ou tait celle
   * qui vient de commencer). Le profil relit son état Discord, comme il le fait
   * déjà après chaque sauvegarde.
   */
  onChanged,
}: {
  connections: AccountConnection[] | null;
  reload: () => Promise<void>;
  onChanged?: () => void;
}): React.ReactElement {
  const { showError, showSuccess } = useToast();
  const [busy, setBusy] = useState<OAuthProvider | null>(null);

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
        connectionSuccessMessage(oauthProviderFromSlug(connected), params.get("refreshed") === "1"),
      );
      onChanged?.();
    } else {
      showError(connectionErrorMessage(failed));
    }

    params.delete("connected");
    params.delete("connection_error");
    params.delete("provider");
    params.delete("refreshed");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    // `onChanged` est volontairement hors des dépendances : la fonction vient du
    // parent et change à chaque rendu, ce qui rejouerait ce message à l'infini.
    // Le nettoyage de l'URL, lui, garantit qu'il ne part qu'une fois.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showError, showSuccess]);

  const unlink = async (provider: OAuthProvider) => {
    setBusy(provider);
    try {
      const res = await fetch(`/api/profile/connections/${OAUTH_PROVIDER_SLUGS[provider]}`, {
        method: "DELETE",
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? "");
      showSuccess(`${OAUTH_PROVIDER_LABELS[provider]} a été retiré de ton compte.`);
      await reload();
      onChanged?.();
    } catch (e) {
      // Traduit ici et non au `throw` : une coupure réseau lève un `TypeError`
      // dont le message anglais partait sinon tel quel dans la notification.
      showError(connectionErrorMessage((e as Error).message));
    } finally {
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
      <p className={`${s.hint} ${s.hintMuted}`} style={{ marginTop: 0, marginBottom: 16 }}>
        Ton compte n&apos;a pas de mot de passe : il s&apos;ouvre par les applications
        rattachées ci-dessous. Tu peux en ajouter plusieurs pour ne jamais rester à la porte —
        la dernière ne peut pas être retirée.
      </p>

      {connections === null ? (
        <p style={{ fontSize: 13, color: "var(--text-2)", margin: 0 }}>Chargement…</p>
      ) : (
        <div className="table-like">
          {connections.map((connection) => {
            const refusal = checkConnectionUnlink(connections, connection.provider);
            const label = OAUTH_PROVIDER_LABELS[connection.provider];
            const handleLabel = OAUTH_PROVIDER_HANDLE_LABELS[connection.provider];
            const slug = OAUTH_PROVIDER_SLUGS[connection.provider];
            const detailsId = `connection-details-${slug}`;
            const methodId = `connection-method-${slug}`;
            // Calculé une fois : la condition et le rendu doivent dire la même
            // chose, et le module est la seule autorité sur « y a-t-il quelque
            // chose à dire ? ».
            const methodLabel = connection.linked ? connectionMethodLabel(connection) : null;
            return (
              <div
                className="table-row"
                key={connection.provider}
                style={{ alignItems: "center", gap: 12, flexWrap: "wrap" }}
              >
                <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <strong style={{ fontSize: 14 }}>{label}</strong>
                  <span id={detailsId} style={{ fontSize: 11, color: "var(--text-2)", lineHeight: 1.5 }}>
                    {connection.linked
                      ? connection.handle && handleLabel
                        ? `${handleLabel} : ${connection.handle}`
                        : "Rattaché"
                      : PROVIDER_NOTES[connection.provider]}
                  </span>
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
                      {connectionUnlinkRefusalMessage(refusal, connection.provider)}
                    </span>
                  ) : null}
                </span>

                <span style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
                  {connection.linked ? (
                    refusal === "LAST_CONNECTION" ? null : (
                      <button
                        type="button"
                        className="btn ghost"
                        disabled={busy !== null}
                        onClick={() => unlink(connection.provider)}
                        aria-label={`Retirer ${label} de mon compte`}
                        /* La **porte** fait partie de ce qui décrit ce bouton :
                           laissée hors de la description, elle n'était lue par
                           personne au clavier — un lecteur d'écran qui parcourt
                           les contrôles ne rencontre jamais le texte voisin. */
                        aria-describedby={methodLabel ? `${detailsId} ${methodId}` : detailsId}
                        style={{ padding: "4px 12px", fontSize: 12 }}
                      >
                        {busy === connection.provider ? "Retrait…" : "Retirer"}
                      </button>
                    )
                  ) : (
                    <a
                      className="btn"
                      href={oauthStartPath(connection.provider, { intent: "LINK" })}
                      aria-label={`Rattacher ${label} à mon compte`}
                      /* Ce que le fournisseur apporte tient dans la ligne d'à
                         côté : `aria-describedby` la rattache au contrôle plutôt
                         que de la laisser en texte voisin, qu'un lecteur d'écran
                         parcourant les liens ne rencontre jamais. */
                      aria-describedby={detailsId}
                      style={{ padding: "4px 12px", fontSize: 12 }}
                    >
                      Rattacher
                    </a>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
