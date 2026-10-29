"use client";

import { UserAvatar } from "@/components/user-avatar";
import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { LogoutButton } from "@/components/logout-button";
import { appendCroppedImage, useImageCropper, preloadImageCropDialog } from "@/components/ui/image-crop-dialog";
import { Coche } from "@/components/Coche";
import type { FullProfileResponse } from "@/lib/shared/types";
import { useAccountDeletion } from "@/components/account/use-account-deletion";
import { useToast } from "@/components/ui/toast";
import { TeamLink } from "@/components/entity-link";
import { VerifiedBadge } from "@/components/discord-tag";
import { isDiscordTagLocked } from "@/lib/shared/discord-tag-lock";
import { isBattletagLocked } from "@/lib/shared/battletag-lock";
import {
  avatarDeleteErrorMessage,
  avatarUploadErrorMessage,
  invitationResponseErrorMessage,
  profileErrorMessage,
  profileLoadErrorMessage,
} from "./profile-errors";
import { precheckImageUpload } from "@/lib/shared/image-upload-errors";
import { IMAGE_UPLOAD_MAX_BYTES, IMAGE_UPLOAD_MIME_TYPES } from "@/lib/shared/uploads";
import { PSEUDO_MAX_LENGTH } from "@/lib/shared/pseudo";
import {
  PROFILE_SECTION_BY_ID,
  profileSectionIdFromHash,
  visibleProfileSections,
  type ProfileSectionId,
} from "./_lib/profile-sections";
import {
  battletagLockText,
  discordAudienceText,
  discordTagLockText,
  hiddenBattletagAudienceText,
  verifiedBadgeLabels,
  type ProfileText,
} from "./_lib/profile-text";
import { AudienceList, InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import type { DiscordTagLockNotice } from "@/lib/shared/discord-tag-lock";
import type { BattletagLockNotice } from "@/lib/shared/battletag-lock";
import { useProfileText } from "@/components/i18n/profile-text";
import { useTeamErrorsText } from "@/components/i18n/team-errors-text";
import { useLocaleRouter } from "@/components/i18n/locale-navigation";
import { ProfileSection } from "./_components/ProfileSection";
import { AccountLocaleField } from "./_components/AccountLocaleField";
import { MatchDmField } from "./_components/MatchDmField";
import { RecruitmentModalField } from "./_components/RecruitmentModalField";
import { SelfRolesSection } from "./_components/SelfRolesField";
import { DiscordVerificationDialog } from "./DiscordVerificationDialog";
import { useCertifyRequest } from "./useCertifyRequest";
import { certifiedFromProfileEvent } from "@/lib/shared/discord-certify-prompt";
import { ConnectedAppsSection } from "./ConnectedAppsSection";
import { PushNotificationsPanel } from "@/components/notifications/PushNotificationsPanel";
import { BattletagVisibilityNotice } from "./BattletagVisibilityNotice";
import { useAccountConnections } from "./useAccountConnections";
import type { AccountConnection } from "@/lib/shared/account-connections";
import s from "./profil.module.css";
import { PROFILE_FIELD_ERRORS } from "@/lib/shared/field-errors";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { FieldErrorText } from "@/components/ui/field-error-text";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { busyAriaLabel } from "@/lib/shared/busy-aria-label";
import { visibleText } from "@/lib/shared/visible-text";

/** Contrôles que peut désigner un refus de la sauvegarde du profil. */
const PROFILE_FIELD_IDS = {
  pseudo: "profile-pseudo",
  battletag: "profile-battletag",
  discord: "profile-discord",
} as const;

// Le pseudo n'est plus masquable : identité de base du joueur sur la plateforme.
const VISIBILITY_KEYS = ["avatar", "overwatch", "marvel", "discord", "major"] as const;

/** Libellé d'une case de visibilité ; une clé inconnue reste telle quelle. */
function visibilityLabel(text: ProfileText, key: string): string {
  const known = VISIBILITY_KEYS.find((value) => value === key);
  return known ? text.t(`privacy.visibility.${known}`) : key;
}

/** État Discord du compte, lu à part du formulaire (voir `discordState`). */
interface DiscordState {
  tag: string | null;
  verified: boolean;
  linked: boolean | null;
  /** Tag nommé par Discord : certifiable d'un clic sur un compte rattaché. */
  attested: boolean;
}

/**
 * Un message privé de match peut-il joindre ce compte ? Seulement avec un tag
 * Discord **certifié** (`toNotificationRecipient`, portée `certified`) : un
 * tag saisi ou un Discord rattaché sans tag certifié ne reçoit rien. Tant que
 * l'état Discord n'est pas lu — ou si sa lecture a échoué, ce qu'elle fait en
 * silence —, le profil déjà chargé fait foi (`discordVerified`) : sans lui, un
 * joueur non certifié ne verrait jamais la ligne qui le prévient. `null` quand
 * ni l'un ni l'autre n'est connu.
 */
function matchDmReachable(discordState: DiscordState, profileVerified: boolean | undefined): boolean | null {
  if (discordState.linked !== null) return discordState.verified;
  return profileVerified ?? null;
}

/**
 * Avertissement affiché sous les réglages de visibilité quand « Tag Discord »
 * est coché sur un tag non certifié.
 *
 * Seulement sur un état **lu** (`linked` n'est plus `null`) : avant la
 * lecture, ou quand elle échoue, `verified` vaut `false` par défaut et
 * l'avertissement accuserait à tort un joueur certifié.
 */
function discordVisibilityWarning(text: ProfileText, visible: boolean, discordState: DiscordState): string | null {
  if (!visible || discordState.linked === null || discordState.verified) return null;
  return discordState.tag ? text.t("privacy.discordPending") : text.t("privacy.discordNoTag");
}

/**
 * Ce que dit le champ Discord : verrouillé, l'état du module ; ouvert, un tag
 * non certifié (un tag certifié est toujours verrouillé). La liste de ceux qui
 * liraient un tag certifié vient de la source partagée avec `/connexion`.
 */
function discordFieldNotice(
  text: ProfileText,
  locked: boolean,
  state: DiscordState & { pending: boolean },
): DiscordTagLockNotice {
  if (locked) return discordTagLockText(text, state);
  return { status: text.t("discord.unverifiedHint"), details: [text.t("discord.unverifiedDetails")], audience: true };
}

/**
 * Ce que dit le champ BattleTag : verrouillé, l'état du module **remplace** la
 * finalité — l'annonce Blizzard prévient de ce qui arrivera si un compte est
 * rattaché, et il l'est déjà. Ouvert, la finalité reste visible (elle se dit à
 * la collecte) et l'annonce Blizzard passe derrière le « i ».
 */
function battletagFieldNotice(
  text: ProfileText,
  locked: boolean,
  state: { tag: string | null; linked: boolean | null; pending: boolean },
): BattletagLockNotice {
  if (locked) return battletagLockText(text, state);
  return { status: text.t("games.gameTagNotice"), details: [text.t("games.blizzardNotice")] };
}

/** Le « i » a-t-il quelque chose à dire ? */
function hasHintDetails(notice: DiscordTagLockNotice): boolean {
  return notice.details.length > 0 || notice.audience;
}

/** Les phrases d'un détail, une par paragraphe. */
function HintDetails({ lines }: Readonly<{ lines: readonly string[] }>) {
  return (
    <>
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </>
  );
}

/** Le « i » du tag Discord : le détail du verrou, et qui lirait un tag certifié. */
function DiscordFieldHint({ notice, text }: Readonly<{ notice: DiscordTagLockNotice; text: ProfileText }>) {
  if (!hasHintDetails(notice)) return null;
  return (
    <InfoHint id="profile-discord-more" subject={text.t("discord.label")}>
      <HintDetails lines={notice.details} />
      {notice.audience ? <AudienceList lines={discordAudienceText(text)} /> : null}
    </InfoHint>
  );
}

/** Rattachement Blizzard : `null` tant que la liste n'a pas été lue. */
function blizzardLinkState(connections: AccountConnection[] | null): boolean | null {
  return connections === null
    ? null
    : connections.some((c) => c.provider === "BLIZZARD" && c.linked);
}

/** Choix du champ « Majorité » d'après la valeur enregistrée. */
function adultChoice(isAdult: boolean | null): string {
  if (isAdult === null) return "unknown";
  return isAdult ? "yes" : "no";
}

/** Saisie rognée, ou `null` si elle est vide — un champ vidé efface la valeur. */
function trimmedOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Corps de la confirmation « Retirer mon tag ». Seul un tag certifié est vu
 * de l'organisation et reçoit les messages privés de match : ce qui se perd
 * ne se dit qu'à lui — un tag qui ne l'est pas, invisible de tous, n'a rien
 * de cela à perdre (`removalBodyUnverified`, `removalBody2Unverified`). La
 * fin des messages privés de match ne se promet qu'à qui les reçoit encore
 * (`dms` : tag certifié et case « Messages privés Discord de mes matchs »
 * cochée).
 */
function TagRemovalBody({ verified, dms }: Readonly<{ verified: boolean; dms: boolean }>) {
  const { t } = useProfileText();
  return (
    <>
      <p>{t(verified ? "discord.removalBody" : "discord.removalBodyUnverified")}</p>
      {verified && dms ? <p>{t("discord.removalBodyDms")}</p> : null}
      <p>{t(verified ? "discord.removalBody2" : "discord.removalBody2Unverified")}</p>
    </>
  );
}

export default function ProfilePage() {
  const router = useLocaleRouter();
  const { showError, showSuccess } = useToast();
  const text = useProfileText();
  const { t } = text;
  const teamErrorsText = useTeamErrorsText();
  const { cropImage, cropDialog } = useImageCropper();
  const fieldErrors = useFieldErrors(PROFILE_FIELD_ERRORS, PROFILE_FIELD_IDS);
  const [data, setData] = useState<FullProfileResponse | null>(null);

  const [pseudo, setPseudo] = useState("");
  const [overwatchBattletag, setOverwatchBattletag] = useState("");
  /**
   * Le BattleTag **tel qu'il est enregistré**, pour savoir si la sauvegarde a
   * quelque chose à en dire.
   *
   * Même raison que `savedDiscordPseudo` : le champ est en lecture seule dès
   * que Blizzard est rattaché, et renvoyer l'instantané du montage à chaque
   * sauvegarde ferait refuser **tout** le `PATCH` en 409 dès que Blizzard
   * l'aurait réécrit entre-temps — une connexion Battle.net depuis un autre
   * appareil suffit. Omettre la clé n'efface rien : le service ne touche la
   * colonne que si le patch en parle.
   */
  const [savedOverwatchBattletag, setSavedOverwatchBattletag] = useState("");
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
  const [discordState, setDiscordState] = useState<DiscordState>({
    tag: null,
    verified: false,
    linked: null,
    attested: false,
  });
  // Le tag **tel qu'il est enregistré**, indépendamment de ce qui est tapé : il
  // décide si la sauvegarde a quelque chose à dire sur ce champ. Sans lui, la
  // seule façon de le savoir était l'état du verrou — un renseignement que
  // l'écran peut avoir périmé (voir `onSubmit`).
  const [savedDiscordPseudo, setSavedDiscordPseudo] = useState("");
  const [verifyOpen, setVerifyOpen] = useState(false);
  const openVerifyDialog = useCallback(() => setVerifyOpen(true), []);
  const [isAdult, setIsAdult] = useState<string>("unknown");
  /**
   * Le bouton se désarme avant l'aperçu, focus encore dessus : le navigateur le
   * renvoie sur `body`, que la modale restaurerait. Annuler le rend au bouton.
   */
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  // La suppression commune avec la fenêtre des conditions (`useAccountDeletion`).
  const accountDeletion = useAccountDeletion({
    text,
    onCancel: () => requestAnimationFrame(() => deleteButtonRef.current?.focus()),
  });
  const [openToRecruitment, setOpenToRecruitment] = useState(false);
  const [visibility, setVisibility] = useState({
    avatar: false,
    overwatch: false,
    marvel: false,
    discord: false,
    major: false,
  });
  const [avatarBusy, setAvatarBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const saving = useRef(false);
  const [invitations, setInvitations] = useState<{ id: number; teamId: number; teamName: string; ownership?: boolean }[]>([]);

  const loadInvitations = async () => {
    try {
      const res = await fetch("/api/me/invitations", { cache: "no-store" });
      if (!res.ok) return;
      const payload = (await res.json()) as { invitations?: { id: number; teamId: number; teamName: string; ownership?: boolean }[] };
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

  /**
   * Le numéro de la **dernière lecture lancée**.
   *
   * Deux lectures peuvent être en vol en même temps — sauvegarder puis retirer
   * son tag dans la foulée en lance deux —, et rien ne garantit qu'elles
   * reviennent dans l'ordre. Celle du `PATCH`, revenue après celle du retrait,
   * reposait `{tag, verified: true}` : l'écran gardait la pastille et « les
   * administrateurs le voient » à côté d'un champ vidé, jusqu'au rechargement.
   *
   * Une `ref` et non un état : elle ne doit provoquer aucun rendu, et doit être
   * lue à sa valeur **du moment**, pas à celle figée dans la fermeture.
   */
  const discordReadSeq = useRef(0);

  const loadDiscordState = async () => {
    const seq = (discordReadSeq.current += 1);
    setDiscordStateBusy(true);
    try {
      const res = await fetch("/api/profile/discord", { cache: "no-store" });
      if (!res.ok) return;
      const payload = (await res.json()) as {
        tag: string | null;
        verified: boolean;
        linked: boolean;
        attested: boolean;
      };
      // Une lecture dépassée n'écrit rien : ce qu'elle a vu est plus vieux que
      // ce que l'écran affiche déjà.
      if (seq !== discordReadSeq.current) return;
      setDiscordState(payload);
    } catch {
      // Silencieux, mais **pas anodin** : l'état reste `linked: null`, donc le
      // champ reste verrouillé. Le reste du formulaire s'enregistre normalement,
      // et le bouton « Réessayer » ci-dessous rouvre le seul chemin fermé.
    } finally {
      // L'attente ne se lève que sur la **dernière** lecture : la dépassée qui
      // rentre la première rouvrait sinon « Réessayer » alors qu'une lecture
      // court encore, et faisait annoncer une panne pendant ce temps-là.
      if (seq === discordReadSeq.current) setDiscordStateBusy(false);
    }
  };

  useEffect(() => {
    void loadInvitations();
    void loadDiscordState();
  }, []);

  // « Certifier mon tag » de la fenêtre proposée à la connexion, pour un tag
  // que Discord n'a pas nommé : ce dialogue-ci fait la suite.
  useCertifyRequest({
    ready: !discordStateBusy && discordState.linked !== null,
    verified: discordState.verified,
    open: openVerifyDialog,
    refresh: () => void loadDiscordState(),
  });

  const [respondingInvitation, setRespondingInvitation] = useState<number | null>(null);
  // Garde synchrone : deux clics dans le même rendu voient encore l'état d'avant.
  const respondingRef = useRef(false);
  const respondInvitation = async (invitationId: number, accept: boolean) => {
    // Une réponse à la fois : un double clic n'envoie pas deux réponses (ni deux rafraîchissements).
    if (respondingRef.current) return;
    respondingRef.current = true;
    setRespondingInvitation(invitationId);
    try {
      const res = await fetch(`/api/invitations/${invitationId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accept }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error || "INVITATION_RESPOND_FAILED");
      showSuccess(accept ? t("invitations.accepted") : t("invitations.refused"));
      await loadInvitations();
      // La barre de navigation vient de la mise en page serveur de l'espace
      // connecté, que l'App Router ne rejoue pas d'une page à l'autre : sans
      // ce rafraîchissement, elle garderait l'état d'avant jusqu'au F5.
      if (accept) router.refresh();
    } catch (e) {
      // Chaque chemin de la page lève un **code** et le traduit ici, dans son
      // `catch` : c'est aussi là qu'arrivent les échecs qui n'en sont pas un
      // (`TypeError` d'une coupure réseau, `SyntaxError` d'une réponse HTML), que
      // le registre ramène à son repli au lieu d'afficher leur message anglais.
      showError(invitationResponseErrorMessage((e as Error).message, teamErrorsText));
    } finally {
      respondingRef.current = false;
      setRespondingInvitation(null);
    }
  };

  // Le texte par une référence : la lecture du profil (et la remise à zéro des
  // champs qu'elle fait) ne repart jamais sur un simple changement de texte —
  // une saisie en cours serait perdue (revue de performance du lot 9-2).
  const textRef = useRef(text);
  useEffect(() => {
    textRef.current = text;
  }, [text]);
  useEffect(() => {
    const load = async () => {
      const response = await fetch("/api/profile", { cache: "no-store" });
      const payload = (await response.json()) as FullProfileResponse & { error?: string };
      if (!response.ok) {
        const errorCode = payload.error || "PROFILE_LOAD_FAILED";
        if (errorCode === "PROFILE_NOT_FOUND") {
          // Chemin de **lecture** : le repli doit l'être aussi. `PROFILE_NOT_FOUND`
          // est nommé dans le registre, donc les deux fonctions rendent
          // aujourd'hui la même phrase — mais le jour où ce code en sortirait,
          // celle-ci annoncerait « La sauvegarde a échoué » à un visiteur qui
          // vient d'ouvrir la page, le défaut même que ce registre sépare.
          showError(profileLoadErrorMessage(errorCode, textRef.current));
          setTimeout(() => router.push("/"), 1500);
          return;
        }
        throw new Error(errorCode);
      }
      setData(payload);
      setPseudo(payload.profile.pseudo);
      setOverwatchBattletag(payload.profile.overwatchBattletag || "");
      setSavedOverwatchBattletag(payload.profile.overwatchBattletag || "");
      setMarvelRivalsTag(payload.profile.marvelRivalsTag || "");
      setDiscordPseudo(payload.profile.discordPseudo || "");
      setSavedDiscordPseudo(payload.profile.discordPseudo || "");
      setIsAdult(adultChoice(payload.profile.isAdult));
      const v = payload.profile.visibility;
      setOpenToRecruitment(payload.profile.openToRecruitment === true);
      setVisibility({
        avatar: !!v.avatar,
        overwatch: !!v.overwatch,
        marvel: !!v.marvel,
        discord: !!v.discord,
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
    load().catch((e) => showError(profileLoadErrorMessage((e as Error).message, textRef.current)));
  }, [showError, router]);

  /**
   * **Le saut vers l'ancre se rejoue une fois la section montée.**
   *
   * Le navigateur n'honore le fragment d'une URL collée qu'au chargement du
   * document, c'est-à-dire au moment précis où la page n'affiche encore que
   * « Chargement du profil… » : aucune section n'existe, il ne trouve rien, et
   * il n'y revient jamais — `/profil#compte` déposait donc son lecteur en haut
   * de la page. Les liens de la navigation marchaient, eux, parce qu'on clique
   * forcément après la réponse.
   *
   * L'ancre demandée est lue **une seule fois**, au premier passage de
   * l'effet où le profil est chargé, et non à chaque passage : `window.location.hash`
   * garde le dernier lien cliqué, et `data` est remplacé à chaque sauvegarde —
   * relire le fragment aurait remonté le lecteur à la section qu'il avait
   * visitée dix minutes plus tôt au moment où il enregistre son profil depuis
   * une autre. Pas au montage non plus : arrivé par un lien d'une autre page
   * (la modale des changements de confidentialité), le composant est monté
   * **avant** que Next ne pousse la nouvelle URL, et l'initialiseur y lisait
   * encore le fragment — vide — de la page quittée.
   */
  const requestedSection = useRef<string | null | undefined>(undefined);
  const sectionHonoured = useRef(false);
  useEffect(() => {
    if (!data || sectionHonoured.current) return;
    if (requestedSection.current === undefined) {
      requestedSection.current = profileSectionIdFromHash(window.location.hash);
    }
    const sectionId = requestedSection.current;
    if (!sectionId) {
      sectionHonoured.current = true;
      return;
    }
    // Une section conditionnelle peut n'être pas encore là : on retentera au
    // prochain rendu plutôt que de tenir le saut pour fait.
    const target = document.getElementById(sectionId);
    if (!target) return;
    sectionHonoured.current = true;
    target.scrollIntoView({ block: "start" });
  }, [data, invitations.length]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    // Une sauvegarde à la fois (Entrée puis clic, double clic) : la seconde partirait
    // avec des références pas encore réalignées (revue de sécurité du lot 9-2).
    if (saving.current) return;
    saving.current = true;
    fieldErrors.clear();
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
      // Même règle pour le BattleTag, et pour la même raison : la condition
      // porte sur la **valeur**, jamais sur le verrou — celui-ci se lit sur un
      // état que l'écran peut avoir périmé (un onglet ouvert avant un
      // rattachement porte encore « non rattaché »), et c'est précisément le
      // cas où le refus tombe. La valeur, elle, dit ce qu'il faut savoir : ce
      // champ a-t-il quelque chose à écrire ?
      const touchesBattletag =
        overwatchBattletag.trim() !== savedOverwatchBattletag.trim();
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pseudo,
          ...(touchesBattletag ? { overwatchBattletag: trimmedOrNull(overwatchBattletag) } : {}),
          marvelRivalsTag: trimmedOrNull(marvelRivalsTag),
          ...(touchesDiscordTag ? { discordPseudo: trimmedOrNull(discordPseudo) } : {}),
          isAdult: isAdult === "unknown" ? null : isAdult === "yes",
          visibility,
          openToRecruitment,
        }),
      });
      const payload = (await response.json()) as FullProfileResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "PROFILE_UPDATE_FAILED");
      }
      setData(payload);
      // Le champ **et sa référence** se réalignent sur ce qui vient d'être
      // enregistré. Le champ, parce qu'il est en lecture seule dès que le
      // compte est rattaché et que c'est le seul endroit où le tag s'affiche :
      // sans lui, un tag réécrit ailleurs entre le chargement et la sauvegarde
      // (renommage sur Discord puis connexion depuis un autre appareil)
      // laissait la pastille et la phrase du verrou annoncer le tag frais à
      // côté d'un champ resté sur celui du montage. La référence, parce que
      // c'est elle qui décide si la prochaine sauvegarde parle de ce champ —
      // laissée en arrière, elle resoumettrait un tag déjà écrit.
      setDiscordPseudo(payload.profile.discordPseudo || "");
      setSavedDiscordPseudo(payload.profile.discordPseudo || "");
      // Le champ **et** sa référence se réalignent sur ce qui vient d'être
      // enregistré : le champ parce qu'il est en lecture seule sous un compte
      // Blizzard rattaché et que c'est le seul endroit où le BattleTag
      // s'affiche, la référence parce que c'est elle qui décide si la prochaine
      // sauvegarde parle de ce champ.
      setOverwatchBattletag(payload.profile.overwatchBattletag || "");
      setSavedOverwatchBattletag(payload.profile.overwatchBattletag || "");
      // Une sauvegarde qui change le tag **annule la certification** côté
      // serveur : la pastille doit tomber dans le même geste, sinon l'écran
      // annonce une exposition qui n'existe plus.
      await loadDiscordState();
      showSuccess(t("saved"));
      // Le pseudo s'affiche aussi dans la barre de navigation.
      router.refresh();
    } catch (e) {
      // Le registre du profil, et non celui de la certification : router ces
      // erreurs vers l'autre faisait annoncer « La certification a échoué » à un
      // pseudo déjà pris ou à une coupure réseau.
      const code = (e as Error).message;
      const message = profileErrorMessage(code, text);
      fieldErrors.report(code, message);
      showError(message);
    } finally {
      saving.current = false;
    }
  };

  const [discordTagBusy, setDiscordTagBusy] = useState(false);
  const [confirmingTagRemoval, setConfirmingTagRemoval] = useState(false);
  // Certification lue à l'ouverture de la confirmation : le retrait remet
  // `verified` à `false` avant la fin de la requête, et le texte du dialogue
  // ne doit pas basculer sous les yeux du joueur pendant « Retrait… ».
  const [tagRemovalVerified, setTagRemovalVerified] = useState(false);
  // Messages privés de match encore reçus à l'ouverture (case cochée).
  const [tagRemovalDms, setTagRemovalDms] = useState(false);
  // Ce que montre la case « Messages privés Discord de mes matchs » : la fiche
  // relue par une sauvegarde du profil peut retarder sur un envoi en cours.
  // Une référence, pas un état : seul le clic « Retirer » la lit, et un état
  // ferait rendre toute la page à chaque coche (et au chargement de la fiche).
  const matchDmShown = useRef<boolean | undefined>(undefined);
  const reportMatchDmChoice = useRef((enabled: boolean) => {
    matchDmShown.current = enabled;
  }).current;

  /**
   * Retirer son tag Discord — l'annulation de l'exposition.
   *
   * Passe par la sauvegarde ordinaire du profil : c'est `updateOwnProfile` qui
   * décertifie en même temps qu'il efface, et un second chemin laisserait un
   * compte certifié sur un tag qu'il vient de retirer. Joué par la modale de
   * confirmation (`confirmingTagRemoval`) : rend `true` si le tag est parti.
   */
  const onDiscordTagRemove = async (): Promise<boolean> => {
    setDiscordTagBusy(true);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ discordPseudo: null }),
      });
      const payload = (await response.json()) as FullProfileResponse & { error?: string };
      // Seconde écriture vers `PATCH /api/profile`, arrivée avec le verrou du
      // tag : elle passe par la même porte que la sauvegarde du profil, donc
      // elle peut recevoir le même 409 `ACCOUNT_DELETED` — le compte supprimé
      // depuis un autre onglet pendant que celle-ci attendait son verrou. Le
      // code est traduit dans le `catch`, par le registre du profil.
      if (!response.ok) {
        throw new Error(payload.error || "PROFILE_UPDATE_FAILED");
      }
      setData(payload);
      setDiscordPseudo("");
      setSavedDiscordPseudo("");
      // L'état est posé **depuis la réponse**, et non attendu d'une seconde
      // lecture : `loadDiscordState` se tait quand elle échoue, et l'écran
      // gardait alors la pastille et « ce pseudo est certifié : les
      // administrateurs le voient » à côté d'un champ qu'on vient de vider. La
      // réponse du `PATCH` porte déjà la vérité — le tag est parti, donc la
      // certification avec (toute modification du tag la défait).
      setDiscordState((prev) => ({ ...prev, tag: null, verified: false, attested: false }));
      await loadDiscordState();
      showSuccess(t("discord.removed"));
      return true;
    } catch (e) {
      showError(profileErrorMessage((e as Error).message, text));
      return false;
    } finally {
      setDiscordTagBusy(false);
    }
  };

  const onAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const refusal = precheckImageUpload(file);
    if (refusal) {
      showError(avatarUploadErrorMessage(refusal, text, teamErrorsText));
      return;
    }

    const image = await cropImage(file, "avatar", t("identity.cropTitle"));
    if (!image) return;

    setAvatarBusy(true);
    try {
      const formData = new FormData();
      appendCroppedImage(formData, image);
      const response = await fetch("/api/profile/avatar", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as { avatarUrl?: string | null; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "AVATAR_UPLOAD_FAILED");
      }
      setData((prev) =>
        prev ? { ...prev, profile: { ...prev.profile, avatarUrl: payload.avatarUrl ?? null } } : prev,
      );
      showSuccess(t("avatarUpdated"));
      router.refresh();
    } catch (e) {
      showError(avatarUploadErrorMessage((e as Error).message, text, teamErrorsText));
    } finally {
      setAvatarBusy(false);
    }
  };

  const onAvatarDelete = async () => {
    setAvatarBusy(true);
    try {
      const response = await fetch("/api/profile/avatar", { method: "DELETE" });
      const payload = (await response.json()) as { avatarUrl?: string | null; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "AVATAR_DELETE_FAILED");
      }
      setData((prev) =>
        prev ? { ...prev, profile: { ...prev.profile, avatarUrl: null } } : prev,
      );
      showSuccess(t("avatarDeleted"));
      router.refresh();
    } catch (e) {
      showError(avatarDeleteErrorMessage((e as Error).message, text));
    } finally {
      setAvatarBusy(false);
    }
  };

  // Le verrou se lit sur le rattachement **enregistré**, jamais sur le champ en
  // cours de saisie : le formulaire ne doit ni ouvrir ni fermer ce qu'il montre.
  const discordLocked = isDiscordTagLocked(discordState);
  /**
   * Ce que dit le champ : verrouillé, l'état du module ; ouvert, un tag non
   * certifié (un tag certifié est toujours verrouillé). La liste de ceux qui
   * liraient un tag certifié vient de la source partagée avec `/connexion`.
   */
  const discordNotice = discordFieldNotice(text, discordLocked, { ...discordState, pending: discordStateBusy });
  const discordHasMore = hasHintDetails(discordNotice);
  const discordWarning = discordVisibilityWarning(text, visibility.discord, discordState);

  // La liste des rattachements est chargée **ici** et non dans la section d'en
  // bas, qui la recevait : elle a deux lecteurs, et deux `fetch` en feraient
  // deux vérités (`useAccountConnections.ts`).
  const {
    connections,
    pending: connectionsPending,
    reload: reloadConnections,
  } = useAccountConnections();
  // `null` n'est pas « aucun rattachement » mais « pas encore lue » : le verrou
  // porte donc, comme celui du tag Discord, sur un état à trois valeurs.
  const blizzardLinked = blizzardLinkState(connections);
  const battletagLocked = isBattletagLocked({ linked: blizzardLinked });
  const battletagNotice = battletagFieldNotice(text, battletagLocked, {
    tag: overwatchBattletag.trim() || null,
    linked: blizzardLinked,
    pending: connectionsPending,
  });

  /**
   * La modale qui dit ce que « décoché » ne fait pas.
   *
   * Elle ne s'ouvre qu'à la bascule vers **masqué**, et sur le seul BattleTag :
   * c'est le seul réglage de ce groupe dont la promesse dépasse ce que le site
   * tient (`BattletagVisibilityNotice.tsx`).
   */
  const [battletagNoticeOpen, setBattletagNoticeOpen] = useState(false);

  /** Rôles enregistrés depuis « Mes rôles » : la page garde ce que la route a rendu. */
  const saveOwnRoles = useCallback((roles: FullProfileResponse["roles"]) => {
    setData((prev) => (prev ? { ...prev, roles } : prev));
  }, []);

  if (!data) {
    return (
      <section className="ds-block" style={{ color: "var(--ink-soft)" }}>
        {t("loading")}
      </section>
    );
  }

  // Les sections viennent du registre, et la navigation n'annonce que celles que
  // la page a de quoi remplir : un lien d'ancre ne peut donc pas désigner une
  // section absente. La **recherche par ancre**, elle, reste totale — indexer la
  // liste filtrée rendrait `undefined` sur la section conditionnelle, sans que
  // le typage le voie.
  const sections = visibleProfileSections({ invitations: invitations.length, adminRoles: Number(data.isAdmin) });
  const sectionById = PROFILE_SECTION_BY_ID;

  const discordLockedActions = (
    <DiscordLockedActions
      discordState={discordState}
      discordStateBusy={discordStateBusy}
      loadDiscordState={loadDiscordState}
      discordTagBusy={discordTagBusy}
      onDiscordTagRemove={() => {
        setTagRemovalVerified(discordState.verified);
        setTagRemovalDms((matchDmShown.current ?? data?.matchDmEnabled) !== false);
        setConfirmingTagRemoval(true);
      }}
      setVerifyOpen={setVerifyOpen}
    />
  );

  return (
    <section className={`fade-in ${s.page}`}>
      {cropDialog}
      {battletagNoticeOpen && (
        <BattletagVisibilityNotice onClose={() => setBattletagNoticeOpen(false)} />
      )}
      {verifyOpen && (
        <DiscordVerificationDialog
          initialTag={discordState.linked === true ? (discordState.tag ?? "") : discordPseudo}
          /* L'inconnu n'est pas un rattachement : le dialogue n'est de toute
             façon atteignable qu'avec un état lu, ses deux boutons étant sous
             un `linked` connu. */
          linked={discordState.linked === true}
          attested={discordState.attested}
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
            setDiscordState((prev) => ({ ...prev, tag, verified: true, linked: true, attested: true }));
            // Une fenêtre de proposition encore en attente (conditions à
            // accepter) ne doit plus s'ouvrir pour un tag désormais certifié.
            window.dispatchEvent(certifiedFromProfileEvent());
          }}
        />
      )}

      <div className="ds-header">
        <div className={`ds-header-body ${s.header}`}>
          <UserAvatar src={data.profile.avatarUrl} pseudo={data.profile.pseudo} size={64} />
          <div className={s.headerText}>
            <span className={`eyebrow ${s.eyebrow}`}>{t("header.eyebrow")}</span>
            <h1 className={`ds-title ${s.title}`}>{t("header.title")}</h1>
            <p className={s.subtitle}>{t("header.subtitle")}</p>
          </div>
        </div>
      </div>

      {/* Une page de réglages se parcourt rarement en entier : les ancres mènent
          droit à la section cherchée, et le bas de page — export et suppression —
          cesse d'exiger de traverser le reste. */}
      <nav className={s.nav} aria-label={t("navLabel")}>
        {sections.map((entry) => (
          <a key={entry.id} href={`#${entry.id}`} className={s.navLink} data-tone={entry.tone}>
            {t(`sections.${entry.id as ProfileSectionId}.title`)}
          </a>
        ))}
      </nav>

      {/* `display: contents` aurait été plus court, mais plusieurs moteurs
          retirent alors l'élément de l'arbre d'accessibilité : le formulaire
          cesserait d'être annoncé comme tel. Une colonne au même écartement que
          la page donne la même mise en page sans rien perdre. */}
      <form onSubmit={onSubmit} className={s.formSections}>
        <ProfileSection section={sectionById.identite}>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="profile-pseudo">{t("identity.pseudo")}</label>
              <input
                id="profile-pseudo"
                value={pseudo}
                onChange={(e) => {
                  setPseudo(e.target.value);
                  fieldErrors.clear("pseudo");
                }}
                {...fieldErrors.aria("pseudo", "profile-pseudo-hint")}
              />
              <FieldErrorText fieldId={PROFILE_FIELD_IDS.pseudo} message={fieldErrors.message("pseudo")} />
              <p id="profile-pseudo-hint" className={s.hint}>
                {t("identity.pseudoHint", { max: PSEUDO_MAX_LENGTH })}
              </p>
            </div>
            {/* L'avatar n'a pas de champ à étiqueter — le `<input type="file">`
                est caché et les deux contrôles sont des boutons : « Avatar »
                nomme donc un **groupe** (un `<label>` sans `for` n'étiquette
                rien, et le lecteur d'écran n'annonçait pas à quoi se
                rapportaient les deux boutons). */}
            <fieldset className="field native-group" aria-labelledby="profile-avatar-label">
              <span id="profile-avatar-label" className={s.groupLabel}>
                {t("identity.avatar")}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                onClick={preloadImageCropDialog}
                accept={IMAGE_UPLOAD_MIME_TYPES.join(",")}
                onChange={onAvatarChange}
                style={{ display: "none" }}
              />
              <div className={s.avatarActions}>
                <button
                  type="button"
                  className="btn"
                  aria-disabled={avatarBusy || undefined}
                  aria-busy={avatarBusy || undefined}
                  onClick={() => !avatarBusy && fileInputRef.current?.click()}
                  style={{ padding: "9px 18px", fontSize: 13 }}
                >
                  {avatarBusy ? t("identity.sending") : t("identity.changeAvatar")}
                </button>
                {data.profile.avatarUrl ? (
                  <button
                    type="button"
                    className="btn ghost"
                    aria-disabled={avatarBusy || undefined}
                    onClick={() => !avatarBusy && void onAvatarDelete()}
                    /* Le nom accessible commence par le texte affiché (WCAG
                       2.5.3) et lève l'ambiguïté avec « Supprimer mon compte »,
                       plus bas : parcourus hors contexte, deux « Supprimer » ne
                       se distinguent pas. */
                    aria-label={t("identity.deleteAvatarLabel")}
                    style={{ padding: "9px 18px", fontSize: 13 }}
                  >
                    {t("identity.deleteAvatar")}
                  </button>
                ) : null}
              </div>
              <p className={`${s.hint} ${s.hintMuted}`}>
                {t("identity.avatarHint", { max: IMAGE_UPLOAD_MAX_BYTES / (1024 * 1024) })}
              </p>
            </fieldset>
            <div className="field">
              <label htmlFor="profile-adult">{t("identity.adult")}</label>
              <select
                id="profile-adult"
                value={isAdult}
                onChange={(e) => setIsAdult(e.target.value)}
                aria-describedby="profile-adult-hint"
              >
                <option value="unknown">{t("identity.adultUnknown")}</option>
                <option value="yes">{t("identity.adultYes")}</option>
                <option value="no">{t("identity.adultNo")}</option>
              </select>
              <p id="profile-adult-hint" className={s.hint}>
                {t("identity.adultHint")}
              </p>
            </div>
          </div>
        </ProfileSection>

        <ProfileSection section={sectionById.jeux}>
          <div className="form-grid">
            <div className="field">
              <InfoHintRow>
                <label htmlFor="profile-battletag">{t("games.battletag")}</label>
                {/* Le détail (Blizzard, verrou, qui lit un BattleTag masqué) derrière le « i » :
                    l'avertissement sur le masquage y reste dans les deux cas, verrouillé ou non. */}
                <InfoHint id="profile-battletag-more" subject={t("games.battletag")}>
                  <HintDetails lines={battletagNotice.details} />
                  <AudienceList lines={hiddenBattletagAudienceText(text)} />
                </InfoHint>
              </InfoHintRow>
              <input
                id="profile-battletag"
                value={overwatchBattletag}
                onChange={(e) => {
                  setOverwatchBattletag(e.target.value);
                  fieldErrors.clear("battletag");
                }}
                placeholder={t("games.battletagPlaceholder")}
                {...fieldErrors.aria("battletag", "profile-battletag-hint", "profile-battletag-more")}
                /* Un compte Blizzard rattaché possède son BattleTag : le champ
                   le montre, il ne le prend plus. `readOnly` et non `disabled`
                   — la valeur reste lisible au lecteur d'écran et atteignable
                   au clavier, ce qu'un champ désactivé perd. */
                readOnly={battletagLocked}
                aria-readonly={battletagLocked || undefined}
              />
              <FieldErrorText fieldId={PROFILE_FIELD_IDS.battletag} message={fieldErrors.message("battletag")} />
              {/* Verrouillé, l'état du module ; ouvert, la finalité (`battletagFieldNotice`). */}
              <p id="profile-battletag-hint" className={s.hint}>
                {battletagNotice.status}
              </p>
            </div>
            <div className="field">
              <label htmlFor="profile-marvel">{t("games.marvel")}</label>
              <input
                id="profile-marvel"
                value={marvelRivalsTag}
                onChange={(e) => setMarvelRivalsTag(e.target.value)}
                aria-describedby="profile-marvel-hint"
              />
              <p id="profile-marvel-hint" className={s.hint}>
                {t("games.gameTagNotice")}
              </p>
            </div>
          </div>
        </ProfileSection>

        <ProfileSection section={sectionById.discord}>
          <div className="field">
            <InfoHintRow>
              <label htmlFor="profile-discord">
                <span className={s.fieldLabelRow}>
                  {t("discord.label")}
                  {discordState.verified ? <VerifiedBadge labels={verifiedBadgeLabels(text)} /> : null}
                </span>
              </label>
              <DiscordFieldHint notice={discordNotice} text={text} />
            </InfoHintRow>
            <input
              id="profile-discord"
              value={discordPseudo}
              onChange={(e) => {
                setDiscordPseudo(e.target.value);
                fieldErrors.clear("discord");
              }}
              placeholder={t("discord.placeholder")}
              {...fieldErrors.aria("discord", "profile-discord-hint", discordHasMore && "profile-discord-more")}
              /* Un compte Discord rattaché possède son tag : le champ le
                 montre, il ne le prend plus. `readOnly` et non `disabled` —
                 la valeur reste lisible au lecteur d'écran et atteignable au
                 clavier, ce qu'un champ désactivé perd. */
              readOnly={discordLocked}
              aria-readonly={discordLocked || undefined}
            />
            <FieldErrorText fieldId={PROFILE_FIELD_IDS.discord} message={fieldErrors.message("discord")} />
            {discordLocked ? (
              discordLockedActions
            ) : (
              <div className={s.actionsRow}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setVerifyOpen(true)}
                  /* « Recertifier » seul ne dit pas quoi : le libellé
                     accessible commence par le texte visible (WCAG 2.5.3) et
                     ajoute l'objet. */
                  aria-label={
                    discordState.verified
                      ? t("discord.recertifyLabel")
                      : t("discord.certifyLabel")
                  }
                  style={{ padding: "7px 14px", fontSize: 12 }}
                >
                  {discordState.verified ? t("discord.recertify") : t("discord.certify")}
                </button>
              </div>
            )}
            {/* **Deux cas seulement, et non trois.** Un tag certifié appartient
                forcément à un compte rattaché — `writeVerifiedTag` écrit
                `discord_id`, et détacher Discord décertifie —, donc `verified`
                implique `discordLocked` : la branche « certifié, non verrouillé »
                ne pouvait jamais être atteinte. C'est l'état du verrou qui énonce
                alors l'exposition (`discordNotice`). */}
            <p id="profile-discord-hint" className={s.hint}>
              {discordNotice.status}
            </p>
          </div>
        </ProfileSection>

        <ProfileSection section={sectionById.confidentialite}>
          <div className={s.toggleGroup}>
            <InfoHintRow>
              <p className={s.toggleGroupTitle}>{t("privacy.visibleTitle")}</p>
              <InfoHint id="profile-visibility-more" subject={t("privacy.visibleTitle")}>
                <p>{t("privacy.pseudoAlwaysVisible")}</p>
                <p>{t("privacy.discordNotice")}</p>
                <p>{t("privacy.battletagNotice")}</p>
              </InfoHint>
            </InfoHintRow>
            <div className={s.toggleRow}>
              {Object.entries(visibility).map(([key, value]) => (
                <Coche
                  key={key}
                  label={visibilityLabel(text, key)}
                  checked={value}
                  theme="joueur"
                  onChange={() => {
                    // La bascule se fait **sans condition** : la modale informe,
                    // elle ne demande rien. L'ouvrir avant d'écrire l'état ferait
                    // d'un « J'ai compris » la condition d'un geste déjà fait.
                    setVisibility((prev) => ({ ...prev, [key]: !prev[key as keyof typeof prev] }));
                    // Et seulement dans **ce** sens : rendre public ne surprend
                    // personne, c'est masquer qui promet plus que le site ne tient.
                    if (key === "overwatch" && value) setBattletagNoticeOpen(true);
                  }}
                />
              ))}
            </div>
            {/* L'avertissement reste visible : il dit l'état du joueur, pas une règle. */}
            {discordWarning ? <p className={s.hint}>{discordWarning}</p> : null}
          </div>

          <div className={s.toggleGroup}>
            <InfoHintRow>
              <p className={s.toggleGroupTitle}>{t("privacy.recruitmentTitle")}</p>
              <InfoHint id="profile-recruitment-more" subject={t("privacy.recruitmentTitle")}>
                <p>{t("privacy.recruitmentHint")}</p>
              </InfoHint>
            </InfoHintRow>
            <div className={s.toggleRow}>
              <Coche
                label={t("privacy.openToOffers")}
                checked={openToRecruitment}
                theme="joueur"
                onChange={() => setOpenToRecruitment((v) => !v)}
              />
            </div>
          </div>

        </ProfileSection>

        {/* Le pied appartient au **formulaire**, pas à sa dernière section : il
            couvre quatre sections, et son unique bouton, posé au fond de la
            quatrième, était hors de vue pour qui arrive par une ancre. Collé au
            bas de la fenêtre, il reste atteignable depuis n'importe laquelle. */}
        <div className={s.formFoot}>
          <button type="submit" className={`btn ${s.save}`}>
            {t("save")}
          </button>
        </div>
      </form>

      <ProfileSection section={sectionById.connexions}>
        <ConnectedAppsSection
          connections={connections}
          reload={reloadConnections}
          onChanged={loadDiscordState}
          onDiscordTagChanged={(tag) => {
            // Le pseudo vient d'être écrit en base par le code du bot : le champ
            // (verrouillé sous un Discord rattaché) **et** sa référence suivent,
            // sans quoi l'écran montrerait l'ancien pseudo jusqu'au rechargement.
            setDiscordPseudo(tag);
            setSavedDiscordPseudo(tag);
            // Un pseudo qui change perd sa certification (comme côté serveur) :
            // l'écran ne la garde pas si la relecture de l'état Discord échoue.
            // Le profil chargé aussi : il sert de repli quand cette lecture échoue.
            setDiscordState((prev) => (prev.tag === tag ? prev : { ...prev, tag, verified: false }));
            setData((prev) =>
              prev && prev.profile.discordPseudo !== tag
                ? { ...prev, profile: { ...prev.profile, discordVerified: false } }
                : prev,
            );
          }}
          onDiscordUnlinked={() => {
            setDiscordState((prev) => ({ ...prev, linked: false, verified: false, attested: false }));
            setData((prev) => (prev ? { ...prev, profile: { ...prev.profile, discordVerified: false } } : prev));
          }}
        />
      </ProfileSection>

      <ProfileSection section={sectionById.notifications}>
        <PushNotificationsPanel />
        {data?.accountLocale ? <AccountLocaleField initial={data.accountLocale} /> : null}
        {/* Un compte sans tag Discord certifié ne reçoit aucun de ces
            messages : la case le dit (`matchDmReachable`, profil chargé en
            repli de l'état Discord ; `null` tant qu'aucun des deux n'est lu). */}
        <MatchDmField
          initial={data?.matchDmEnabled}
          discordReachable={matchDmReachable(discordState, data?.profile.discordVerified)}
          onChoice={reportMatchDmChoice}
        />
        <RecruitmentModalField initialOff={data?.recruitmentModalOff} onSaved={() => router.refresh()} />
      </ProfileSection>

      {invitations.length > 0 && (
        <ProfileSection section={sectionById.invitations}>
          <div className="table-like">
            {invitations.map((inv) => (
              <div className="table-row" key={inv.id} style={{ alignItems: "center" }}>
                <span>
                  <TeamLink teamId={inv.teamId}>{visibleText(inv.teamName)}</TeamLink>
                  {/* Reprise d'une équipe fantôme proposée par le staff : l'accepter
                      en fait le propriétaire, ce qu'une invitation ordinaire ne fait
                      jamais — le joueur doit le lire avant de cliquer. */}
                  {inv.ownership && (
                    <span className={s.inviteOwnership}>{` ${t("invitations.ownership")}`}</span>
                  )}
                </span>
                <span className={s.inviteActions}>
                  <button
                    type="button"
                    className={`btn ${s.inviteButton}`}
                    onClick={() => respondInvitation(inv.id, true)}
                    aria-label={t("invitations.acceptLabel", { team: visibleText(inv.teamName) })}
                    aria-busy={respondingInvitation === inv.id || undefined}
                    aria-disabled={respondingInvitation !== null || undefined}
                  >
                    {t("invitations.accept")}
                  </button>
                  <button
                    type="button"
                    className={`btn ghost ${s.inviteButton}`}
                    onClick={() => respondInvitation(inv.id, false)}
                    aria-label={t("invitations.refuseLabel", { team: visibleText(inv.teamName) })}
                    aria-busy={respondingInvitation === inv.id || undefined}
                    aria-disabled={respondingInvitation !== null || undefined}
                  >
                    {t("invitations.refuse")}
                  </button>
                </span>
              </div>
            ))}
          </div>
        </ProfileSection>
      )}

      {/* Un administrateur seulement (la section se tait sinon) : la route
          refuse tout autre compte sur ses propres rôles (`CANNOT_MODIFY_SELF`). */}
      <SelfRolesSection
        section={sectionById.roles}
        isAdmin={data.isAdmin}
        userId={data.profile.id}
        roles={data.roles}
        onSaved={saveOwnRoles}
      />

      <ProfileSection section={sectionById.statistiques}>
        <div className={s.stats}>
          {[
            { label: t("stats.tournamentsPlayed"), value: data.stats.tournamentsPlayed, tone: "blue" },
            { label: t("stats.tournamentsWon"), value: data.stats.tournamentsWon, tone: "pink" },
            { label: t("stats.wins"), value: data.stats.matchesWon, tone: "teal" },
            { label: t("stats.losses"), value: data.stats.matchesLost, tone: "loss" },
            { label: t("stats.bestRank"), value: data.stats.bestRank ?? "—", tone: "cyan" },
          ].map((stat) => (
            <div key={stat.label} className={s.stat} data-tone={stat.tone}>
              <div className={s.statLabel}>{stat.label}</div>
              <div className={s.statValue}>{stat.value}</div>
            </div>
          ))}
        </div>
      </ProfileSection>

      <ProfileSection section={sectionById.compte} className={s.dangerSection}>
        <div className={s.accountActions}>
          <div className={s.accountActionsLeft}>
            <a href="/api/profile/export" download className={`btn ghost ${s.accountButton}`}>
              {t("account.export")}
            </a>
            <button
              type="button"
              className={`btn ghost ${s.accountButton} ${s.deleteButton}`}
              ref={deleteButtonRef}
              onClick={() => !accountDeletion.deleting && void accountDeletion.start()}
              aria-disabled={accountDeletion.deleting || undefined}
              aria-busy={accountDeletion.deleting || undefined}
            >
              {deleteAccountLabel(text, accountDeletion.deleting, accountDeletion.confirming)}
            </button>
          </div>
          <LogoutButton />
        </div>
      </ProfileSection>
      {confirmingTagRemoval ? (
        <ConfirmActionDialog
          title={t("discord.removalTitle")}
          confirmLabel={t("discord.removalConfirm")}
          pendingLabel={t("discord.removalPending")}
          onClose={() => setConfirmingTagRemoval(false)}
          onConfirm={onDiscordTagRemove}
        >
          <TagRemovalBody verified={tagRemovalVerified} dms={tagRemovalDms} />
        </ConfirmActionDialog>
      ) : null}
      {accountDeletion.dialog}
    </section>
  );
}

