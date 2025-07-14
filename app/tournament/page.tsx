"use client";
import {useUser} from "../components/contexts/User";
import {redirect, usePathname, useSearchParams} from "next/navigation";
import Modal from "../components/Modal";
import {useEffect, useState} from "react";
import "./Tournament.css";
import {Team, TeamTournament, Tournament, Match} from "../../lib/types";
import { Bracket, IRoundProps } from 'react-brackets';
import Link from "next/link";
import {PencilIcon} from "lucide-react";
import ScoreModal from "../components/editScoreModal";

export default function TournamentPage() {
    const [tournament, setTournament] = useState<(Tournament & {
        matchs: Match[],
        teams: (Team & TeamTournament)[]
    }) | null>(null);
    let lastUpdate: Date = new Date();
    const {user, setUser} = useUser();
    const [error, setError] = useState<{ error: string, once: boolean }>({error: "", once: false});
    const [isOpen, setIsOpen] = useState(false);
    const pathname = usePathname();
    const searchParams = useSearchParams();

    let urlError: string | null = searchParams.get('error');
    let strID: string | null = searchParams.get('id');
    let tmpInfo: Tournament & { matchs: Match[], teams: (Team & TeamTournament)[] };

    if (strID === null)
        redirect(urlError ? `/tournament/list?error=${error}` : `/tournament/list`);

    if (!error.once && urlError != null) {
        setError({error: urlError, once: true});
    }

    const checkTeamStatus = (): "None" | "Join" | "Leave" => {
        if (!tournament || !tournament.open_registration || !tournament.close_registration)
            return "None";
        const now = new Date();
        if (now < tournament!.open_registration || now > tournament!.close_registration)
            return "None";
        if (!user.id_team)
            return "None";
        const team = tournament.teams.find((team) => team.id_team == user.id_team);
        if (team == undefined)
            return "Join";
        return "Leave";
    }

    const isTournamentEnded = (): boolean => {
        if (!tournament || !tournament.matchs)
            return false;
        if (tournament.matchs.length == 0)
            return false;
        const matchRemaining = tournament.matchs.find((u) => u.id_victory_team == null);
        return matchRemaining == undefined;
    }

    const generateBracket = (): IRoundProps[] => {
        let rounds: IRoundProps[] = [];
        if (!tournament || !tournament.matchs || tournament.matchs.length == 0)
            return rounds;
        let nround: number = 0;
        let nbRoundMatch: number = tournament.size / 2;
        let startNbRoundMatch: number = 0;
        if (nbRoundMatch == 4)
            rounds.push({title: `Quart de Finale`, seeds: []});
        else if (nbRoundMatch == 2)
            rounds.push({title: `Demi Finale`, seeds: []});
        else if (nbRoundMatch == 1)
            rounds.push({title: `Finale`, seeds: []});
        else
            rounds.push({title: `Round ${nround + 1}`, seeds: []});
        for(let nmatch: number = 0; nmatch < tournament.matchs.length; nmatch++) {
            const match = tournament.matchs.toReversed()[nmatch];
            rounds[nround].seeds.push({id: match.id_match, date: tournament.start.toDateString(), teams: [{name: tournament.teams.find(u => u.id_team == match.teams[0].id_team)?.name || "..."}, {name: tournament.teams.find(u => u.id_team == match.teams[1].id_team)?.name || "..."}]});
            if (nmatch == ((nbRoundMatch - startNbRoundMatch) - 1)) {
                nround++;
                startNbRoundMatch = nmatch;
                nbRoundMatch /= 2;
                if (nbRoundMatch == 4)
                    rounds.push({title: `Quart de Finale`, seeds: []});
                else if (nbRoundMatch == 2)
                    rounds.push({title: `Demi Finale`, seeds: []});
                else if (nbRoundMatch == 1)
                    rounds.push({title: `Finale`, seeds: []});
                else
                    rounds.push({title: `Round ${nround + 1}`, seeds: []});
            }
        }
        if (isTournamentEnded()) {
            const final: Match = tournament.matchs[tournament.matchs.length - 1];
            rounds.push({title: `Vainqueur`, seeds: [{id: final.id_match + 1, teams: [{name: final.id_victory_team == final.teams[0].id_team ? tournament.teams.find(u => u.id_team == final.teams[0].id_team)?.name : tournament.teams.find(u => u.id_team == final.teams[1].id_team)?.name}]}]});
        }
        return rounds;
    }

    const getTournament = async (id: number) => {
        let response = await fetch(`/api/tournament?id=${id}`);
        if (!response.ok) {
            redirect(`/?error=${(await response.json()).error}`);
        }
        tmpInfo = {...(await response.json()), matchs: [], teams: []};
        tmpInfo.creation_date = new Date(tmpInfo.creation_date);
        tmpInfo.start_visibility = new Date(tmpInfo.start_visibility);
        tmpInfo.open_registration = new Date(tmpInfo.open_registration);
        tmpInfo.close_registration = new Date(tmpInfo.close_registration);
        tmpInfo.start = new Date(tmpInfo.start);
        response = await fetch(`/api/tournament?id=${id}&g=teams`)
        if (!response.ok) {
            redirect(`/?error=${(await response.json()).error}`);
        }
        tmpInfo.teams = (await response.json()).teams;
        response = await fetch(`/api/tournament?id=${id}&g=matchs`)
        if (!response.ok) {
            redirect(`/?error=${(await response.json()).error}`);
        }
        tmpInfo.matchs = (await response.json()).matchs;
        setTournament(tmpInfo);
    }

    const handleSubscription = async(join: boolean = true) => {
        console.log("Id tournament: ", tournament!.id_tournament);
        const response = await fetch("/api/tournament",  {
            method: "POST",
            headers: {
                'Content-Type': 'application/json',
                'token': user.token,
            },
            body: JSON.stringify({command: join ? "register" : "unregister", id_tournament: tournament!.id_tournament})
        });
        if (!response.ok) {
            setError({error: (await response.json()).error, once: true});
        }
        if (response.headers.get('token') != null)
            setUser((prevState) => ({...prevState, token: response.headers.get('token')!}))
        getTournament(tournament!.id_tournament);
    };

    useEffect(() => {
        const id = parseInt(strID as string, 10);
        getTournament(id);

        if (!isTournamentEnded()) {
            const interval = setInterval(() => {
                lastUpdate = new Date();
                getTournament(id);
            }, 5000);

            return () => clearInterval(interval);
        }
    }, [strID, pathname]);

    if (tournament == null)
        return <main className={"tournament-single-page"}></main>
    return (
        <main className="tournament-single-page">
            <ScoreModal isOpen={isOpen} setError={setError} tournament={tournament} onClose={() => {setIsOpen(false); getTournament(tournament!.id_tournament)}}></ScoreModal>
            <Modal text={error.error} onClose={() => {
                setError({error: "", once: true})
            }}></Modal>
            {
                checkTeamStatus() == "None" ? <></> : checkTeamStatus() == "Join" ?
            <div className="tournament-header">
                <button className="subscription-button" onClick={() => handleSubscription(true)}>
                    Inscrire mon équipe
                </button>
            </div>
                    :
                    <div className="tournament-header">
                        <button className="unsubscription-button" onClick={() => handleSubscription(false)}>
                            Désinscrire mon équipe
                        </button>
                    </div>
            }
            <section className="tournament-info">
                <h1 className="tournament-name">{tournament.name}</h1>
                <p className="tournament-description">{tournament.description}</p>
                <p className="team-count">
                    {tournament.teams.length} / {tournament.size} équipes inscrites
                </p>
                { !isTournamentEnded() ?
                        <p className={"tournament-description"}>Dernière mise à jour de la page: {lastUpdate.toLocaleString()}</p>
                    :
                        <p className={"tournament-description"}>Tournois terminé</p>
                }
            </section>

            <section className="bracket-section">
                {tournament.matchs.length > 0 ?
                    <>
                        <h2>Arbre</h2>
                        { !isTournamentEnded() ?
                        <div className="arbre-header">
                            <button className="score-button" onClick={() => setIsOpen(true)}>
                                <PencilIcon size={16}/>
                                Entrez les scores
                            </button>
                        </div>
                            :
                            <></>
                        }
                        <>
                        </>
                        <Bracket rounds={generateBracket()}/>
                    </>
                    :
                    <>
                        <h2>En attente du départ...</h2>
                        <p className="tournament-description">Début des inscriptions le : {tournament.open_registration.toLocaleString()}</p>
                        <p className="tournament-description">Fin des inscriptions le : {tournament.close_registration.toLocaleString()}</p>
                        <p className="tournament-description">Début du tournoi le : {tournament.start.toLocaleString()}</p>
                    </>
                    }
            </section>

            <section className="team-list-section">
                <h2>Équipes participantes</h2>
                <ul className="team-list">
                    {tournament.teams.length > 0 ?
                        <>
                    {tournament.teams.map((team, index) => (
                        <li key={index} className="team-entry">
                            <Link href={`/team?id=${team.id_team}`}>
                                {team.name}
                            </Link>
                        </li>
                    ))}
                        </>
                        :
                        <p className={"tournament-description"}>Aucune équipe inscrite</p>
                    }
                </ul>
            </section>
        </main>
    )
        ;
}