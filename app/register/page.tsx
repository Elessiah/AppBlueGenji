"use client";

import React, { useState } from "react";
import "./Register.css";
import Link from "next/link";
import {Eye, EyeOff} from "lucide-react";
import {useUser} from "../components/contexts/User";
import {id} from "../../lib/types"
import {redirect, useSearchParams} from "next/navigation";
import Modal from "../components/Modal";

export default function Register() {
    const searchParams = useSearchParams();
    const urlError = searchParams.get("error");

    const [username, setUsername] = useState<string>("");
    const [password, setPassword] = useState<string>("");
    const [secondPassword, setSecondPassword] = useState<string>("");
    const [showPassword, setShowPassword] = useState<boolean>(false);
    const [error, setError] = useState<{error: string, once: boolean}>({error: "", once: false});
    const {user, setUser} = useUser();

    if (user.user_id != -1) {
        if (urlError) {
            redirect(`/user?username=${username}&error=${urlError}`);
        } else {
            redirect(`/user?username=${username}`);
        }
    }

    if (!error.once && urlError != null) {
        setError({error: urlError, once: true});
    }

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (password !== secondPassword) {
            setError({error:"Les deux mots de passes doivent être identique!", once: true});
            return;
        }
        (async () => {
            const response = await fetch("/api/user", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({command: "new", username: username, password: password})
            });
            if (!response.ok) {
                setError({error: (await response.json()).error, once: true});
                return;
            }
            const result: id = await response.json();
            setUser({user_id: result.id, username: username, token: response.headers.get('token')!, id_team: null, is_admin: false});
            redirect("/user?username=" + user.username);
        })();
    };

    return (
        <main className="register-page">
            <Modal text={error.error} onClose={() => {setError({error: "", once: true})}}></Modal>
            <form className="register-form" onSubmit={handleSubmit}>
                <h1>S'inscrire</h1>

                <label htmlFor="username">Nom d'utilisateur</label>
                <input
                    id="username"
                    type="username"
                    placeholder="Nom d'utilisateur"
                    required
                    value={username}
                    minLength={3}
                    maxLength={15}
                    onChange={(e) => setUsername(e.target.value)}
                />

                <label htmlFor="password">Mot de passe</label>
                <div className={"password-container"}>
                    <input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        placeholder={"Mot de passe"}
                        required
                        value={password}
                        minLength={8}
                        maxLength={50}
                        onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                        className={"eye-button"}
                        type="button"
                        aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                        onClick={() => setShowPassword((value) => !value )}
                    >
                        {showPassword ? <EyeOff size={20}/> : <Eye size={20}/>}
                    </button>
                </div>

                <label htmlFor="password">Répéter le Mot de passe</label>
                <div className={"password-container"}>
                    <input
                        id="second-password"
                        type={showPassword ? "text" : "password"}
                        placeholder={"Répéter le mot de passe"}
                        required
                        value={secondPassword}
                        minLength={8}
                        maxLength={50}
                        onChange={(e) => setSecondPassword(e.target.value)}
                    />
                    <button
                        className={"eye-button"}
                        type="button"
                        aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                        onClick={() => setShowPassword((value) => !value )}
                    >
                        {showPassword ? <EyeOff size={20}/> : <Eye size={20}/>}
                    </button>
                </div>

                <button type="submit" className={"submit-button"}>S'inscrire</button>
                <Link href={"/login"} className={"text-button"}>Se connecter</Link>
            </form>
        </main>
    );
}
