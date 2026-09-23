"use client";

import { UserAvatar } from "@/components/user-avatar";
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LogoutButton } from "@/components/logout-button";
import { Coche } from "@/components/Coche";
import type { FullProfileResponse } from "@/lib/shared/types";
import { useToast } from "@/components/ui/toast";
import { TeamLink } from "@/components/entity-link";
import { VerifiedBadge } from "@/components/discord-tag";
import {
  discordTagLockNotice,
  isDiscordTagLocked,
} from "@/lib/shared/discord-tag-lock";
import { profileErrorMessage, profileLoadErrorMessage } from "./profile-errors";
import { DiscordVerificationDialog } from "./DiscordVerificationDialog";
import { ConnectedAppsSection } from "./ConnectedAppsSection";

// Le pseudo n'est plus masquable : identité de base du joueur sur la plateforme.
const VISIBILITY_LABELS: Record<string, string> = {
  avatar: "Avatar",
  overwatch: "BattleTag OW",
  marvel: "Tag Marvel",
  major: "Majorité",
};

const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export default function ProfilePage() {
  const router = useRouter();
  const { showError, showSuccess } = useToast();
  const [data, setData] = useState<FullProfileResponse | null>(null);

  const [pseudo, setPseudo] = useState("");
  const [overwatchBattletag, setOverwatchBattletag] = useState("");
  const [marvelRivalsTag, setMarvelRivalsTag] = useState("");
  const [discordPseudo, setDiscordPseudo] = useState("");
  // État Discord du compte, lu à part du formulaire : la certification porte sur
  // ce qui est **enregistré**, pas sur ce qui est en train d'être tapé. Un champ
  // modifié sans être sauvegardé ne doit ni gagner ni perdre la pastille.
  //
  // `linked` vaut `null` tant que l'état n'a pas été **lu** : ni rattaché ni
  // libre, inconnu. Partir de `false` revenait à affirmer le cas qui ouvre le
  // champ, donc à l'ouvrir au premier rendu et à le laisser ouvert si l'appel
  // échouait — le tag alors saisi faisait refuser toute la sauvegarde en 409.
  const [discordState, setDiscordState] = useState<{
    tag: string | null;
    verified: boolean;
    linked: boolean | null;
  }>({ tag: null, verified: false, linked: null });
  // Le tag **tel qu'il est enregistré**, indépendamment de ce qui est tapé : il
  // décide si la sauvegarde a quelque chose à dire sur ce champ. Sans lui, la
  // seule façon de le savoir était l'état du verrou — un renseignement que
  // l'écran peut avoir périmé (voir `onSubmit`).
  const [savedDiscordPseudo, setSavedDiscordPseudo] = useState("");
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [isAdult, setIsAdult] = useState<string>("unknown");
  const [deleting, setDeleting] = useState(false);
  const [openToRecruitment, setOpenToRecruitment] = useState(true);
  const [visibility, setVisibility] = useState({
    avatar: false,
    overwatch: false,
    marvel: false,
    major: false,
  });
  const [avatarBusy, setAvatarBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [invitations, setInvitations] = useState<{ id: number; teamId: number; teamName: string }[]>([]);

  const loadInvitations = async () => {
    try {
      const res = await fetch("/api/me/invitations", { cache: "no-store" });
      if (!res.ok) return;
      const payload = (await res.json()) as { invitations?: { id: number; teamId: number; teamName: string }[] };
      setInvitations(payload.invitations ?? []);
    } catch {
      // silencieux
    }
  };

  // **Vrai dès le premier rendu** : une lecture part au montage, et partir de
  // `false` laissait une fenêtre — entre le premier rendu et l'effet — où
  // l'écran annonçait une panne de lecture avant d'avoir essayé quoi que ce
  // soit.
  const [discordStateBusy, setDiscordStateBusy] = useState(true);

  const loadDiscordState = async () => {
    setDiscordStateBusy(true);
    try {
      const res = await fetch("/api/profile/discord", { cache: "no-store" });
      if (!res.ok) return;
      setDiscordState((await res.json()) as { tag: string | null; verified: boolean; linked: boolean });
    } catch {
      // Silencieux, mais **pas anodin** : l'état reste `linked: null`, donc le
      // champ reste verrouillé. Le reste du formulaire s'enregistre normalement,
      // et le bouton « Réessayer » ci-dessous rouvre le seul chemin fermé.
    } finally {
      setDiscordStateBusy(false);
    }
  };

  useEffect(() => {
    loadInvitations();
    loadDiscordState();
  }, []);

  const respondInvitation = async (invitationId: number, accept: boolean) => {
    try {
      const res = await fetch(`/api/invitations/${invitationId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accept }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error || "INVITATION_RESPOND_FAILED");
      showSuccess(accept ? "Invitation acceptée." : "Invitation refusée.");
      await loadInvitations();
    } catch (e) {
      showError((e as Error).message);
    }
  };

  useEffect(() => {
    const load = async () => {
      const response = await fetch("/api/profile", { cache: "no-store" });
      const payload = (await response.json()) as FullProfileResponse & { error?: string };
      if (!response.ok) {
        const errorCode = payload.error || "PROFILE_LOAD_FAILED";
        if (errorCode === "PROFILE_NOT_FOUND") {
          showError(profileErrorMessage(errorCode));
          setTimeout(() => router.push("/"), 1500);
          return;
        }
        throw new Error(errorCode);
      }
      setData(payload);
      setPseudo(payload.profile.pseudo);
      setOverwatchBattletag(payload.profile.overwatchBattletag || "");
      setMarvelRivalsTag(payload.profile.marvelRivalsTag || "");
      setDiscordPseudo(payload.profile.discordPseudo || "");
      setSavedDiscordPseudo(payload.profile.discordPseudo || "");
      setIsAdult(payload.profile.isAdult === null ? "unknown" : payload.profile.isAdult ? "yes" : "no");
      const v = payload.profile.visibility;
      setOpenToRecruitment(payload.profile.openToRecruitment !== false);
      setVisibility({
        avatar: !!v.avatar,
        overwatch: !!v.overwatch,
        marvel: !!v.marvel,
        major: !!v.major,
      });
    };
    // Les chemins de **lecture** passent par le registre, comme les écritures —
    // `profile-errors.ts` s'interdit en toutes lettres de laisser sortir un code
    // en capitales dans un toast, et un `UNAUTHORIZED` brut n'aide personne —
    // mais avec **leur** repli : « La sauvegarde a échoué » annonçait à un
    // visiteur qui vient d'ouvrir la page l'échec d'un geste qu'il n'a pas
    // fait. Les codes nommés (session expirée, compte introuvable) gardent
    // leur phrase, qui vaut des deux côtés.
    load().catch((e) => showError(profileLoadErrorMessage((e as Error).message)));
  }, [showError, router]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      // **On ne soumet que ce qu'on a changé.** Le formulaire renvoyait le tag
      // de son instantané de montage à chaque sauvegarde, si bien qu'un tag
      // réécrit ailleurs entre-temps (renommage sur Discord puis connexion
      // depuis un autre appareil) faisait refuser **tout** le `PATCH` en 409 —
      // pseudo, visibilités et BattleTag emportés par un champ auquel personne
      // n'avait touché. Omettre la clé n'efface rien : le service ne touche
      // `discord_pseudo` que si le patch en parle.
      //
      // La condition porte sur la **valeur**, et non sur le verrou : le verrou
      // se lit sur un état que l'écran peut avoir périmé — un onglet ouvert
      // avant un rattachement fait ailleurs porte encore `linked: false`, et
      // c'est précisément le cas où le refus tombe. La valeur, elle, dit
      // exactement ce qu'il faut savoir : ce champ a-t-il quelque chose à
      // écrire ?
      const touchesDiscordTag = discordPseudo.trim() !== savedDiscordPseudo.trim();
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pseudo,
          overwatchBattletag: overwatchBattletag.trim() ? overwatchBattletag.trim() : null,
          marvelRivalsTag: marvelRivalsTag.trim() ? marvelRivalsTag.trim() : null,
          ...(touchesDiscordTag
            ? { discordPseudo: discordPseudo.trim() ? discordPseudo.trim() : null }
            : {}),
          isAdult: isAdult === "unknown" ? null : isAdult === "yes",
          visibility,
          openToRecruitment,
        }),
      });
      const payload = (await response.json()) as FullProfileResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "PROFILE_UPDATE_FAILED");
      setData(payload);
      setSavedDiscordPseudo(payload.profile.discordPseudo || "");
      // Une sauvegarde qui change le tag **annule la certification** côté
      // serveur : la pastille doit tomber dans le même geste, sinon l'écran
      // annonce une exposition qui n'existe plus.
      await loadDiscordState();
      showSuccess("Profil mis à jour.");
    } catch (e) {
      // Le registre du profil, et non celui de la certification : router ces
      // erreurs vers l'autre faisait annoncer « La certification a échoué » à un
      // pseudo déjà pris ou à une coupure réseau.
      showError(profileErrorMessage((e as Error).message));
    }
  };

  const [discordTagBusy, setDiscordTagBusy] = useState(false);

  /**
   * Retirer son tag Discord — l'annulation de l'exposition.
   *
   * Passe par la sauvegarde ordinaire du profil : c'est `updateOwnProfile` qui
   * décertifie en même temps qu'il efface, et un second chemin laisserait un
   * compte certifié sur un tag qu'il vient de retirer.
   */
  const onDiscordTagRemove = async () => {
    if (!window.confirm(
      "Retirer ton tag Discord ? L'organisation ne pourra plus te joindre pendant un tournoi.\n\nAttention : ta prochaine connexion par Discord le réenregistrera automatiquement, certifié. Pour ne plus être joignable durablement, entre par une autre porte.",
    )) {
      return;
    }
    setDiscordTagBusy(true);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ discordPseudo: null }),
      });
      const payload = (await response.json()) as FullProfileResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "PROFILE_UPDATE_FAILED");
      setData(payload);
      setDiscordPseudo("");
      setSavedDiscordPseudo("");
      // L'état est posé **depuis la réponse**, et non attendu d'une seconde
      // lecture : `loadDiscordState` se tait quand elle échoue, et l'écran
      // gardait alors la pastille et « ce pseudo est certifié : les
      // administrateurs le voient » à côté d'un champ qu'on vient de vider. La
      // réponse du `PATCH` porte déjà la vérité — le tag est parti, donc la
      // certification avec (toute modification du tag la défait).
      setDiscordState((prev) => ({ ...prev, tag: null, verified: false }));
      await loadDiscordState();
      showSuccess("Tag Discord retiré.");
    } catch (e) {
      showError(profileErrorMessage((e as Error).message));
    } finally {
      setDiscordTagBusy(false);
    }
  };

  const onDeleteAccount = async () => {
    if (!window.confirm(
      "Supprimer définitivement ton compte ? Tes informations personnelles seront effacées (le compte devient anonyme), mais tes statistiques resteront conservées. Cette action est irréversible.",
    )) {
      return;
    }
    setDeleting(true);
    try {
      const response = await fetch("/api/profile", { method: "DELETE" });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "ACCOUNT_DELETE_FAILED");
      showSuccess("Compte supprimé. Tes statistiques restent conservées de façon anonyme.");
      setTimeout(() => {
        window.location.href = "/";
      }, 1200);
    } catch (e) {
      showError((e as Error).message);
      setDeleting(false);
    }
  };

  const onAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!ACCEPTED_IMAGE_TYPES.includes(file.type) || file.size > MAX_IMAGE_BYTES) {
      showError("Image trop lourde ou format non supporté");
      return;
    }

    setAvatarBusy(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/profile/avatar", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as { avatarUrl?: string | null; error?: string };
      if (!response.ok) throw new Error(payload.error || "AVATAR_UPLOAD_FAILED");
      setData((prev) =>
        prev ? { ...prev, profile: { ...prev.profile, avatarUrl: payload.avatarUrl ?? null } } : prev,
      );
      showSuccess("Avatar mis à jour.");
    } catch (e) {
      showError((e as Error).message);
    } finally {
      setAvatarBusy(false);
    }
  };

  const onAvatarDelete = async () => {
    setAvatarBusy(true);
    try {
      const response = await fetch("/api/profile/avatar", { method: "DELETE" });
      const payload = (await response.json()) as { avatarUrl?: string | null; error?: string };
      if (!response.ok) throw new Error(payload.error || "AVATAR_DELETE_FAILED");
      setData((prev) =>
        prev ? { ...prev, profile: { ...prev.profile, avatarUrl: null } } : prev,
      );
      showSuccess("Avatar supprimé.");
    } catch (e) {
      showError((e as Error).message);
    } finally {
      setAvatarBusy(false);
    }
  };

  // Le verrou se lit sur le rattachement **enregistré**, jamais sur le champ en
  // cours de saisie : le formulaire ne doit ni ouvrir ni fermer ce qu'il montre.
  const discordLocked = isDiscordTagLocked(discordState);

  if (!data) return <section className="ds-block" style={{ color: "var(--text-2)" }}>Chargement du profil...</section>;

  return (
    <section className="fade-in">
      {verifyOpen && (
        <DiscordVerificationDialog
          initialTag={discordPseudo}
          /* L'inconnu n'est pas un rattachement : le dialogue n'est de toute
             façon atteignable qu'avec un état lu, ses deux boutons étant sous
             un `linked` connu. */
          linked={discordState.linked === true}
          onClose={() => setVerifyOpen(false)}
          onVerified={(tag) => {
            setVerifyOpen(false);
            setDiscordPseudo(tag);
            // La certification **écrit** le tag en base : la référence suit, au
            // même titre qu'après une sauvegarde. Laissée en arrière, elle
            // faisait resoumettre ce tag à chaque enregistrement ultérieur —
            // et un tag déplacé entre-temps faisait alors mourir tout le
            // `PATCH` en 409, exactement ce que cette référence existe pour
            // empêcher.
            setSavedDiscordPseudo(tag);
            setDiscordState((prev) => ({ ...prev, tag, verified: true, linked: true }));
          }}
        />
      )}
      <div className="ds-header">
        <div className="ds-header-body" style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <UserAvatar
            src={data.profile.avatarUrl}
            pseudo={data.profile.pseudo}
            size={60}
          />
          <div>
            <h1 className="ds-title blue" style={{ fontSize: "clamp(28px, 3vw, 42px)", marginBottom: 6 }}>
              Mon profil
            </h1>
            <p style={{ color: "var(--text-2)", margin: 0, fontSize: 14 }}>
              Pseudo et avatar publics par défaut — chaque information reste masquable
            </p>
          </div>
        </div>
      </div>

      <div className="ds-block" style={{ marginBottom: 20 }}>
        <div className="ds-section-title blue">
          <h2>Informations</h2>
        </div>

        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="form-grid">
            <div className="field">
              <label>Pseudo site</label>
              <input value={pseudo} onChange={(e) => setPseudo(e.target.value)} />
            </div>
            <div className="field">
              <label>Avatar</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={onAvatarChange}
                style={{ display: "none" }}
              />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn"
                  disabled={avatarBusy}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    padding: "9px 18px",
                    fontSize: 13,
                    opacity: avatarBusy ? 0.6 : 1,
                    cursor: avatarBusy ? "not-allowed" : "pointer",
                  }}
                >
                  {avatarBusy ? "Envoi…" : "Changer l'avatar"}
                </button>
                {data?.profile.avatarUrl ? (
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={avatarBusy}
                    onClick={onAvatarDelete}
                    style={{
                      padding: "9px 18px",
                      fontSize: 13,
                      opacity: avatarBusy ? 0.6 : 1,
                      cursor: avatarBusy ? "not-allowed" : "pointer",
                    }}
                  >
                    Supprimer
                  </button>
                ) : null}
              </div>
              <p style={{ fontSize: 11, color: "var(--text-2)", margin: "6px 0 0" }}>
                PNG, JPEG ou WebP — 5 Mo max
              </p>
            </div>
            <div className="field">
              <label>BattleTag Overwatch</label>
              <input value={overwatchBattletag} onChange={(e) => setOverwatchBattletag(e.target.value)} placeholder="Pseudo#1234" />
              <p style={{ fontSize: 11, color: "var(--text-2)", margin: "6px 0 0" }}>
                Sert uniquement à ce que les autres joueurs puissent t&apos;ajouter en jeu — jamais pour des statistiques.
              </p>
            </div>
            <div className="field">
              <label>Tag Marvel Rivals</label>
              <input value={marvelRivalsTag} onChange={(e) => setMarvelRivalsTag(e.target.value)} />
              <p style={{ fontSize: 11, color: "var(--text-2)", margin: "6px 0 0" }}>
                Sert uniquement à ce que les autres joueurs puissent t&apos;ajouter en jeu — jamais pour des statistiques.
              </p>
            </div>
            <div className="field">
              <label htmlFor="profile-discord">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  Pseudo Discord
                  {discordState.verified ? <VerifiedBadge /> : null}
                </span>
              </label>
              <input
                id="profile-discord"
                value={discordPseudo}
                onChange={(e) => setDiscordPseudo(e.target.value)}
                placeholder="ton_pseudo"
                aria-describedby="profile-discord-hint"
                /* Un compte Discord rattaché possède son tag : le champ le
                   montre, il ne le prend plus. `readOnly` et non `disabled` —
                   la valeur reste lisible au lecteur d'écran et atteignable au
                   clavier, ce qu'un champ désactivé perd. */
                readOnly={discordLocked}
                aria-readonly={discordLocked || undefined}
              />
              {discordLocked ? (
                // Le verrou interdit de **changer** le tag, pas de le prouver ni
                // de le retirer — et ces deux gestes doivent exister à l'écran.
                // Sans le premier, un compte rattaché dont le tag n'est pas
                // certifié (tag saisi avant la règle, ou pseudo Discord
                // numérique) ne pourrait plus rien en faire ; sans le second, la
                // sortie que le serveur accepte n'existerait nulle part, un
                // compte né par Discord ne pouvant pas non plus se détacher
                // (`LAST_CONNECTION`).
                //
                // La condition porte sur le **rattachement**, pas sur le tag :
                // posée sur le tag, elle ne rendait aucun bouton à l'état que le
                // retrait vient justement de produire (rattaché, sans tag), et
                // la seule sortie restante était de se reconnecter par Discord.
                // Sur un état **inconnu**, en revanche, rien ne s'affiche — on
                // ne propose pas un geste dont on ignore s'il a un objet.
                discordState.linked !== true ? (
                  // Un état illisible verrouille le champ **et** ferait
                  // disparaître tous les gestes, « Retirer mon tag » compris —
                  // la seule annulation d'exposition que le site offre. Une
                  // panne de lecture ne doit pas coûter cela : le verrou reste
                  // (on n'écrase pas un pseudo que Discord aurait nommé), mais
                  // il porte sa propre sortie, sans rechargement.
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => void loadDiscordState()}
                      disabled={discordStateBusy}
                      aria-label="Réessayer la lecture de l'état Discord"
                      style={{ padding: "7px 14px", fontSize: 12 }}
                    >
                      {discordStateBusy ? "Lecture…" : "Réessayer"}
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                    {discordState.verified ? null : (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setVerifyOpen(true)}
                        /* Sans tag enregistré il n'y a rien à *certifier* : le
                           geste est d'en poser un — et il se prouve tout seul,
                           `startDiscordVerification` concluant sur place quand
                           le tag résout vers l'identifiant déjà rattaché. */
                        aria-label={
                          discordState.tag
                            ? "Certifier mon tag Discord"
                            : "Enregistrer mon tag Discord"
                        }
                        style={{ padding: "7px 14px", fontSize: 12 }}
                      >
                        {discordState.tag ? "Certifier mon tag" : "Enregistrer mon tag"}
                      </button>
                    )}
                    {discordState.tag ? (
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={onDiscordTagRemove}
                        disabled={discordTagBusy}
                        aria-label="Retirer mon tag Discord"
                        style={{ padding: "7px 14px", fontSize: 12 }}
                      >
                        {discordTagBusy ? "Retrait…" : "Retirer mon tag"}
                      </button>
                    ) : null}
                  </div>
                )
              ) : (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setVerifyOpen(true)}
                    /* « Recertifier » seul ne dit pas quoi : le libellé
                       accessible commence par le texte visible (WCAG 2.5.3) et
                       ajoute l'objet. */
                    aria-label={
                      discordState.verified
                        ? "Recertifier mon tag Discord"
                        : "Certifier mon tag Discord"
                    }
                    style={{ padding: "7px 14px", fontSize: 12 }}
                  >
                    {discordState.verified ? "Recertifier" : "Certifier mon tag"}
                  </button>
                </div>
              )}
              <p id="profile-discord-hint" style={{ fontSize: 11, color: "var(--text-2)", margin: "6px 0 0", lineHeight: 1.6 }}>
                {discordLocked
                  ? discordTagLockNotice({ ...discordState, pending: discordStateBusy })
                  : discordState.verified
                    ? "Tag certifié : les administrateurs le voient, et les arbitres pendant tes tournois. Le modifier annule la certification."
                    : "Tag non certifié : personne ne le voit, pas même les administrateurs. Certifie-le pour que l'organisation puisse te joindre pendant un tournoi."}
              </p>
            </div>
            <div className="field">
              <label>Statut majeur</label>
              <select value={isAdult} onChange={(e) => setIsAdult(e.target.value)}>
                <option value="unknown">Non renseigné</option>
                <option value="yes">Oui (18+)</option>
                <option value="no">Non (mineur)</option>
              </select>
            </div>
          </div>

          <div>
            <p
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.09em",
                color: "var(--text-2)",
                margin: "0 0 12px",
              }}
            >
              Visibilité publique
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {Object.entries(visibility).map(([key, value]) => (
                <Coche
                  key={key}
                  label={VISIBILITY_LABELS[key] ?? key}
                  checked={value}
                  theme="joueur"
                  onChange={() =>
                    setVisibility((prev) => ({ ...prev, [key]: !prev[key as keyof typeof prev] }))
                  }
                />
              ))}
            </div>
            <p style={{ fontSize: 11, color: "var(--text-2)", margin: "10px 0 0" }}>
              Ton pseudo reste toujours visible : c&apos;est lui qui t&apos;identifie dans les
              brackets, les rosters et les feuilles de match.
            </p>
          </div>

          <div>
            <p
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.09em",
                color: "var(--text-2)",
                margin: "0 0 12px",
              }}
            >
              Recrutement
            </p>
            <Coche
              label="Ouvert aux propositions d'équipe"
              checked={openToRecruitment}
              theme="joueur"
              onChange={() => setOpenToRecruitment((v) => !v)}
            />
            <p style={{ fontSize: 11, color: "var(--text-2)", margin: "10px 0 0" }}>
              Décoché, tu n&apos;apparais plus dans le filtre « Free agents » de l&apos;annuaire et
              les équipes savent que tu ne souhaites pas être contacté.
            </p>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="submit"
              className="btn"
              style={{
                padding: "11px 28px",
                background: "rgba(89,212,255,0.15)",
                borderColor: "rgba(89,212,255,0.35)",
              }}
            >
              Sauvegarder
            </button>
          </div>
        </form>
      </div>

      <ConnectedAppsSection onChanged={loadDiscordState} />

      {invitations.length > 0 && (
        <div className="ds-block" style={{ marginBottom: 20 }}>
          <div className="ds-section-title blue">
            <h2>Invitations d&apos;équipe ({invitations.length})</h2>
          </div>
          <div className="table-like">
            {invitations.map((inv) => (
              <div className="table-row" key={inv.id} style={{ alignItems: "center" }}>
                <TeamLink teamId={inv.teamId}>{inv.teamName}</TeamLink>
                <span style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => respondInvitation(inv.id, true)}
                    style={{ padding: "4px 12px", fontSize: 12 }}
                  >
                    Accepter
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => respondInvitation(inv.id, false)}
                    style={{ padding: "4px 12px", fontSize: 12 }}
                  >
                    Refuser
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="ds-block">
        <div className="ds-section-title blue">
          <h2>Statistiques plateforme</h2>
        </div>
        <div className="ds-stats">
          {[
            { label: "Tournois joués", value: data.stats.tournamentsPlayed },
            { label: "Tournois gagnés", value: data.stats.tournamentsWon },
            { label: "Victoires", value: data.stats.matchesWon },
            { label: "Défaites", value: data.stats.matchesLost },
            { label: "Meilleur rang", value: data.stats.bestRank ?? "—" },
          ].map((stat) => (
            <div key={stat.label} className="ds-stat">
              <div className="ds-stat-label">{stat.label}</div>
              <div className="ds-stat-value">{stat.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          marginTop: 12,
          paddingTop: 20,
          borderTop: "1px solid var(--line)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a
            href="/api/profile/export"
            download
            className="btn ghost"
            style={{
              padding: "10px 18px",
              fontSize: 13,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            Exporter mes données
          </a>
          <button
            type="button"
            className="btn ghost"
            onClick={onDeleteAccount}
            disabled={deleting}
            style={{
              padding: "10px 18px",
              fontSize: 13,
              color: "var(--red-live, #ff5a6e)",
              borderColor: "rgba(255,90,110,0.4)",
              opacity: deleting ? 0.6 : 1,
              cursor: deleting ? "not-allowed" : "pointer",
            }}
          >
            {deleting ? "Suppression…" : "Supprimer mon compte"}
          </button>
        </div>
        <LogoutButton />
      </div>
    </section>
  );
}
