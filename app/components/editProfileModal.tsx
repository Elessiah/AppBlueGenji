import React, {useState} from "react";
import {useUser} from "./contexts/User";
import "./editProfileModal.css";

type editProfileModalProps = {
    isOpen: boolean;
    setError: React.Dispatch<React.SetStateAction<{error: string, once: boolean}>>;
    onClose: () => void;
};

export default function EditProfileModal({
                                           isOpen,
                                           setError,
                                           onClose
                                       }: editProfileModalProps) {
    const [name, setName] = useState('');
    const {user, setUser} = useUser();

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        (async () => {
            const response = await fetch("/api/user", {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json',
                    'token': user.token,
                },
                body: JSON.stringify({command: "update_username", new_username: name}),
            })
            if (response.headers.get('token') != null)
                setUser((prevState) => ({...prevState, token: response.headers.get('token')!}));
            if (!response.ok) {
                setError({error: (await response.json()).error, once: true});
                onClose();
                return;
            }
            setUser((prevState) => ({...prevState, username: name}));
            setName("");
            setError({error: "Modifications sauvegardés !", once: true});
            onClose();
        })();
    }

    if (!isOpen) {
        return null;
    }

    return (
        <main className={"modal-overlay"}>
            <form className={"edit-form"} onSubmit={handleSubmit}>
                <h1>Edition du profil</h1>

                <label htmlFor="name">Nouveau nom</label>
                <input
                    id="name"
                    type="text"
                    placeholder="Nouveau nom"
                    required
                    minLength={3}
                    maxLength={15}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                />
                <button type={"submit"} className={"submit-button"}>Sauvegarder</button>
                <button type="button" className="cancel-btn" onClick={() => {onClose(); setName("")}}>Annuler</button>
            </form>
        </main>
    );
}