/**
 * « Suppression… » pendant l'aperçu seulement : modale ouverte, rien n'est
 * encore parti et le joueur peut renoncer.
 */
function deleteAccountLabel(text: ProfileText, deleting: boolean, confirming: boolean): string {
  return deleting && !confirming ? text.t("account.deleting") : text.t("account.delete");
}

/** Ce que les gestes d'un tag Discord verrouillé lisent et déclenchent. */
interface DiscordLockedActionsProps {
  discordState: DiscordState;
  discordStateBusy: boolean;
  loadDiscordState: () => Promise<void>;
  discordTagBusy: boolean;
  onDiscordTagRemove: () => void;
  setVerifyOpen: (open: boolean) => void;
}

/**
 * Gestes offerts sous un tag Discord verrouillé.
 *
 * Le verrou interdit de **changer** le tag, pas de le prouver ni
 * de le retirer — et ces deux gestes doivent exister à l'écran.
 * La condition porte sur le **rattachement**, pas sur le tag :
 * posée sur le tag, elle ne rendait aucun bouton à l'état que le
 * retrait vient justement de produire (rattaché, sans tag). Sur un
 * état **inconnu**, le verrou porte sa propre sortie : faire
 * disparaître tous les gestes ferait disparaître « Retirer mon
 * tag », la seule annulation d'exposition que le site offre, et
 * une panne de lecture ne doit pas coûter cela.
 */
