import React, {useState} from "react";
import {useUser} from "./contexts/User";
import "./addMemberModal.css";

type addMemberModalProps = {
    isOpen: boolean;
    setError: React.Dispatch<React.SetStateAction<{error: string, once: boolean}>>;
    onClose: () => void;
    id_team: number;
};

export default function AddMemberModal({
                                           isOpen,
                                           setError,
                                           onClose,
                                           id_team,
                                       }: addMemberModalProps) {
    const [name, setName] = useState('');
    const {user, setUser} = useUser();

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        (async () => {
            const response = await fetch("/api/team", {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json',
                    'token': user.token,
                },
                body: JSON.stringify({command: "add", user: name, id_team: id_team}),
            })
            if (response.headers.get('token') != null)
                setUser((prevState) => ({...prevState, token: response.headers.get('token')!}));
            if (!response.ok) {
                setError({error: (await response.json()).error, once: true});
                onClose();
                return;
            }
            setName("");
            setError({error: "Joueur ajouté avec succès à l'équipe!", once: true});
            onClose();
        })();
    }

    if (!isOpen) {
        return null;
    }

    return (
        <main className={"modal-overlay"}>
            <form className={"invit-form"} onSubmit={handleSubmit}>
                <h1>Inviter un joueur</h1>

                <label htmlFor="name">Nom du joueur</label>
                <input
                    id="name"
                    type="text"
                    placeholder="Nom du joueur"
                    required
                    minLength={3}
                    maxLength={15}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                />
                <button type={"submit"} className={"submit-button"}>Inviter</button>
                <button type="button" className="cancel-btn" onClick={() => {onClose(); setName("")}}>Annuler</button>
            </form>
        </main>
    );
}