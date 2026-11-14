"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CERTIFICATION_PROMPT_OFF_PATH,
  forgetLegacyCertificationPromptOff,
  rememberCertificationPromptClosed,
  shouldOpenCertificationPrompt,
  type CertificationPrompt,
} from "@/lib/shared/certification-prompt";
import { CERTIFY_PROMPT_OTHER_ACCOUNT } from "@/lib/shared/discord-certify-prompt";
import { anotherModalOpen, watchModalsClosed, watchUrgentModalOpened } from "@/lib/shared/dialog-focus";

/** Un stockage du navigateur, `null` s'il est inaccessible (accès refusé, rendu serveur). */
function browserStorage(kind: "localStorage" | "sessionStorage"): Storage | null {
  try {
    return typeof window === "undefined" ? null : window[kind];
  } catch {
    return null;
  }
}

/**
 * « Ne plus voir » coché : gardé sur le compte (`POST`, `keepalive` — la
 * fermeture peut être un départ vers le profil). Le corps porte le compte à
 * qui la modale a été montrée : une session changée depuis (autre compte
 * connecté dans un autre onglet) est refusée sans rien écrire : ce refus-là
 * est dit (`onOtherAccount`), le choix n'ayant pas été gardé pour le compte
 * qui l'a fait. Un autre échec n'a pas de suite visible : la modale reviendra
 * simplement à une prochaine fiche, comme avant le choix.
 */
export async function saveNeverAgain(shownTo: number | null, onOtherAccount: () => void): Promise<void> {
  if (shownTo == null) return;
  try {
    const response = await fetch(CERTIFICATION_PROMPT_OFF_PATH, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: shownTo }),
    });
    if (response.ok) return;
    const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
    if (payload?.error === CERTIFY_PROMPT_OTHER_ACCOUNT) onOtherAccount();
  } catch {
    // Réseau, ou `fetch` indisponible (document qui part) : rien de gardé.
  }
}

/**
 * Au-delà, un refus encore retenu derrière une modale ne se dit plus. Dix
 * minutes : de quoi finir la certification ouverte par « Certifier » sur
 * `/profil` (code reçu par message privé, saisi) — le refus se dit alors à sa
 * fermeture, encore dans son contexte.
 */
export const REFUSAL_NOTICE_MAX_WAIT_MS = 600_000;

/** Le guet du refus en cours, un seul à la fois pour tout le document. */
let pendingRefusalNotice: (() => void) | null = null;

/**
 * Appelle `notice` une fois plus aucune modale ouverte (`watchModalsClosed`),
 * au plus `REFUSAL_NOTICE_MAX_WAIT_MS` après le refus : passé ce délai, le
 * guet s'arrête sans rien dire — un toast d'erreur sans contexte, minutes plus
 * tard sur une autre page, ne renseignerait plus. Un nouveau refus remplace le
 * guet précédent. Renvoie l'arrêt.
 */
export function noticeOnceModalsClosed(notice: () => void, maxWaitMs = REFUSAL_NOTICE_MAX_WAIT_MS): () => void {
  pendingRefusalNotice?.();
  let stopWatch: (() => void) | null = null;
  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    stopWatch?.();
    if (pendingRefusalNotice === stop) pendingRefusalNotice = null;
  };
  const timer = setTimeout(stop, maxWaitMs);
  pendingRefusalNotice = stop;
  stopWatch = watchModalsClosed(() => {
    if (done) return;
    stop();
    notice();
  });
  // Appelé sur-le-champ (aucune modale ouverte) : le guet est déjà clos.
  if (done) stopWatch();
  return stop;
}

