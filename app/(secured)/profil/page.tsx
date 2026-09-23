"use client";

import { UserAvatar } from "@/components/user-avatar";
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LogoutButton } from "@/components/logout-button";
import { Coche } from "@/components/Coche";
import type { FullProfileResponse } from "@/lib/shared/types";
import {
  accountDeletedWriteMessage,
  accountDeletionConfirmation,
  accountDeletionErrorMessage,
  accountDeletionOutcome,
  RETENTION_UNKNOWN,
  type AccountDeletionPlan,
  type ConfirmationSubject,
} from "@/lib/shared/account-deletion";
import { useToast } from "@/components/ui/toast";
import { TeamLink } from "@/components/entity-link";
import { VerifiedBadge } from "@/components/discord-tag";
import {
  discordTagLockNotice,
  isDiscordTagLocked,
} from "@/lib/shared/discord-tag-lock";
import { profileErrorMessage, profileLoadErrorMessage } from "./profile-errors";
import {
  BLIZZARD_BATTLETAG_NOTICE,
  DISCORD_TAG_UNVERIFIED_AUDIENCE,
  GAME_TAG_NOTICE,
} from "@/lib/shared/identity-sharing";
import {
  PROFILE_SECTION_BY_ID,
  profileSectionIdFromHash,
  visibleProfileSections,
} from "./_lib/profile-sections";
import { ProfileSection } from "./_components/ProfileSection";
import { DiscordVerificationDialog } from "./DiscordVerificationDialog";
import { ConnectedAppsSection } from "./ConnectedAppsSection";
import s from "./profil.module.css";

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
      const payload = (await res.json()) as { tag: string | null; verified: boolean; linked: boolean };
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
          // Chemin de **lecture** : le repli doit l'être aussi. `PROFILE_NOT_FOUND`
          // est nommé dans le registre, donc les deux fonctions rendent
          // aujourd'hui la même phrase — mais le jour où ce code en sortirait,
          // celle-ci annoncerait « La sauvegarde a échoué » à un visiteur qui
          // vient d'ouvrir la page, le défaut même que ce registre sépare.
          showError(profileLoadErrorMessage(errorCode));
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
   * L'ancre demandée est lue **une seule fois, au montage**, et non à chaque
   * passage de l'effet : `window.location.hash` garde le dernier lien cliqué,
   * et `data` est remplacé à chaque sauvegarde — relire le fragment aurait
   * remonté le lecteur à la section qu'il avait visitée dix minutes plus tôt au
   * moment où il enregistre son profil depuis une autre.
   */
  const [requestedSection] = useState<string | null>(() =>
    typeof window === "undefined" ? null : profileSectionIdFromHash(window.location.hash),
  );
  const sectionHonoured = useRef(false);
  useEffect(() => {
    if (!data || !requestedSection || sectionHonoured.current) return;
    // Une section conditionnelle peut n'être pas encore là : on retentera au
    // prochain rendu plutôt que de tenir le saut pour fait.
    const target = document.getElementById(requestedSection);
    if (!target) return;
    sectionHonoured.current = true;
    target.scrollIntoView({ block: "start" });
  }, [data, invitations.length, requestedSection]);

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
      if (!response.ok) {
        throw new Error(accountDeletedWriteMessage(payload.error, "PROFILE_UPDATE_FAILED"));
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
      // Quatrième écriture vers `PATCH /api/profile`, arrivée avec le verrou du
      // tag : elle passe par la même porte que la sauvegarde du profil, donc
      // elle peut recevoir le même 409 `ACCOUNT_DELETED` — le compte supprimé
      // depuis un autre onglet pendant que celle-ci attendait son verrou. Sans
      // le registre, le joueur lisait le code en capitales.
      if (!response.ok) {
        throw new Error(accountDeletedWriteMessage(payload.error, "PROFILE_UPDATE_FAILED"));
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
    // Le bouton se ferme **avant** l'aller-retour d'aperçu, et non après la
    // confirmation : `window.confirm` bloquait à lui seul le second clic tant
    // qu'il était la première instruction, mais un `await` posé devant lui
    // rouvre la fenêtre — deux clics, deux confirmations, deux `DELETE`, dont
    // le second échoue en 400 et affiche une erreur juste après le succès.
    if (deleting) return;
    setDeleting(true);

    // Le motif est demandé avant la confirmation : « effacé » et « anonymisé »
    // ne sont pas la même promesse, et « tes statistiques restent » ne veut
    // rien dire à qui n'en a aucune. Le serveur repose la question à l'écriture
    // — ceci informe, cela tranche.
    //
    // Tant que l'aperçu n'a pas répondu, l'écran ne sait **rien** — pas même
    // lequel des deux modes s'appliquera. Il partait d'une hypothèse
    // (`TOURNAMENTS`), qu'il gardait quand la requête échouait : le joueur
    // consentait alors à devenir anonyme et pouvait être effacé entièrement.
    // Sur un geste irréversible, on décrit l'incertitude plutôt que d'inventer
    // la moitié rassurante.
    //
    // `previewed` part de la **même** valeur que `subject`, et non de `null` :
    // sur ce type, `null` n'est pas « je ne sais pas » mais « il ne restera
    // rien ». Initialisé à `null`, un aperçu en échec faisait annoncer un
    // effacement complet dès que la réponse du serveur devenait illisible —
    // l'unique endroit du fichier où l'inconnu redevenait une promesse.
    let subject: ConfirmationSubject = RETENTION_UNKNOWN;
    let previewed: ConfirmationSubject = RETENTION_UNKNOWN;
    try {
      const preview = await fetch("/api/profile/deletion", { cache: "no-store" });
      if (preview.ok) {
        previewed = ((await preview.json()) as AccountDeletionPlan).reason;
        subject = previewed;
      }
    } catch {
      // Injoignable : la phrase qui ne promet ni conservation ni effacement.
    }
    if (!window.confirm(accountDeletionConfirmation(subject))) {
      setDeleting(false);
      return;
    }

    try {
      const response = await fetch("/api/profile", { method: "DELETE" });
      const payload = (await response.json()) as { error?: string } & Partial<AccountDeletionPlan>;
      // Le corps porte un **code**, pas une phrase : la traduction vit dans le
      // module pur, et un code inconnu retombe sur la phrase générique plutôt
      // que de s'afficher tel quel.
      if (!response.ok) throw new Error(accountDeletionErrorMessage(payload.error));
      // `reason` vaut `null` sur un effacement complet : c'est une réponse, pas
      // une absence de réponse. Le `mode` sert donc de témoin — il dit que le
      // serveur a bien répondu, là où un `??` sur le motif retomberait sur
      // l'aperçu au moment précis où le serveur annonce qu'il n'a rien gardé.
      const applied: ConfirmationSubject = payload.mode ? payload.reason ?? null : previewed;
      showSuccess(accountDeletionOutcome(applied));
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
      if (!response.ok) {
        throw new Error(accountDeletedWriteMessage(payload.error, "AVATAR_UPLOAD_FAILED"));
      }
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
      if (!response.ok) {
        throw new Error(accountDeletedWriteMessage(payload.error, "AVATAR_DELETE_FAILED"));
      }
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

  if (!data) {
    return (
      <section className="ds-block" style={{ color: "var(--text-1)" }}>
        Chargement du profil…
      </section>
    );
  }

  // Les sections viennent du registre, et la navigation n'annonce que celles que
  // la page a de quoi remplir : un lien d'ancre ne peut donc pas désigner une
  // section absente. La **recherche par ancre**, elle, reste totale — indexer la
  // liste filtrée rendrait `undefined` sur la section conditionnelle, sans que
  // le typage le voie.
  const sections = visibleProfileSections({ invitations: invitations.length });
  const sectionById = PROFILE_SECTION_BY_ID;

  return (
    <section className={`fade-in ${s.page}`}>
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
        <div className={`ds-header-body ${s.header}`}>
          <UserAvatar src={data.profile.avatarUrl} pseudo={data.profile.pseudo} size={64} />
          <div className={s.headerText}>
            <h1 className={`ds-title blue ${s.title}`}>Mon profil</h1>
            <p className={s.subtitle}>
              Ton pseudo et ton avatar sont publics ; tout le reste se règle ici, champ par
              champ.
            </p>
          </div>
        </div>
      </div>

      {/* Une page de réglages se parcourt rarement en entier : les ancres mènent
          droit à la section cherchée, et le bas de page — export et suppression —
          cesse d'exiger de traverser le reste. */}
      <nav className={s.nav} aria-label="Sections du profil">
        {sections.map((entry) => (
          <a key={entry.id} href={`#${entry.id}`} className={s.navLink}>
            {entry.title}
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
              <label htmlFor="profile-pseudo">Pseudo site</label>
              <input
                id="profile-pseudo"
                value={pseudo}
                onChange={(e) => setPseudo(e.target.value)}
                aria-describedby="profile-pseudo-hint"
              />
              <p id="profile-pseudo-hint" className={s.hint}>
                C&apos;est lui qui t&apos;identifie dans les brackets, les rosters et les
                feuilles de match. Il n&apos;est pas masquable.
              </p>
            </div>
            {/* L'avatar n'a pas de champ à étiqueter — le `<input type="file">`
                est caché et les deux contrôles sont des boutons : « Avatar »
                nomme donc un **groupe** (un `<label>` sans `for` n'étiquette
                rien, et le lecteur d'écran n'annonçait pas à quoi se
                rapportaient les deux boutons). */}
            <div className="field" role="group" aria-labelledby="profile-avatar-label">
              <span id="profile-avatar-label" className={s.groupLabel}>
                Avatar
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={onAvatarChange}
                style={{ display: "none" }}
              />
              <div className={s.avatarActions}>
                <button
                  type="button"
                  className="btn"
                  disabled={avatarBusy}
                  onClick={() => fileInputRef.current?.click()}
                  style={{ padding: "9px 18px", fontSize: 13 }}
                >
                  {avatarBusy ? "Envoi…" : "Changer l'avatar"}
                </button>
                {data.profile.avatarUrl ? (
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={avatarBusy}
                    onClick={onAvatarDelete}
                    /* Le nom accessible commence par le texte affiché (WCAG
                       2.5.3) et lève l'ambiguïté avec « Supprimer mon compte »,
                       plus bas : parcourus hors contexte, deux « Supprimer » ne
                       se distinguent pas. */
                    aria-label="Supprimer mon avatar"
                    style={{ padding: "9px 18px", fontSize: 13 }}
                  >
                    Supprimer
                  </button>
                ) : null}
              </div>
              <p className={`${s.hint} ${s.hintMuted}`}>PNG, JPEG ou WebP — 5 Mo max.</p>
            </div>
            <div className="field">
              <label htmlFor="profile-adult">Statut majeur</label>
              <select
                id="profile-adult"
                value={isAdult}
                onChange={(e) => setIsAdult(e.target.value)}
                aria-describedby="profile-adult-hint"
              >
                <option value="unknown">Non renseigné</option>
                <option value="yes">Oui (18+)</option>
                <option value="no">Non (mineur)</option>
              </select>
              <p id="profile-adult-hint" className={s.hint}>
                Certains tournois distinguent les catégories d&apos;âge. Masquable ci-dessous.
              </p>
            </div>
          </div>
        </ProfileSection>

        <ProfileSection section={sectionById.jeux}>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="profile-battletag">BattleTag Overwatch</label>
              <input
                id="profile-battletag"
                value={overwatchBattletag}
                onChange={(e) => setOverwatchBattletag(e.target.value)}
                placeholder="Pseudo#1234"
                aria-describedby="profile-battletag-hint"
              />
              <p id="profile-battletag-hint" className={s.hint}>
                {GAME_TAG_NOTICE} {BLIZZARD_BATTLETAG_NOTICE}
              </p>
            </div>
            <div className="field">
              <label htmlFor="profile-marvel">Tag Marvel Rivals</label>
              <input
                id="profile-marvel"
                value={marvelRivalsTag}
                onChange={(e) => setMarvelRivalsTag(e.target.value)}
                aria-describedby="profile-marvel-hint"
              />
              <p id="profile-marvel-hint" className={s.hint}>
                {GAME_TAG_NOTICE}
              </p>
            </div>
          </div>
        </ProfileSection>

        <ProfileSection section={sectionById.discord}>
          <div className="field">
            <label htmlFor="profile-discord">
              <span className={s.fieldLabelRow}>
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
              // La condition porte sur le **rattachement**, pas sur le tag :
              // posée sur le tag, elle ne rendait aucun bouton à l'état que le
              // retrait vient justement de produire (rattaché, sans tag). Sur un
              // état **inconnu**, le verrou porte sa propre sortie : faire
              // disparaître tous les gestes ferait disparaître « Retirer mon
              // tag », la seule annulation d'exposition que le site offre, et
              // une panne de lecture ne doit pas coûter cela.
              discordState.linked !== true ? (
                <div className={s.actionsRow}>
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
                <div className={s.actionsRow}>
                  {discordState.verified ? null : (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setVerifyOpen(true)}
                      /* Sans tag enregistré il n'y a rien à *certifier* : le
                         geste est d'en poser un — et il se prouve tout seul,
                         `startDiscordVerification` concluant sur place quand le
                         tag résout vers l'identifiant déjà rattaché. */
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
                      ? "Recertifier mon tag Discord"
                      : "Certifier mon tag Discord"
                  }
                  style={{ padding: "7px 14px", fontSize: 12 }}
                >
                  {discordState.verified ? "Recertifier" : "Certifier mon tag"}
                </button>
              </div>
            )}
            {/* **Deux cas seulement, et non trois.** Un tag certifié appartient
                forcément à un compte rattaché — `writeVerifiedTag` écrit
                `discord_id`, et détacher Discord décertifie —, donc `verified`
                implique `discordLocked` : la branche « certifié, non verrouillé »
                ne pouvait jamais être atteinte. C'est la phrase du verrou qui
                énonce alors l'exposition. L'annonce du tag **non** certifié, elle,
                vient de la source partagée avec `/connexion` : c'est une promesse,
                elle ne doit pas différer d'un écran à l'autre. */}
            <p id="profile-discord-hint" className={s.hint}>
              {discordLocked
                ? discordTagLockNotice({ ...discordState, pending: discordStateBusy })
                : `Tag non certifié : ${DISCORD_TAG_UNVERIFIED_AUDIENCE} Certifie-le pour qu'elle puisse le faire.`}
            </p>
          </div>
        </ProfileSection>

        <ProfileSection section={sectionById.confidentialite}>
          <div className={s.toggleGroup}>
            <p className={s.toggleGroupTitle}>Visible par les autres joueurs</p>
            <div className={s.toggleRow}>
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
            <p className={s.hint}>
              Ton pseudo reste toujours visible : c&apos;est lui qui t&apos;identifie dans les
              brackets, les rosters et les feuilles de match. Ton tag Discord, lui, ne suit
              pas ces réglages — il a les siens, ci-dessus.
            </p>
          </div>

          <div className={s.toggleGroup}>
            <p className={s.toggleGroupTitle}>Recrutement</p>
            <div className={s.toggleRow}>
              <Coche
                label="Ouvert aux propositions d'équipe"
                checked={openToRecruitment}
                theme="joueur"
                onChange={() => setOpenToRecruitment((v) => !v)}
              />
            </div>
            <p className={s.hint}>
              Décoché, tu n&apos;apparais plus dans le filtre « Free agents » de
              l&apos;annuaire et ta carte n&apos;annonce plus que tu cherches une équipe.
            </p>
          </div>

        </ProfileSection>

        {/* Le pied appartient au **formulaire**, pas à sa dernière section : il
            couvre quatre sections, et son unique bouton, posé au fond de la
            quatrième, était hors de vue pour qui arrive par une ancre. Collé au
            bas de la fenêtre, il reste atteignable depuis n'importe laquelle. */}
        <div className={s.formFoot}>
          <button type="submit" className={`btn ${s.save}`}>
            Sauvegarder
          </button>
        </div>
      </form>

      <ProfileSection section={sectionById.connexions}>
        <ConnectedAppsSection onChanged={loadDiscordState} />
      </ProfileSection>

      {invitations.length > 0 && (
        <ProfileSection section={sectionById.invitations}>
          <div className="table-like">
            {invitations.map((inv) => (
              <div className="table-row" key={inv.id} style={{ alignItems: "center" }}>
                <TeamLink teamId={inv.teamId}>{inv.teamName}</TeamLink>
                <span className={s.inviteActions}>
                  <button
                    type="button"
                    className={`btn ${s.inviteButton}`}
                    onClick={() => respondInvitation(inv.id, true)}
                  >
                    Accepter
                  </button>
                  <button
                    type="button"
                    className={`btn ghost ${s.inviteButton}`}
                    onClick={() => respondInvitation(inv.id, false)}
                  >
                    Refuser
                  </button>
                </span>
              </div>
            ))}
          </div>
        </ProfileSection>
      )}

      <ProfileSection section={sectionById.statistiques}>
        <div className={s.stats}>
          {[
            { label: "Tournois joués", value: data.stats.tournamentsPlayed },
            { label: "Tournois gagnés", value: data.stats.tournamentsWon },
            { label: "Victoires", value: data.stats.matchesWon },
            { label: "Défaites", value: data.stats.matchesLost },
            { label: "Meilleur rang", value: data.stats.bestRank ?? "—" },
          ].map((stat) => (
            <div key={stat.label} className={s.stat}>
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
              Exporter mes données
            </a>
            <button
              type="button"
              className={`btn ghost ${s.accountButton} ${s.deleteButton}`}
              onClick={onDeleteAccount}
              disabled={deleting}
            >
              {deleting ? "Suppression…" : "Supprimer mon compte"}
            </button>
          </div>
          <LogoutButton />
        </div>
      </ProfileSection>
    </section>
  );
}
