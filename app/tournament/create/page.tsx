"use client";

import React, { useState } from "react";
import "./CreateTournament.css";
import Modal from "../../components/Modal";
import {redirect, useSearchParams} from "next/navigation";
import {useUser} from "../../components/contexts/User";
import {id} from "../../../lib/types";

const defaultForm = {
    name: "",
    description: "",
    format: "SIMPLE",
    size: 8,
    start_visibility: "",
    open_registration: "",
    close_registration: "",
    start: "",
};

export default function CreateTournamentPage() {
    const searchParams = useSearchParams();
    const urlError: string | null = searchParams.get('error');
    const [error, setError] = useState<{ error: string, once: boolean }>({error: "", once: false});
    const {user, setUser} = useUser();

    if (!error.once && urlError != null) {
        setError({error: urlError, once: true});
    }

    const [form, setForm] = useState(defaultForm);
    if (user.id_user == -1)
        redirect("/login?error=Vous devez être connecté pour créer un tournoi !");

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        (async () => {
            const response = await fetch("/api/tournament", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    'token': user.token,
                },
                body: JSON.stringify({command: "create", ...form}),
            });
            if (response.headers.get('token'))
                setUser((prevState) => ({...prevState, token: response.headers.get('token')!}))
            if (!response.ok) {
                setError({error: (await response.json()).error, once: true});
                return;
            }
            const result = await response.json() as id;
            setForm(defaultForm);
            redirect("/tournament?id=" + result.id);
        })();

    };

    return (
        <main className="form-container">
            <Modal text={error.error} onClose={() => {
                setError({error: "", once: true})
            }}></Modal>
            <form className="styled-form" onSubmit={handleSubmit}>
                <h1>Créer un tournoi</h1>

                <label>Nom du tournoi</label>
                <input
                    type="text"
                    name="name"
                    value={form.name}
                    onChange={(e) => setForm((prevState) => ({...prevState, name: e.target.value}))}
                    required
                />

                <label>Description</label>
                <textarea
                    name="description"
                    rows={3}
                    value={form.description}
                    onChange={(e) => setForm((prevState) => ({...prevState, description: e.target.value}))}
                    required
                />

                <label>Format</label>
                <select name="format" value={form.format} onChange={(e) => setForm((prevState) => ({...prevState, format: e.target.value}))} >
                    <option value="SIMPLE">Simple élimination</option>
                    <option value="DOUBLE">Double élimination</option>
                </select>

                <label>Taille du tournoi</label>
                <input
                    type="number"
                    name="size"
                    min="2"
                    max="1024"
                    value={form.size}
                    onChange={(e) => setForm((prevState) => ({...prevState, size: Number(e.target.value)}))}
                    required
                />

                <label>Date de début de visibilité</label>
                <input
                    type="datetime-local"
                    name="visibilityStart"
                    value={form.start_visibility}
                    onChange={(e) => setForm((prevState) => ({...prevState, start_visibility: e.target.value}))}
                    required
                />

                <label>Début des inscriptions</label>
                <input
                    type="datetime-local"
                    name="registrationStart"
                    value={form.open_registration}
                    onChange={(e) => setForm((prevState) => ({...prevState, open_registration: e.target.value}))}
                    required
                />

                <label>Fin des inscriptions</label>
                <input
                    type="datetime-local"
                    name="registrationEnd"
                    value={form.close_registration}
                    onChange={(e) => setForm((prevState) => ({...prevState, close_registration: e.target.value}))}
                    required
                />

                <label>Début du tournoi</label>
                <input
                    type="datetime-local"
                    name="tournamentStart"
                    value={form.start}
                    onChange={(e) => setForm((prevState) => ({...prevState, start: e.target.value}))}
                    required
                />

                <button type="submit" className="submit-button">Créer</button>
            </form>
        </main>
    );
}