/**
 * Ouverture d'office de l'invitation à certifier (`CERTIFICATION_PROMPT.md`) :
 * une fois par page, dès que le contexte du lecteur en porte une, sauf déjà
 * fermée dans cet onglet. « Ne plus voir » est gardé sur le compte : le serveur
 * ne porte alors plus d'invitation. Les relectures du contexte ne la rouvrent pas.
 *
 * Jamais par-dessus une autre modale (lancement de match, changements de
 * confidentialité…) : une modale déjà ouverte à la décision l'écarte pour
 * cette page, sans rien retenir — l'attendre la ferait surgir au départ du
 * match, sur le plateau. Décidée, sa
 * place est tenue dans le DOM pendant le chargement de son morceau
 * (`data-modal-pending`, `TournamentSheet`). Elle **cède sa place**
 * (`data-modal-yields`) : une modale urgente — le lancement d'un match — passe
 * par-dessus ; l'invitation s'efface pour le reste de la page, sans rien
 * retenir — sauf « Ne plus voir » déjà cochée, gardée sur le compte : elle
 * revient à la prochaine fiche ouverte.
 *
 * Le serveur la calcule une fois par connexion du flux (ou lecture REST de
 * secours) : une certification faite entre-temps ne la retire qu'à la lecture
 * suivante. Retirée (ou lecture en échec côté serveur), elle ferme la modale
 * sans rien retenir : revenue, elle repasse par la décision (autre modale
 * ouverte, « Ne plus voir »). Tournoi clos ou équipe retirée
 * depuis : masquée sur-le-champ (`liveCertificationPrompt`, instantané à
 * jour). Une fiche figée la masque aussi.
 *
 * `onOtherAccount` : « Ne plus voir » refusé parce qu'un autre compte est
 * connecté depuis dans ce navigateur — l'appelant le notifie, appelé une fois
 * plus aucune modale ouverte.
 */
