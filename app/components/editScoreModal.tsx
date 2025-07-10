"use client";

import React, {useEffect, useState} from "react";
import {Team, TeamTournament, Tournament, Match} from "../../lib/types";
import {useUser} from "./contexts/User";
import "./editScoreModal.css";

type ScoreModalProps = {
    isOpen: boolean;
    setError: React.Dispatch<React.SetStateAction<{error: string, once: boolean}>>;
    onClose: () => void;
    tournament: Tournament & { matchs: Match[], teams: (Team & TeamTournament)[] };
};

export default function ScoreModal({
                                       isOpen,
                                       setError,
                                       onClose,
                                       tournament,
                                   }: ScoreModalProps) {
    const [score, setScore] = useState<{match_id: number, score_host: number, score_guest: number, victory: "host" | "guest" | null }>({match_id: -1, score_host: 0, score_guest: 0, victory: null});
    const [teams, setTeams] = useState<{host: Team & TeamTournament, guest: Team & TeamTournament}>();
    const {user, setUser} = useUser();

    useEffect(() => {
        if (!isOpen)
            return;
        if (user.id_team == null) {
            setError({error: "Vous devez avoir une team pour éditer des scores.", once: true});
            onClose();
            return;
        }
        const user_team = tournament.teams.find(u => u.team_id == user.id_team);
        if (user_team == undefined) {
            setError({error: "Votre équipe doit participer au tournois pour remplir des scores.", once: true});
            onClose();
            return;
        }
        if (user_team.id_owner != user.user_id) {
            setError({error: "Vous devez être le propriétaire de l'équipe pour remplir les scores.", once: true});
            onClose();
            return;
        }
        const match = tournament.matchs.find(u => (u.id_team_tournament_host == user_team.team_tournament_id || u.id_team_tournament_guest == user_team.team_tournament_id) && u.victory == null);
        if (match == undefined) {
            setError({error: "Vous devez avoir un match en cours pour éditer un score.", once: true});
            onClose();
            return;
        }
        const host = tournament.teams.find(u => u.team_tournament_id == match.id_team_tournament_host);
        const guest = tournament.teams.find(u => u.team_tournament_id == match.id_team_tournament_guest);
        if (guest == undefined || host == undefined) {
            setError({error: "Oups... Une erreur est apparu. Essayez plus tard ou demander un admin.", once: true});
            onClose();
            return;
        }
        setTeams({host: host, guest: guest});
        setScore({match_id: match.tournament_match_id, score_host: match.score_host, score_guest: match.score_guest, victory: match.victory});
    }, [isOpen]);

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
                setError({error: result.error, once: true});
            setError({error: "Score mis à jour!", once: true});
        })();
        onClose();
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
                    <select value={score.victory ? score.victory : ""} onChange={(e) => setScore((prevState) =>  ({...prevState, victory: (e.target.value == "" ? null : e.target.value) as ("host" | "guest" | null)}))}>
                        <option value="">Aucun</option>
                        <option value="host">{teams?.host.name}</option>
                        <option value="guest">{teams?.guest.name}</option>
                    </select>

                    <div className="modal-buttons">
                        <button type="submit" className="submit-btn">Valider</button>
                        <button type="button" className="cancel-btn" onClick={onClose}>Annuler</button>
                    </div>
                </form>
            </div>
        </div>
    );
}
