"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CERTIFICATION_PROMPT_OFF_PATH,
  forgetLegacyCertificationPromptOff,
  rememberCertificationPromptClosed,
  shouldOpenCertificationPrompt,
  type CertificationPrompt,
} from "@/lib/shared/certification-prompt";
import { anotherModalOpen, watchUrgentModalOpened } from "@/lib/shared/dialog-focus";

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
 * fermeture peut être un départ vers le profil). Un échec n'a pas de suite
 * visible : la modale reviendra simplement à une prochaine fiche, comme avant
 * le choix.
 */
async function saveNeverAgain(): Promise<void> {
  try {
    await fetch(CERTIFICATION_PROMPT_OFF_PATH, { method: "POST", keepalive: true });
  } catch {
    // Réseau, ou `fetch` indisponible (document qui part) : rien de gardé.
  }
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
 */
export function useCertificationPrompt(
  tournamentId: number,
  prompt: CertificationPrompt | null | undefined,
  frozen: boolean,
) {
  const [open, setOpen] = useState(false);
  // Case « Ne plus voir » : tenue ici pour valoir aussi quand la modale
  // s'efface, mais dans une référence — la cocher ne relance pas le rendu de
  // toute la fiche, ni les rappels ci-dessous (l'affichage de la case est
  // l'état local de la modale).
  const neverAgain = useRef(false);
  const decided = useRef(false);
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
    neverAgain.current = false;
    setOpen(false);
  }, [tournamentId]);

  useEffect(() => {
    if (decided.current || doneForPage.current || !present || frozen) return;
    decided.current = true;
    // Ni déjà fermée dans l'onglet, ni une autre modale
    // déjà ouverte — l'attendre la ferait surgir au départ d'un match, sur le
    // plateau : sinon, pas sur cette page, sans rien retenir.
    const allowed = shouldOpenCertificationPrompt(browserStorage("sessionStorage"));
    if (allowed && !anotherModalOpen()) setOpen(true);
  }, [tournamentId, present, frozen]);

  const close = useCallback(() => {
    rememberCertificationPromptClosed(browserStorage("sessionStorage"));
    if (neverAgain.current) void saveNeverAgain();
    doneForPage.current = true;
    setOpen(false);
  }, []);

  // S'effacer devant une modale urgente, sans rien retenir dans le navigateur —
  // l'invitation n'a peut-être pas été lue — mais pour le reste de la page :
  // revenue à chaque fermeture d'une annonce de lancement, elle couvrirait le
  // plateau en plein match. Elle revient à la prochaine fiche ouverte.
  // « Ne plus voir » déjà cochée vaut pourtant : gardée sur le compte, sans le
  // drapeau d'onglet d'une fermeture.
  const yieldPlace = useCallback(() => {
    if (neverAgain.current) void saveNeverAgain();
    doneForPage.current = true;
    setOpen(false);
  }, []);

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

  const setNeverAgain = useCallback((value: boolean) => {
    neverAgain.current = value;
  }, []);

  // Même contenu, même objet : une relecture REST en renvoie un neuf, et la
  // modale mémoïsée ne doit pas se rendre pour rien.
  const reason = prompt?.reason;
  const discordVerified = prompt?.discordVerified === true;
  const battletagVerified = prompt?.battletagVerified === true;
  const battletagRelevant = prompt?.battletagRelevant === true;
  const stablePrompt = useMemo<CertificationPrompt | null>(
    () => (reason ? { reason, discordVerified, battletagVerified, battletagRelevant } : null),
    [reason, discordVerified, battletagVerified, battletagRelevant],
  );

  return {
    prompt: shown ? stablePrompt : null,
    setNeverAgain,
    close,
  };
}