export function useCertificationPrompt(
  tournamentId: number,
  prompt: CertificationPrompt | null | undefined,
  frozen: boolean,
  viewerUserId: number | null,
  onOtherAccount: () => void,
) {
  // Lu au moment du refus : un rappel neuf à chaque rendu ne recrée pas
  // `close` ni ne réarme l'observateur des modales urgentes.
  const onOtherAccountRef = useRef(onOtherAccount);
  useEffect(() => {
    onOtherAccountRef.current = onOtherAccount;
  }, [onOtherAccount]);
  // Le refus se dit **une fois plus aucune modale ouverte** (revue #521) : la
  // réponse arrive souvent quand une urgente est passée par-dessus (`yieldPlace`)
  // ou, après « Certifier », sur `/profil` où le dialogue de certification
  // s'ouvre — le toast partirait derrière. Le guet porte sur le document, pas
  // sur la fiche : il survit à la navigation client vers le profil, où la
  // notification (mise en page racine) reste montée. Le guet est **borné**
  // (`REFUSAL_NOTICE_MAX_WAIT_MS`) : passé ce délai, le refus n'a plus de
  // contexte et se tait, plutôt que d'observer la page indéfiniment.
  const refused = useCallback(() => {
    noticeOnceModalsClosed(() => onOtherAccountRef.current());
  }, []);
  const [open, setOpen] = useState(false);
  // Case « Ne plus voir » : son seul état, tenu ici pour valoir aussi quand la
  // modale s'efface devant une urgente. La modale l'affiche (case, libellé
  // « Fermer » du bouton) ; la cocher rend la fiche une fois, comme un
  // instantané du flux.
  const [neverAgain, setNeverAgain] = useState(false);
  const decided = useRef(false);
  // Le compte à qui la modale a été montrée, retenu à l'ouverture : c'est lui,
  // pas la session du moment, que « Ne plus voir » désigne.
  const shownTo = useRef<number | null>(null);
  // Les effets lisent l'invitation par sa présence, pas par son identité : une
  // relecture REST en renvoie une neuve au contenu identique.
  const present = prompt != null;
  const withdrawn = prompt === null;
  // Fermée par le lecteur, ou effacée devant une modale urgente : plus rien
  // sur cette page, même retirée puis revenue, stockage bloqué compris (le
  // drapeau d'onglet peut ne pas s'écrire).
  const doneForPage = useRef(false);

  // La fiche est réutilisée d'un tournoi à l'autre (lien, Précédent) : « cette
  // page » change avec le tournoi, et la mémoire de la page repart de zéro —
  // avant la décision, déclarée après.
  // L'ancienne clé du « Ne plus voir » (commune à tous les comptes du
  // navigateur) n'est plus lue : effacée une fois.
  useEffect(() => {
    forgetLegacyCertificationPromptOff(browserStorage("localStorage"));
  }, []);

  useEffect(() => {
    decided.current = false;
    doneForPage.current = false;
    setNeverAgain(false);
    setOpen(false);
  }, [tournamentId]);

  useEffect(() => {
    if (decided.current || doneForPage.current || !present || frozen) return;
    decided.current = true;
    // Ni déjà fermée dans l'onglet, ni une autre modale
    // déjà ouverte — l'attendre la ferait surgir au départ d'un match, sur le
    // plateau : sinon, pas sur cette page, sans rien retenir.
    const allowed = shouldOpenCertificationPrompt(browserStorage("sessionStorage"));
    if (allowed && !anotherModalOpen()) {
      shownTo.current = viewerUserId;
      setOpen(true);
    }
  }, [tournamentId, present, frozen, viewerUserId]);

  const close = useCallback(() => {
    rememberCertificationPromptClosed(browserStorage("sessionStorage"));
    if (neverAgain) void saveNeverAgain(shownTo.current, refused);
    doneForPage.current = true;
    setOpen(false);
  }, [neverAgain, refused]);

  // S'effacer devant une modale urgente, sans rien retenir dans le navigateur —
  // l'invitation n'a peut-être pas été lue — mais pour le reste de la page :
  // revenue à chaque fermeture d'une annonce de lancement, elle couvrirait le
  // plateau en plein match. Elle revient à la prochaine fiche ouverte.
  // « Ne plus voir » déjà cochée vaut pourtant : gardée sur le compte, sans le
  // drapeau d'onglet d'une fermeture.
  const yieldPlace = useCallback(() => {
    if (neverAgain) void saveNeverAgain(shownTo.current, refused);
    doneForPage.current = true;
    setOpen(false);
  }, [neverAgain, refused]);

  // Invitation retirée (certifiée entre-temps, lecture en échec) : la modale se
  // ferme sans rien retenir, et la décision reprend à son retour — autre
  // modale ouverte entre-temps comprise.
  useEffect(() => {
    if (!withdrawn) return;
    decided.current = false;
    setOpen(false);
  }, [withdrawn]);

  // Affichée seulement : invitation présente et fiche vivante.
  const shown = open && present && !frozen;

  // Une modale urgente s'ouvre par-dessus (lancement d'un match) : place nette
  // sans délai, avant que le morceau ne se monte au-dessus d'elle dans la pile.
  // Armé même onglet caché : un observateur sans minuterie, qui n'examine que
  // les nœuds ajoutés — sans quoi une annonce ouverte onglet caché laisserait
  // l'invitation, devancée, ni affichée ni effacée.
  useEffect(() => {
    if (!shown) return;
    return watchUrgentModalOpened(yieldPlace);
  }, [shown, yieldPlace]);

  // Même contenu, même objet : une relecture REST en renvoie un neuf, et la
  // modale mémoïsée ne doit pas se rendre pour rien.
  const reason = prompt?.reason;
  const discordVerified = prompt?.discordVerified === true;
  const battletagVerified = prompt?.battletagVerified === true;
  const battletagRelevant = prompt?.battletagRelevant === true;
  const teamHasContact = prompt?.teamHasContact === true;
  const battletagUnfixable = prompt?.battletagUnfixable === true;
  const stablePrompt = useMemo<CertificationPrompt | null>(
    () =>
      reason
        ? {
            reason,
            discordVerified,
            battletagVerified,
            battletagRelevant,
            teamHasContact,
            ...(battletagUnfixable ? { battletagUnfixable: true as const } : {}),
          }
        : null,
    [reason, discordVerified, battletagVerified, battletagRelevant, teamHasContact, battletagUnfixable],
  );

  return {
    prompt: shown ? stablePrompt : null,
    neverAgain,
    setNeverAgain,
    close,
  };
}
