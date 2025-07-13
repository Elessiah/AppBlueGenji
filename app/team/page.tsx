"use client";
import {redirect, useSearchParams} from "next/navigation";
import {useEffect, useState} from "react";
import { useUser } from "../components/contexts/User";
import {History, TeamInfo, UserInfo} from "../../lib/types";
import {MailPlus, Trash2, X } from "lucide-react";
import "./Team.css";
import Link from "next/link";
import Modal from "../components/Modal";
import AddMemberModal from "../components/addMemberModal";

type TeamProfile = TeamInfo & {
    members: UserInfo[],
    histories: History[],
}

export default function Team() {
    const searchParams = useSearchParams();
    let id: string | number | null = searchParams.get('id');
    const urlError = searchParams.get('error');
    let tmpTeamProfile: TeamProfile = {id_team: -1, name: "", creation_date: new Date(), username: "", id_user: -1, members_count: 0, histories: [], members: []}

    const [teamProfile, setTeamProfile] = useState(tmpTeamProfile);
    const [isInvitOpen, setInvitOpen] = useState(false);
    const [isOwner, setIsOwner] = useState(false);
    const [error, setError] = useState<{error: string, once: boolean}>({error: "", once: true});
    const {user, setUser} = useUser();

    if (id === null && user.id_team === null) {
        if (error !== null)
            redirect("/team/create?error=" + error);
        else
            redirect("/team/create");
    }

    if (!error.once && urlError !== null)
        setError({error: urlError, once: true});
    id = parseInt(id as string, 10);

    const getTeam = async() => {
        let response = await fetch(`/api/team?id=${id}`);
        if (!response.ok) {
            redirect("/?error=" + (await response.json()).error);
        }
        tmpTeamProfile = {...(await response.json() as TeamInfo), histories: [], members: [] };
        if (tmpTeamProfile.members_count > 0) {
            response = await fetch(`/api/team?id=${id}&g=members`);
            if (!response.ok) {
                redirect("/?error="+ (await response.json()).error);
            }
            const result = await response.json() as {members: UserInfo[]};
            tmpTeamProfile.members = result.members;
        }
        response = await fetch(`/api/team?id=${id}&g=history`);
        if (!response.ok) {
            redirect("/?error="+ (await response.json()).error);
        }
        const result = await response.json() as {histories: History[]};
        tmpTeamProfile.histories = result.histories;
        tmpTeamProfile.creation_date = new Date(tmpTeamProfile.creation_date);
        if (tmpTeamProfile.histories.length > 0) {
            for (const history of tmpTeamProfile.histories) {
                history.creation_date = new Date(history.creation_date);
                history.start_visibility = new Date(history.start_visibility);
                history.open_registration = new Date(history.open_registration);
                history.start = new Date(history.start);
            }
        }
        setTeamProfile(tmpTeamProfile);
        if (user.is_admin || user.id_user == tmpTeamProfile.id_user)
            setIsOwner(true);
    }

    const kickUser = async(id_user: number) => {
        const response = await fetch("/api/team", {
            method: "POST",
            headers: {
                'Content-Type': 'application/json',
                'token': user.token,
            },
            body: JSON.stringify({command: "rm", user: id_user, id_team: user.id_team}),
        });
        if (response.headers.get('token') != null)
            setUser((prevState) => ({...prevState, token: response.headers.get('token')!}));
        if (!response.ok) {
            setError({error: (await response.json()).error,  once: true});
            await getTeam();
            return;
        }
        setError({error: "Le membre a été expulsé avec succès !", once: true});
        getTeam();
    }

    useEffect(() => {
        getTeam();
    }, [id]);

    return (
        <main className="team-page">
            <Modal text={error.error} onClose={() => setError({error: "", once: true})}></Modal>
            <AddMemberModal isOpen={isInvitOpen} setError={setError} onClose={() => {setInvitOpen(false); getTeam()}} id_team={user.id_team!}/>
            <div className="team-header">
                <div className="top-header">
                    <h1 className="team-name neon-title">{teamProfile.name}</h1>

                    {isOwner && (
                        <>
                            <button className="delete-button" title="Supprimer cette équipe">
                                <Trash2 size={18} />
                                Supprimer l’équipe
                            </button>
                            <button className="add-button" title="Ajouter un membre" onClick={() => {setInvitOpen(true)}}>
                                <MailPlus size={18} />
                                Ajouter un membre
                            </button>
                        </>
                    )}
                </div>

                <div className="team-meta">
                    <p>
                        <i>Créée le </i>
                        <span className="meta-data">{teamProfile.creation_date.toLocaleDateString()}</span>
                    </p>
                    <p>
                        <i>Détenue par </i>
                        <span className="meta-data">{teamProfile.username}</span>
                    </p>
                </div>
            </div>


            <div className="team-section">
                    <h2>Membres</h2>
                    <ul className="member-list">
                        {teamProfile.members.map((member: UserInfo, index: number) => (
                                <li key={index} className="member-item">
                                    <Link href={`/user?username=${member.username}`}><span>{member.username}</span></Link>
                                    {
                                        isOwner && member.id_user != user.id_user ?
                                        <button className="kick-button" title="Expulser" onClick={() => {kickUser(member.id_user)}}>
                                            <X size={16} />
                                        </button>
                                        :
                                            <></>
                                    }
                                </li>
                        ))}
                    </ul>
                </div>

                <div className="team-section">
                    <h2>Historique des tournois</h2>
                    {teamProfile.histories.length > 0 ? (
                        <ul className="match-list">
                            {teamProfile.histories.map((history: History, index: number) => (
                                <li key={index} className="match-item">
                                    <Link href={`/tournament?id=${history.id_tournament}`}>
                                    <span>{history.name}</span>
                                    <span>Début: {history.start.toLocaleDateString()}</span>
                                    {
                                        history.position == -1 ?
                                            <span>En cours</span>
                                            :
                                            <span>Top: {history.position}</span>
                                    }
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="empty-history">Aucun match enregistré.</p>
                    )}
                </div>
        </main>
    );
}