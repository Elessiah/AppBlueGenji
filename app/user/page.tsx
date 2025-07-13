"use client";

import { Pencil, Trash2 } from "lucide-react";
import {redirect, usePathname, useSearchParams} from "next/navigation";
import {useUser} from "../components/contexts/User";
import {History, TeamInfo, UserInfo} from "../../lib/types";
import {useEffect, useState} from "react";
import "./User.css";
import Modal from "../components/Modal";
import Link from "next/link";
import EditProfileModal from "../components/editProfileModal";

type Profile = UserInfo & {
    team_name: string;
    histories: History[];
}

export default function User() {
    const searchParams = useSearchParams();
    const username: string | null = searchParams.get('username');
    let id: string | number | null = searchParams.get('id');
    const errorUrl: string | null = searchParams.get('error');
    let tmp_profile: Profile;

    const {user, setUser} = useUser();
    const [profile, setProfile] = useState<Profile>({...user, team_name: "", histories: []});
    const [ownProfile, setOwnProfile] = useState(false);
    const [error, setError] = useState<{error: string, once: boolean}>({error: "", once: false});
    const [editOpen, setEditOpen] = useState(false);

    const getProfile = async () => {
        if (id) {
            id = parseInt(id as string, 10);
            if (user.id_user != -1 && id == user.id_user) {
                tmp_profile = {...user, team_name: "", histories: []};
            } else {
                const response = await fetch(`/api/user?id=${id}`);
                if (!response.ok) {
                    redirect(`/?error=${(await response.json()).error}`);
                }
                tmp_profile = {...(await response.json() as UserInfo), team_name: "", histories: []};
            }
        } else if (username) {
            if (user.id_user != -1 && username == user.username) {
                tmp_profile = {...user, team_name: "", histories: []};
            } else {
                const response = await fetch(`/api/user?username=${username}`);
                if (!response.ok) {
                    redirect(`/?error=${(await response.json()).error}`);
                }
                tmp_profile = {...(await response.json() as UserInfo), team_name: "", histories: []};
            }
        } else if (user.id_user != -1) {
            redirect("/user?username=" + user.username);
        } else {
            redirect("/login");
        }
        if (tmp_profile.id_team) {
            const response = await fetch(`/api/team?id=${tmp_profile.id_team}`);
            if (!response.ok) {
                redirect(`/?error=${(await response.json()).error}`);
            }
            const fetchTeam = await response.json() as TeamInfo;
            tmp_profile.team_name = fetchTeam.name;
        }
        const response = await fetch(`/api/user?id=${tmp_profile.id_user}&g=history`);
        if (!response.ok) {
            redirect(`/?error=${(await response.json()).error}`);
        }
        tmp_profile.histories = await response.json() as History[];
        if (tmp_profile.histories.length) {
            for (const history of tmp_profile.histories) {
                history.start_visibility = new Date(history.start_visibility);
                history.open_registration = new Date(history.open_registration);
                history.close_registration = new Date(history.close_registration);
                history.start = new Date(history.start);
            }
        }
        setProfile(tmp_profile);
    }

    if (!error.once && errorUrl != null) {
        setError({error: errorUrl,  once: true});
    }

    useEffect(() => {
        getProfile();
    }, [username, id]);

    if ((!ownProfile && user.id_user == profile.id_user) || user.is_admin) {
        setOwnProfile(true);
    } else if (ownProfile && user.id_user != profile.id_user && !user.is_admin) {
        setOwnProfile(false);
    }

    return (
        <div className={"profile-page"}>
            <Modal text={error.error} onClose={() => setError({error: "", once: true})}></Modal>
            <EditProfileModal isOpen={editOpen} setError={setError} onClose={() => {setEditOpen(false); redirect("/user")}} />
            <div className="profile-header">
                <h1 className="username">@{profile.username}</h1>


                {ownProfile ?
                    <div className="profile-actions">
                        <button className="edit-button" title="Modifier le profil" onClick={() => setEditOpen(true)}>
                            <Pencil size={18}/>
                        </button>
                        <button
                            className="delete-button"
                            onClick={async() => {
                                const response = await fetch("/api/user", {
                                    method: "POST",
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'token': user.token,
                                    },
                                    body: JSON.stringify({command: "delete", user_id: user.id_user}),
                                });
                                if (!response.ok)
                                    alert((await response.json()).error);
                                else {
                                    redirect("/register?error=Votre compte a bien été supprimé !");
                                }
                            }
                        }
                        >
                            Supprimer le profil
                        </button>
                        <button
                            className="delete-button"
                            onClick={() => {
                                setUser({id_user: -1, username: "", token: "", id_team: null, is_admin: false});
                                redirect("/login?error=Vous avez été déconnecté");
                            }
                        }
                        >
                            Se déconnecter
                        </button>
                    </div>
                    :
                    <div className="profile-actions"></div>}
            </div>
            <p className="team">
                Équipe :{" "}
                {profile.id_team ? (
                    <span className="highlight"><Link href={`/team?id=${profile.id_team}`}>{profile.team_name}</Link></span>
                ) : (
                    <span className="not-in-team">Aucune</span>
                )}
            </p>
            <div className="history-section">
                <h2>Historique des Tournois</h2>
                {profile.histories && profile.histories.length > 0 ? (
                    <ul className="history-list">
                        {profile.histories.map((history: History, index: number) => (
                            <li key={index} className="history-item">
                                <span>{history.start.toLocaleDateString("fr-FR")}</span>
                                {history.position == -1 ?
                                    <span>En cours</span>
                                    :
                                    <span>Top: {history.position}</span>}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="empty-history">Aucun tournoi enregistré.</p>
                )}
            </div>
        </div>
    );
}
