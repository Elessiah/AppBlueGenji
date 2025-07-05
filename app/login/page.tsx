"use client";

import React from "react";
import { useState } from "react";
import "./Login.css";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { useUser } from "../components/contexts/User";
import { UserInfo } from "../../lib/types";
import {redirect, useSearchParams} from "next/navigation";
import Modal from "../components/Modal";

export default function Login() {
    const [username, setUsername] = useState<string>("");
    const [password, setPassword] = useState<string>("");
    const [showPassword, setShowPassword] = useState<boolean>(false);
    const {user, setUser} = useUser();
    const searchParams = useSearchParams();
    const urlError = searchParams.get("error");
    const [error, setError] = useState<{error: string, once: boolean}>({error: "", once: false});

    if (!error.once && urlError != null)
        setError({error: urlError, once: true});

    if (user.user_id != -1) {
        redirect("/user?username=" + username);
    }

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        (async () => {
            let response = await fetch("/api/user", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({command: "auth", user: username, password: password})
            });
            if (!response.ok) {
                setError({error:(await response.json()).error, once: true});
                return;
            }
            if (response.headers.get('token') == null) {
                setError({error:"Wrong password or username!", once: true});
                return;
            }
            const token = response.headers.get('token')!;
            response = await fetch("/api/user?username=" + username);
            const result: { error: string } | UserInfo = await response.json();
            if (!response.ok) {
                setError({error:(await response.json()).error, once: true});
                return;
            }
            setUser({...result as UserInfo, token: token});
            redirect("/tournament");
        })();
    };

    return (
        <main className="login-page">
            <Modal text={error.error} onClose={() => { setError((prevState) => ({...prevState, error: ""}))}}></Modal>
            <form className="login-form" onSubmit={handleSubmit}>
                <h1>Connexion</h1>

                <label htmlFor="username">Nom d'utilisateur</label>
                <input
                    id="username"
                    type="username"
                    placeholder="Nom d'utilisateur"
                    required
                    value={username}
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
                <button type="submit" className={"submit-button"}>Se connecter</button>
                <Link href={"/register"} className={"text-button"}>S'inscrire</Link>
            </form>
        </main>
    );
}
