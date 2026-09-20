"use client";

import { useState } from "react";
import { DiscordTag } from "@/components/discord-tag";
import { useToast } from "@/components/ui/toast";
import { mapError } from "../_lib/error-map";
import styles from "./EntrantContactsPanel.module.css";

/**
 * Contacts Discord des engagés, pour l'arbitrage.
 *
 * C'est l'usage qui justifie toute la certification : reprogrammer une manche,
 * trancher un litige de score ou confirmer un forfait se fait en message privé,
 * et chercher les tags une fiche de profil à la fois n'est pas tenable sur un
 * plateau de trente-deux.
 *
 * **Chargé à la demande, jamais avec la page.** Ces tags ne voyagent pas dans
 * l'instantané du tournoi, qui est diffusé tel quel à tous les abonnés du flux
 * (voir `lib/server/tournaments/contacts.ts`) : le panneau appelle sa route quand
 * on l'ouvre. C'est aussi ce qui fait qu'un arbitre ne charge pas des données
 * personnelles sur chaque visite d'une fiche de tournoi.
 *
 * L'engagé **injoignable** est mis en avant plutôt que caché : c'est lui qui
 * appelle un geste (relancer le capitaine, envisager un forfait), et le lire
 * dans une liste de trente lignes uniformes ne suffirait pas.
 */
export type EntrantContact = {
  userId: number;
  pseudo: string;
  discordTag: string | null;
};

export type EntrantContactGroup = {
  teamId: number;
  teamName: string;
  reachable: boolean;
  members: EntrantContact[];
};

export function EntrantContactsPanel({ tournamentId }: { tournamentId: number }) {
  const { showError } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [entrants, setEntrants] = useState<EntrantContactGroup[] | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/tournaments/${tournamentId}/contacts`, {
        cache: "no-store",
      });
      const payload = (await res.json()) as { entrants?: EntrantContactGroup[]; error?: string };
      if (!res.ok) throw new Error(payload.error || "CONTACTS_LOAD_FAILED");
      setEntrants(payload.entrants ?? []);
    } catch (e) {
      showError(mapError((e as Error).message));
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    // Rechargé à chaque ouverture : un joueur peut certifier son tag pendant que
    // la page reste ouverte, et un panneau replié puis rouvert doit dire l'état
    // du moment plutôt que celui de la première ouverture.
    if (next) void load();
  };

  return (
    <div className="ds-block">
      <div className="ds-section-title blue" style={{ alignItems: "center" }}>
        <h2>Contacts Discord</h2>
      </div>

      <p className={styles.hint}>
        Réservé à l&apos;arbitrage. Seuls apparaissent les tags <strong>certifiés</strong> : un
        joueur qui n&apos;a pas prouvé le sien n&apos;est pas joignable par le site.
      </p>

      {/*
        Bouton de dépliage, pas un bouton d'action : `aria-expanded` et
        `aria-controls` disent au lecteur d'écran qu'il ouvre une région de la
        page, et laquelle. Sans eux, « Afficher les contacts » s'annonce comme
        une navigation.
      */}
      <button
        type="button"
        className="btn"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="entrant-contacts-list"
        style={{ padding: "8px 16px", fontSize: 13 }}
      >
        {open ? "Masquer les contacts" : "Afficher les contacts"}
      </button>

      {open && (
        <div id="entrant-contacts-list" className={styles.list}>
          {loading && entrants === null ? (
            /* `aria-live` : le contenu arrive après un aller-retour, et rien ne
               le dirait autrement à qui ne voit pas la page. */
            <p className={styles.hint} aria-live="polite">
              Chargement…
            </p>
          ) : entrants !== null && entrants.length === 0 ? (
            <p className={styles.hint}>Aucun engagé pour le moment.</p>
          ) : (
            entrants?.map((entrant) => (
              <div key={entrant.teamId} className={styles.group}>
                <div className={styles.groupHead}>
                  <span className={styles.teamName}>{entrant.teamName}</span>
                  {!entrant.reachable && (
                    <span className={styles.unreachable}>Aucun contact certifié</span>
                  )}
                </div>
                {entrant.members.length === 0 ? (
                  <p className={styles.hint}>
                    {/* Tournure neutre : « équipe » et « joueur » n'ont pas le même
                        genre, et l'engagé sans joueur est une fantôme dans les deux
                        cas. */}
                    Aucun joueur rattaché : engagé invité par le staff.
                  </p>
                ) : (
                  <ul className={styles.members}>
                    {entrant.members.map((member) => (
                      <li key={member.userId} className={styles.member}>
                        <span className={styles.pseudo}>{member.pseudo}</span>
                        <DiscordTag
                          tag={member.discordTag}
                          verified={member.discordTag !== null}
                          fallback="Non certifié"
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
