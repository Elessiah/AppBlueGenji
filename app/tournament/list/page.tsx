"use client";
import {useUser} from "../../components/contexts/User";
import {redirect, useSearchParams} from "next/navigation";
import Modal from "../../components/Modal";
import {useEffect, useState} from "react";
import "./List.css";
import {TournamentTeamsCount} from "../../../lib/types";
import {Plus} from "lucide-react";
import Link from "next/link";

type Tournament= {
    name: string;
    currentPlayers: number;
    maxPlayers: number;
    startDate: string; // ISO date
};

export default function List() {
    const searchParams = useSearchParams();
    let urlError: string | null = searchParams.get('error');
    const [error, setError] = useState<{error: string, once: boolean}>({error: "", once: false});
    const [tournaments, setTournaments] = useState<{pending: TournamentTeamsCount[], active: TournamentTeamsCount[], ended: TournamentTeamsCount[]}>({pending: [], active: [], ended: []});

    if (!error.once && urlError != null) {
        setError({error: urlError, once: true});
    }
    useEffect(() => {
        const getTournaments = async() => {
            const response = await fetch("/api/tournament?g=list");
            if (!response.ok) {
                setError({error: (await response.json()).error,  once: true});
                return;
            }
            setTournaments(await response.json());
        }

        getTournaments();
    }, []);
    return (
    <main className="tournament-page">
        <Modal text={error.error} onClose={() => {setError({error: "", once: true})}}></Modal>
        <div className="tournament-header">
            <button className="create-button" onClick={() => redirect("/tournament/create")}>
                <Plus size={16}/>
                Créer un tournoi
            </button>
        </div>
        <h1 className="page-title">Prochains tournois</h1>

        <div className="tournament-grid">
            {
                tournaments.pending.length > 0 ?
                tournaments.pending.map((tournament, index) => (
                    <div key={index} className="tournament-card" onClick={() => redirect(`/tournament?id=${tournament.id_tournament}`)}>
                        <h2>{tournament.name}</h2>
                        <p>
                            <b>{tournament.nb_teams}</b> / {tournament.size} équipes
                        </p>
                        <p className="start-date">
                            Début le{" "}
                            {new Date(tournament.start).toLocaleDateString("fr-FR", {
                                day: "2-digit",
                                month: "long",
                                year: "numeric",
                            })}
                        </p>
                    </div>
                ))
                    :
                    <p>Aucun tournois en attente</p>
            }
        </div>
        <h1 className="page-title">Tournois en cours</h1>

        <div className="tournament-grid">
            {
                tournaments.active.length > 0 ?
                tournaments.active.map((tournament, index) => (
                <div key={index} className="tournament-card" onClick={() => redirect(`/tournament?id=${tournament.id_tournament}`)}>
                    <h2>{tournament.name}</h2>
                    <p>
                        <b>{tournament.nb_teams}</b> / {tournament.size} équipes
                    </p>
                    <p className="start-date">
                        A débuté le{" "}
                        {new Date(tournament.start).toLocaleDateString("fr-FR", {
                            day: "2-digit",
                            month: "long",
                            year: "numeric",
                        })}
                    </p>
                </div>
            ))
                    :
                    <p>Aucun tournois en cours</p>
            }
        </div>
        <h1 className="page-title">Tournois terminés</h1>

        <div className="tournament-grid">
            {
                tournaments.ended.length > 0 ?
                tournaments.ended.map((tournament, index) => (
                <div key={index} className="tournament-card" onClick={() => redirect(`/tournament?id=${tournament.id_tournament}`)}>
                    <h2>{tournament.name}</h2>
                    <p>
                        <b>{tournament.nb_teams}</b> / {tournament.size} équipes
                    </p>
                    <p className="start-date">
                        A débuté le{" "}
                        {new Date(tournament.start).toLocaleDateString("fr-FR", {
                            day: "2-digit",
                            month: "long",
                            year: "numeric",
                        })}
                    </p>
                </div>
            ))
                    :
                    <p>Aucun tournoi terminé</p>
            }
        </div>
    </main>
);
}