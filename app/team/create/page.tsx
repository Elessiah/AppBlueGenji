"use client";
import {redirect, useSearchParams} from "next/navigation";
import React, {useState} from "react";
import { useUser } from "../../components/contexts/User";
import {id} from "../../../lib/types";
import "./CreateTeam.css";

export default function CreateTeam() {
    const searchParams = useSearchParams();
    const urlError = searchParams.get('error');

    const [name, setName] = useState('');
    const {user, setUser} = useUser();
    const [error, setError] = useState<{error: string, once: boolean}>({error: "", once: false});

    if (!error.once && urlError != null) {
        setError({error: urlError, once: true});
    }
        const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        (async () => {
            const response = await fetch("/api/team", {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json',
                    'token': user.token,
                },
                body: JSON.stringify({command: "create", name: name}),
            })
            if (response.headers.get('token') != null)
                setUser((prevState) => ({...prevState, token: response.headers.get('token')!}));
            if (!response.ok) {
                setError({error: (await response.json()).error, once: true});
                return;
            }
            const result: id = await response.json() as id;
            setUser((oldUser) => ({...oldUser, id_team: result.id}));
            redirect(`/team?id=${result.id}`);
        })();
    }

    if (user.id_user == -1) {
        redirect("/login?error=Tu dois être connecté pour créer une équipe");
    }
    if (user.id_team !== null)
        redirect(`/team?id=${user.id_team}`);
    return (
        <main className={"team-creation-page"}>
            <form className={"creation-form"} onSubmit={handleSubmit}>
                <h1>Créer une équipe</h1>

                <label htmlFor="name">Nom de l&aposéquipe</label>
                <input
                    id="name"
                    type="text"
                    placeholder="Nom de l'équipe"
                    required
                    minLength={3}
                    maxLength={15}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                />
                <button type={"submit"} className={"submit-button"}>Créer</button>
            </form>
        </main>
    );
}