function DiscordLockedActions({
  discordState,
  discordStateBusy,
  loadDiscordState,
  discordTagBusy,
  onDiscordTagRemove,
  setVerifyOpen,
}: Readonly<DiscordLockedActionsProps>) {
  const { t } = useProfileText();
  return discordState.linked !== true ? (
    <div className={s.actionsRow}>
      <button
        type="button"
        className="btn ghost"
        onClick={() => !discordStateBusy && void loadDiscordState()}
        aria-disabled={discordStateBusy || undefined}
        aria-label={busyAriaLabel(discordStateBusy, t("discord.retryLabel"))}
        style={{ padding: "7px 14px", fontSize: 12 }}
      >
        {discordStateBusy ? t("discord.reading") : t("discord.retry")}
      </button>
    </div>
  ) : (
    <DiscordLinkedActions
      discordState={discordState}
      discordTagBusy={discordTagBusy}
      onDiscordTagRemove={onDiscordTagRemove}
      setVerifyOpen={setVerifyOpen}
    />
  );
}

/** Rattaché : certifier (ou enregistrer) le tag, et le retirer. */
function DiscordLinkedActions({
  discordState,
  discordTagBusy,
  onDiscordTagRemove,
  setVerifyOpen,
}: Readonly<Omit<DiscordLockedActionsProps, "discordStateBusy" | "loadDiscordState">>) {
  const { t } = useProfileText();
  /* Sans tag enregistré il n'y a rien à *certifier* : le
     geste est d'en poser un — le dialogue renvoie alors
     chez Discord, qui nomme le pseudo, que le joueur
     certifie ensuite d'un clic. Avec un tag nommé par
     Discord, le dialogue certifie d'un clic. */
  const certify = discordState.tag
    ? { label: t("discord.certify"), ariaLabel: t("discord.certifyLabel") }
    : { label: t("discord.register"), ariaLabel: t("discord.registerLabel") };
  return (
    <div className={s.actionsRow}>
      {discordState.verified ? null : (
        <button
          type="button"
          className="btn"
          onClick={() => setVerifyOpen(true)}
          aria-label={certify.ariaLabel}
          style={{ padding: "7px 14px", fontSize: 12 }}
        >
          {certify.label}
        </button>
      )}
      {discordState.tag ? (
        <button
          type="button"
          className="btn ghost"
          onClick={() => !discordTagBusy && onDiscordTagRemove()}
          aria-disabled={discordTagBusy || undefined}
          aria-label={busyAriaLabel(discordTagBusy, t("discord.removeLabel"))}
          style={{ padding: "7px 14px", fontSize: 12 }}
        >
          {discordTagBusy ? t("discord.removing") : t("discord.remove")}
        </button>
      ) : null}
    </div>
  );
}
