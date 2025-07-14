"use client";

import React, {useEffect, useState} from "react";
import {Team, TeamTournament, Tournament, Match} from "../../lib/types";
import {useUser} from "./contexts/User";
import "./editScoreModal.css";

type ScoreModalProps = {
    isOpen: boolean;
    setErrorAction: React.Dispatch<React.SetStateAction<{error: string, once: boolean}>>;
    onCloseAction: () => void;
    tournament: Tournament & { matchs: Match[], teams: (Team & TeamTournament)[] };
};

export default function ScoreModal({
                                       isOpen,
                                       setErrorAction,
                                       onCloseAction,
                                       tournament,
                                   }: ScoreModalProps) {
    const [score, setScore] = useState<{match_id: number, score_host: number, score_guest: number, victory: number | null }>({match_id: -1, score_host: 0, score_guest: 0, victory: null});
    const [teams, setTeams] = useState<{host: Team & TeamTournament, guest: Team & TeamTournament}>();
    const {user, setUser} = useUser();

    useEffect(() => {
        if (!isOpen)
            return;
        if (user.id_team == null) {
            setErrorAction({error: "Vous devez avoir une team pour éditer des scores.", once: true});
            onCloseAction();
            return;
        }
        const user_team = tournament.teams.find(u => u.id_team == user.id_team);
        if (user_team == undefined) {
            setErrorAction({error: "Votre équipe doit participer au tournois pour remplir des scores.", once: true});
            onCloseAction();
            return;
        }
        if (user_team.id_user != user.id_user) {
            setErrorAction({error: "Vous devez être le propriétaire de l'équipe pour remplir les scores.", once: true});
            onCloseAction();
            return;
        }
        const match = tournament.matchs.find(u => (u.teams[0].id_team == user_team.id_team || u.teams[1].id_team == user_team.id_team) && u.id_victory_team == null);
        if (match == undefined) {
            setErrorAction({error: "Vous devez avoir un match en cours pour éditer un score.", once: true});
            onCloseAction();
            return;
        }
        const host = tournament.teams.find(u => u.id_team == match.teams[0].id_team);
        const guest = tournament.teams.find(u => u.id_team == match.teams[1].id_team);
        if (guest == undefined || host == undefined) {
            setErrorAction({error: "Oups... Une erreur est apparu. Essayez plus tard ou demander un admin.", once: true});
            onCloseAction();
            return;
        }
        setTeams({host: host, guest: guest});
        setScore({match_id: match.id_match, score_host: match.teams[0].score, score_guest: match.teams[1].score, victory: match.id_victory_team});
    }, [isOpen]);// eslint-disable-line

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        (async() => {
            const response = await fetch("/api/tournament", {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json',
                    'token': user.token,
                },
                body: JSON.stringify({command: "match-edit", match_id: score.match_id, score_host: score.score_host, score_guest: score.score_guest, victory: score.victory}),
            });
            if (response.headers.get('token'))
                setUser((prevState) => ({...prevState, token: response.headers.get('token')!}));
            const result = await response.json();
            if (!response.ok)
                setErrorAction({error: result.error, once: true});
            setErrorAction({error: "Score mis à jour!", once: true});
        })();
        onCloseAction();
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <h2>Entrer le score</h2>
                <form onSubmit={handleSubmit}>
                    <label>Score {teams?.host.name}</label>
                    <input
                        type="number"
                        min={0}
                        value={score.score_host}
                        onChange={(e) => setScore((prevState) => ({...prevState, score_host: Number(e.target.value)}))}
                        required
                    />

                    <label>Score {teams?.guest.name}</label>
                    <input
                        type="number"
                        min={0}
                        value={score.score_guest}
                        onChange={(e) => setScore((prevState) => ({...prevState, score_guest: Number(e.target.value)}))}
                        required
                    />

                    <label>Gagnant</label>
                    <select value={score.victory ? score.victory : ""} onChange={(e) => setScore((prevState) =>  ({...prevState, id_victory_team: (e.target.value == "" ? null : e.target.value) as (number | null)}))}>
                        <option value="">Aucun</option>
                        <option value="host">{teams?.host.name}</option>
                        <option value="guest">{teams?.guest.name}</option>
                    </select>

                    <div className="modal-buttons">
                        <button type="submit" className="submit-btn">Valider</button>
                        <button type="button" className="cancel-btn" onClick={onCloseAction}>Annuler</button>
                    </div>
                </form>
            </div>
        </div>
    );
}
