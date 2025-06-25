import {afterAll, describe, expect, test} from "@jest/globals";
import {NextRequest} from "next/server";
import {GET as GETUSER, POST as POSTUSER} from "../app/api/user/route";
import {GET as GETTEAM, POST as POSTTEAM} from "../app/api/team/route";
import {GET as GETTOUR, POST as POSTTOUR} from "../app/api/tournament/route";
import {
    id,
    status,
    TeamInfo,
    UserInfo,
    Tournament,
    Team,
    TeamTournament,
    TournamentMatch,
    History,
    getMatchs
} from "../lib/types";
import {Controller} from "../lib/controller";
import {owner} from "../app/api/team/owner";
import {sleep} from "../lib/sleep";

describe("api", () => {
    // User perfect Use
    const nameUserAPI = "JeSuisAPI";
    let idUserAPI: number = 0;

    // User bad User
    const badUser1API = "BadUser1API";
    const badUser2API = "BadUser2API";
    let badUser1APIID: number = 0;
    let badUser2APIID: number = 0;

    // Team perfect use
    const nameUserTeam = "TeamMembre";
    const nameUser2Team = "SecondMember";
    const adminTeam = "TeamAdmin";
    let idUserTeam: number = 0;
    let idUser2Team: number = 0;
    let idPerfectTeam: number = 0;

    // Team bad use
    const badUserTeam = "BadMembre";
    const badUser2Team = "Bad2Member";
    let badUserIDTeam: number = 0;
    let badUserID2Team: number = 0;
    let idBadTeam: number = 0;

    // Tournament perfect use
    const usersPT: string[] = ["APITournament1", "APITournament2", "APITournament3", "APITournament4"];
    let usersPTToken: string[] = [];
    let usersPTID: number[] = [];
    let teamsPTID: number[] = [];
    let PTID: number | undefined;

    // Tournament bad use
    const userBT1 = "BTuser1";
    const userBT2 = "BTuser2";
    let iduserBT1 = 0;
    let iduserBT2 = 0;
    let BTtoken1: string;
    let BTtoken2: string;
    let id_teamBT = 0
    let BTID: number | undefined;

    // Globals
    const passwordUserAPI = "PasswordAPI";
    test("User perfect use", async() => {
        // Test création d'utilisateur
        let request = new NextRequest('https://localhost/user/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({command: "new", username: nameUserAPI, password: passwordUserAPI}),
        });
        let response = await POSTUSER(request);
        expect(response.status).toEqual(200);
        const objID: id = await response.json() as id;
        expect(objID.id).not.toBeNull();
        idUserAPI = objID.id;
        let token: string | null = response.headers.get('token');
        expect(token).not.toBeNull();

        // Test récupération de l'utilisateur par ID
        request = new NextRequest(`https://localhost/user/?id=${idUserAPI}`);
        response = await GETUSER(request);
        expect(response.status).toEqual(200);
        let userInfo: UserInfo = await response.json() as UserInfo;
        expect(userInfo).toEqual({user_id: idUserAPI, username: nameUserAPI, id_team: null, is_admin: false});

        // Test récupération de l'utilisateur par Nom
        request = new NextRequest(`https://localhost/user/?username=${nameUserAPI}`);
        response = await GETUSER(request);
        expect(response.status).toEqual(200);
        const secondUserInfo: UserInfo = await response.json() as UserInfo;
        expect(secondUserInfo).toEqual(userInfo);

        // Test validité du token de la command new
        request = new NextRequest(`https://localhost/user/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': token!,
            },
            body: JSON.stringify({command: "auth_token"})
        });
        response = await POSTUSER(request);
        expect(response.status).toEqual(200);
        expect(response.headers.get('token')).not.toBeNull();
        expect(response.headers.get('token')!.length).toBeGreaterThan(0);
        expect(response.headers.get('token')).not.toEqual(token);
        token = response.headers.get('token')!;

        // Test validité du token de la command auth_token
        request = new NextRequest(`https://localhost/user/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': token,
            },
            body: JSON.stringify({command: "auth_token"})
        });
        response = await POSTUSER(request);
        expect(response.status).toEqual(200);
        expect(response.headers.get('token')).not.toBeNull();
        expect(response.headers.get('token')!.length).toBeGreaterThan(0);
        expect(response.headers.get('token')).not.toEqual(token);
        token = response.headers.get('token')!;

        // Test mot de passe par Nom (Le plus courant)
        request = new NextRequest(`https://localhost/user/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({command: "auth", user: nameUserAPI, password: passwordUserAPI})
        });
        response = await POSTUSER(request);
        expect(response.status).toEqual(200);
        expect(response.headers.get('token')).not.toBeNull();
        expect(response.headers.get('token')!.length).toBeGreaterThan(0);
        expect(response.headers.get('token')).not.toEqual(token);
        token = response.headers.get('token')!;

        // Test mot de passe par ID
        request = new NextRequest(`https://localhost/user/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({command: "auth", user: idUserAPI, password: passwordUserAPI})
        });
        response = await POSTUSER(request);
        expect(response.status).toEqual(200);
        expect(response.headers.get('token')).not.toBeNull();
        expect(response.headers.get('token')!.length).toBeGreaterThan(0);
        expect(response.headers.get('token')).not.toEqual(token);
        token = response.headers.get('token')!;

        // Test update password
        request = new NextRequest(`https://localhost/user/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': token,
            },
            body: JSON.stringify({command: "update_password", old_password: passwordUserAPI, new_password: nameUserAPI})
        });
        response = await POSTUSER(request);
        expect(response.status).toEqual(200);
        expect(response.headers.get('token')).not.toBeNull();
        expect(response.headers.get('token')!.length).toBeGreaterThan(0);
        expect(response.headers.get('token')).not.toEqual(token);
        token = response.headers.get('token')!;

        // Test new mot de passe par ID
        request = new NextRequest(`https://localhost/user/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({command: "auth", user: idUserAPI, password: nameUserAPI})
        });
        response = await POSTUSER(request);
        expect(response.status).toEqual(200);
        expect(response.headers.get('token')).not.toBeNull();
        expect(response.headers.get('token')!.length).toBeGreaterThan(0);
        expect(response.headers.get('token')).not.toEqual(token);
        token = response.headers.get('token')!;

        // Reset mot de passe
        request = new NextRequest(`https://localhost/user/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': token,
            },
            body: JSON.stringify({command: "update_password", old_password: nameUserAPI, new_password: passwordUserAPI})
        });
        response = await POSTUSER(request);
        expect(response.status).toEqual(200);
        expect(response.headers.get('token')).not.toBeNull();
        expect(response.headers.get('token')!.length).toBeGreaterThan(0);
        expect(response.headers.get('token')).not.toEqual(token);
        token = response.headers.get('token')!;

        // Test updateUsername
        request = new NextRequest(`https://localhost/user/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': token,
            },
            body: JSON.stringify({command: "update_username", new_username: passwordUserAPI})
        });
        response = await POSTUSER(request);
        expect(response.status).toEqual(200);
        expect(response.headers.get('token')).not.toBeNull();
        expect(response.headers.get('token')!.length).toBeGreaterThan(0);
        expect(response.headers.get('token')).not.toEqual(token);
        token = response.headers.get('token')!;

        // Verify update
        request = new NextRequest(`https://localhost/user/?id=${idUserAPI}`);
        response = await GETUSER(request);
        expect(response.status).toEqual(200);
        userInfo = await response.json() as UserInfo;
        expect(userInfo).toEqual({user_id: idUserAPI, username: passwordUserAPI, id_team: null, is_admin: false});

        // Reset update
        request = new NextRequest(`https://localhost/user/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': token,
            },
            body: JSON.stringify({command: "update_username", new_username: nameUserAPI})
        });
        response = await POSTUSER(request);
        expect(response.status).toEqual(200);
        expect(response.headers.get('token')).not.toBeNull();
        expect(response.headers.get('token')!.length).toBeGreaterThan(0);
        expect(response.headers.get('token')).not.toEqual(token);
        token = response.headers.get('token')!;

        // Test delete
        request = new NextRequest(`https://localhost/user/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': token,
            },
            body: JSON.stringify({command: "delete", user_id: userInfo.user_id})
        });
        response = await POSTUSER(request);
        expect(response.status).toEqual(200);
        expect(response.headers.get('token')).not.toBeNull();
        expect(response.headers.get('token')!.length).toBeGreaterThan(0);
        expect(response.headers.get('token')).not.toEqual(token);
    });
    test("User bad use", async() => {
        // New user without password
        let request = new NextRequest('https://localhost/user/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({command: "new", username: badUser1API}),
        });
        let response = await POSTUSER(request);
        expect(response.status).toEqual(400);
        let error = await response.json() as {error: string};
        expect(error.error).toEqual("'username' and 'password' is requested!");

        // New user without username
        request = new NextRequest('https://localhost/user/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({command: "new", password: badUser1API}),
        });
        response = await POSTUSER(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("'username' and 'password' is requested!");

        // New user without command
        request = new NextRequest('https://localhost/user/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({username: badUser1API, password: badUser1API}),
        });
        response = await POSTUSER(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("'command' is required!");

        // Création test user1
        request = new NextRequest('https://localhost/user/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({command: "new", username: badUser1API, password: badUser1API})
        });
        response = await POSTUSER(request);
        expect(response.status).toEqual(200);
        let objID = await response.json() as id;
        expect(objID.id).not.toBeNull();
        badUser1APIID = objID.id;
        let token1: string | null = response.headers.get('token');
        expect(token1).not.toBeNull();

        // Test récupération de l'utilisateur sans rien
        request = new NextRequest(`https://localhost/user/`);
        response = await GETUSER(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("Need `id` OR `username` to fetch an user!")

        // Test récupération de l'utilisateur avec id et username
        request = new NextRequest(`https://localhost/user/?username=${badUser1API}&id=${badUser1APIID}`);
        response = await GETUSER(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("'id' and 'username' cannot be send together to get an user!")

        // Test récupération avec 'g' éroné
        request = new NextRequest(`https://localhost/user/?username=${badUser1API}&g=prout}`);
        response = await GETUSER(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("If you want to fetch history 'g' must equal 'history'!")

        // Test récupération history avec username et history
        request = new NextRequest(`https://localhost/user/?username=${badUser1API}&g=history`);
        response = await GETUSER(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("'id' is required to fetch the history !")

        // Test auth sans token
        request = new NextRequest(`https://localhost/user/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({command: "auth_token"})
        });
        response = await POSTUSER(request);
        expect(response.status).toEqual(401);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("Non authorized!")

        // Test mot de passe par Nom sans mot de passe
        request = new NextRequest(`https://localhost/user/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({command: "auth", user: badUser1API})
        });
        response = await POSTUSER(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("'user' and 'password' are required!")

        // Test mot de passe sans user
        request = new NextRequest(`https://localhost/user/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({command: "auth", password: badUser1API})
        });
        response = await POSTUSER(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("'user' and 'password' are required!")

        // Test mot de passe avec uniquement command
        request = new NextRequest(`https://localhost/user/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({command: "auth"})
        });
        response = await POSTUSER(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("'user' and 'password' are required!");

        // Test mot de passe avec mauvais mot de passe
        request = new NextRequest(`https://localhost/user/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({command: "auth", user: badUser1API, password: "MauvaisMotDePasse"})
        });
        response = await POSTUSER(request);
        expect(response.status).toEqual(401);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("Wrong password or username");

        // Test mot de passe avec mauvais nom
        request = new NextRequest(`https://localhost/user/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({command: "auth", user: "mauvaisNom", password: badUser1API})
        });
        response = await POSTUSER(request);
        expect(response.status).toEqual(401);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("Wrong password or username");

        // Test mot de passe avec mauvais id
        request = new NextRequest(`https://localhost/user/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({command: "auth", user: -1, password: "MauvaisMotDePasse"})
        });
        response = await POSTUSER(request);
        expect(response.status).toEqual(401);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("Wrong password or username");

        // Test update password sans token
        request = new NextRequest(`https://localhost/user/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({command: "update_password", old_password: passwordUserAPI, new_password: badUser1API})
        });
        response = await POSTUSER(request);
        expect(response.status).toEqual(401);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("Non authorized!");

        // Test update password sans old_password
        request = new NextRequest(`https://localhost/user/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': token1!,
            },
            body: JSON.stringify({command: "update_password", new_password: badUser1API})
        });
        response = await POSTUSER(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("'old_password' and 'new_password' are required!");
        token1 = response.headers.get('token');
        expect(token1).not.toBeNull();

        // Test update password sans new_password
        request = new NextRequest(`https://localhost/user/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': token1!,
            },
            body: JSON.stringify({command: "update_password", old_password: badUser1API})
        });
        response = await POSTUSER(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("'old_password' and 'new_password' are required!");
        token1 = response.headers.get('token');
        expect(token1).not.toBeNull();

        // Test update password avec seulement commande
        request = new NextRequest(`https://localhost/user/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': token1!,
            },
            body: JSON.stringify({command: "update_password"})
        });
        response = await POSTUSER(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("'old_password' and 'new_password' are required!");
        token1 = response.headers.get('token');
        expect(token1).not.toBeNull();

        // Test update password avec mauvais mot de passe
        request = new NextRequest(`https://localhost/user/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': token1!,
            },
            body: JSON.stringify({command: "update_password", old_password: passwordUserAPI, new_password: badUser1API})
        });
        response = await POSTUSER(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("Old password is wrong");
        token1 = response.headers.get('token');
        expect(token1).not.toBeNull();

        // Test updateUsername sans token
        request = new NextRequest(`https://localhost/user/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({command: "update_username"})
        });
        response = await POSTUSER(request);
        expect(response.status).toEqual(401);
        error = await response.json() as {error: string};
        expect(error.error).toEqual('Non authorized!')

        // Test updateUsername sans new_username
        request = new NextRequest(`https://localhost/user/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': token1!,
            },
            body: JSON.stringify({command: "update_username"})
        });
        response = await POSTUSER(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("'new_username' is required!");
        token1 = response.headers.get('token');
        expect(token1).not.toBeNull();

        // Test delete sans user_id
        request = new NextRequest(`https://localhost/user/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': token1!,
            },
            body: JSON.stringify({command: "delete"})
        });
        response = await POSTUSER(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("'user_id' is required!");
        token1 = response.headers.get('token');
        expect(token1).not.toBeNull();

        // Test delete sans token
        request = new NextRequest(`https://localhost/user/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({command: "delete", user_id: badUser1API})
        });
        response = await POSTUSER(request);
        expect(response.status).toEqual(401);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("Non authorized!");

        // Création test User2
        request = new NextRequest('https://localhost/user/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({command: "new", username: badUser2API, password: badUser2API})
        });
        response = await POSTUSER(request);
        expect(response.status).toEqual(200);
        objID = await response.json() as id;
        expect(objID.id).not.toBeNull();
        badUser2APIID = objID.id;
        let token2: string | null = response.headers.get('token');
        expect(token1).not.toBeNull();

        // Test delete user1 avec token of user2
        request = new NextRequest(`https://localhost/user/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': token2!,
            },
            body: JSON.stringify({command: "delete", user_id: badUser2API})
        });
        response = await POSTUSER(request);
        expect(response.status).toEqual(403);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("Only admin can delete users!");
    });
    test("Team perfect use", async() => {
        // Création test user
        let request = new NextRequest('https://localhost/user/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({command: "new", username: nameUserTeam, password : passwordUserAPI})
        });
        let response = await POSTUSER(request);
        expect(response.status).toEqual(200);
        let objID: id = await response.json() as id;
        expect(objID.id).not.toBeNull();
        idUserTeam = objID.id;
        let token: string | null = response.headers.get('token');
        expect(token).not.toBeNull();

        // Création Test user 2
        request = new NextRequest('https://localhost/user/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({command: "new", username: nameUser2Team, password: passwordUserAPI})
        });
        response = await POSTUSER(request);
        expect(response.status).toEqual(200);
        objID = await response.json() as id;
        expect(objID.id).not.toBeNull();
        idUser2Team = objID.id;
        let token2: string | null = response.headers.get('token');
        expect(token2).not.toBeNull();

        // Test création de team
        request = new NextRequest('https://localhost/team/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': token!,
            },
            body: JSON.stringify({command: "create", name: nameUserTeam})
        });
        response = await POSTTEAM(request);
        expect(response.status).toEqual(200);
        objID = await response.json() as id;
        expect(objID.id).not.toBeNull();
        idPerfectTeam = objID.id;
        expect(response.headers.get('token')).not.toEqual(token);
        token = response.headers.get('token');
        expect(token).not.toBeNull();

        // Test get par ID
        request = new NextRequest(`https://localhost/team/?id=${idPerfectTeam}`);
        response = await GETTEAM(request);
        expect(response.status).toEqual(200);
        let teamInfo: TeamInfo = await response.json() as TeamInfo;
        teamInfo.creation_date = new Date(teamInfo.creation_date);
        expect(teamInfo.name).toEqual(nameUserTeam);
        expect((new Date()).getTime() - teamInfo.creation_date.getTime()).toBeLessThan(2000);
        expect(teamInfo.owner_name).toEqual(nameUserTeam);
        expect(teamInfo.id_owner).toEqual(idUserTeam);
        expect(teamInfo.members_count).toEqual(1);

        // Test get par Nom
        request = new NextRequest(`https://localhost/team/?name=${nameUserTeam}`);
        response = await GETTEAM(request);
        expect(response.status).toEqual(200);
        let secondTeamInfo : TeamInfo = await response.json() as TeamInfo;
        secondTeamInfo.creation_date = new Date(secondTeamInfo.creation_date);
        expect(secondTeamInfo).toEqual(teamInfo);

        // Test get members

        //      Get owner
        request = new NextRequest(`https://localhost/user/?id=${idUserTeam}`);
        response = await GETUSER(request);
        expect(response.status).toEqual(200);
        let user: UserInfo = await response.json() as UserInfo;
        //      Test get members
        request = new NextRequest(`https://localhost/team/?name=${nameUserTeam}&g=members`);
        response = await GETTEAM(request);
        expect(response.status).toEqual(200);
        let members: UserInfo[] = ((await response.json() as {members: UserInfo[]}).members);
        expect(members.length).toEqual(1);
        expect({...members[0], is_admin: false}).toEqual(user);

        // Test get history
        request = new NextRequest(`https://localhost/team/?id=${idPerfectTeam}&g=history`);
        response = await GETTEAM(request);
        expect(response.status).toEqual(200);
        let histories: History[] = (await response.json() as {histories: History[]}).histories;
        expect(histories.length).toEqual(0);

        // Test rename
        request = new NextRequest(`https://localhost/team/`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'token': token!,
                },
                body: JSON.stringify({command: "rename", id_team: idPerfectTeam, new_name: nameUser2Team})
            });
        response = await POSTTEAM(request);
        expect(response.status).toEqual(200);
        token = response.headers.get('token');
        expect(token).not.toBeNull();

        // Test GET vérification changement
        request = new NextRequest(`https://localhost/team/?id=${idPerfectTeam}`);
        response = await GETTEAM(request);
        expect(response.status).toEqual(200);
        secondTeamInfo = await response.json() as TeamInfo;
        expect(secondTeamInfo).toEqual({...secondTeamInfo, name: nameUser2Team});

        // reset
        request = new NextRequest(`https://localhost/team/`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'token': token!,
                },
                body: JSON.stringify({command: "rename", id_team: idPerfectTeam, new_name: nameUserTeam})
            });
        response = await POSTTEAM(request);
        expect(response.status).toEqual(200);
        token = response.headers.get('token');
        expect(token).not.toBeNull();

        // Test add Member
        request = new NextRequest(`https://localhost/team/`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'token': token!,
                },
                body: JSON.stringify({command: "add", id_team: idPerfectTeam, id_user: idUser2Team})
            });
        response = await POSTTEAM(request);
        expect(response.status).toEqual(200);
        token = response.headers.get('token');
        expect(token).not.toBeNull();

        // Vérification
        request = new NextRequest(`https://localhost/team/?name=${nameUserTeam}&g=members`);
        response = await GETTEAM(request);
        expect(response.status).toEqual(200);
        members = (await response.json() as {members: UserInfo[]}).members;
        expect(members.length).toEqual(2);
        expect(members[0].username).not.toEqual(members[1].username);
        expect([nameUserTeam, nameUser2Team]).toContain(members[0].username);
        expect([nameUserTeam, nameUser2Team]).toContain(members[1].username);

        // Test switch owner
        request = new NextRequest(`https://localhost/team/`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'token': token!,
                },
                body: JSON.stringify({command: "owner", owner: nameUserTeam, new_owner: nameUser2Team})
            });
        response = await POSTTEAM(request);
        expect(response.status).toEqual(200);
        token = response.headers.get('token');
        expect(token).not.toBeNull();

        // Vérification new owner
        request = new NextRequest(`https://localhost/team/?name=${nameUserTeam}`);
        response = await GETTEAM(request);
        expect(response.status).toEqual(200);
        secondTeamInfo = await response.json() as TeamInfo;
        expect(secondTeamInfo.owner_name).toEqual(nameUser2Team);
        expect(secondTeamInfo.id_owner).toEqual(idUser2Team);

        // Reset by ID
        request = new NextRequest(`https://localhost/team/`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'token': token2!,
                },
                body: JSON.stringify({command: "owner", owner: idUser2Team, new_owner: idUserTeam})
            });
        response = await POSTTEAM(request);
        expect(response.status).toEqual(200);
        token2 = response.headers.get('token');
        expect(token2).not.toBeNull();

        // Vérification new owner
        request = new NextRequest(`https://localhost/team/?name=${nameUserTeam}`);
        response = await GETTEAM(request);
        expect(response.status).toEqual(200);
        secondTeamInfo = await response.json() as TeamInfo;
        expect(secondTeamInfo.owner_name).toEqual(nameUserTeam);
        expect(secondTeamInfo.id_owner).toEqual(idUserTeam);

        // Test rm Member
        request = new NextRequest(`https://localhost/team/`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'token': token!,
                },
                body: JSON.stringify({command: "rm", id_team: idPerfectTeam, id_user: idUser2Team})
            });
        response = await POSTTEAM(request);
        expect(response.status).toEqual(200);
        token = response.headers.get('token');
        expect(token).not.toBeNull();

        // Vérification rm Member
        request = new NextRequest(`https://localhost/team/?name=${nameUserTeam}&g=members`);
        response = await GETTEAM(request);
        expect(response.status).toEqual(200);
        members = (await response.json() as {members: UserInfo[]}).members;
        expect(members.length).toEqual(1);
        expect({...members[0], is_admin: false}).toEqual(user);

        // Test erase Team
        request = new NextRequest(`https://localhost/team/`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'token': token!,
                },
                body: JSON.stringify({command: "erase", id_team: idPerfectTeam})
            });
        response = await POSTTEAM(request);
        expect(response.status).toEqual(200);
        token = response.headers.get('token');
        expect(token).not.toBeNull();

        // Vérification
        request = new NextRequest(`https://localhost/team/?id=${idPerfectTeam}`);
        response = await GETTEAM(request);
        expect(response.status).toEqual(200);
        secondTeamInfo = await response.json() as TeamInfo;
        expect(secondTeamInfo.name).toEqual(nameUserTeam);
        expect(new Date(secondTeamInfo.creation_date)).toEqual(teamInfo.creation_date);
        expect(secondTeamInfo.owner_name).toEqual(null);
        expect(secondTeamInfo.id_owner).toEqual(null);
        expect(secondTeamInfo.members_count).toEqual(0);

        // Test destruct team

        //      Création admin
        const database = Controller.getInstance();
        await database.deleteUser(adminTeam);
        const setUser: status & id &{token: string} = await database.newUser(adminTeam, "admin1234", true);
        expect(setUser.success).toBeTruthy();
        //      Destruct team
        request = new NextRequest(`https://localhost/team/`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'token': setUser.token,
                },
                body: JSON.stringify({command: "destruct", id_team: idPerfectTeam})
            });
        response = await POSTTEAM(request);
        expect(response.status).toEqual(200);
        token = response.headers.get('token');
        expect(token).not.toBeNull();
        // Vérification
        request = new NextRequest(`https://localhost/team/?id=${idPerfectTeam}`);
        response = await GETTEAM(request);
        expect(response.status).toEqual(400);
        const error = await response.json() as {error: string};
        expect(error.error).toEqual("This team does not exist!");
    });
    test("Team bad use", async() => {
        // Création test user
        let request = new NextRequest('https://localhost/user/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({command: "new", username: badUserTeam, password : passwordUserAPI})
        });
        let response = await POSTUSER(request);
        expect(response.status).toEqual(200);
        let objID: id = await response.json() as id;
        expect(objID.id).not.toBeNull();
        badUserIDTeam = objID.id;
        let token: string | null = response.headers.get('token');
        expect(token).not.toBeNull();

        // Création Test user 2
        request = new NextRequest('https://localhost/user/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({command: "new", username: badUser2Team, password: passwordUserAPI})
        });
        response = await POSTUSER(request);
        expect(response.status).toEqual(200);
        objID = await response.json() as id;
        expect(objID.id).not.toBeNull();
        badUserID2Team = objID.id;
        let token2: string | null = response.headers.get('token');
        expect(token2).not.toBeNull();

        // Test création de team sans token
        request = new NextRequest('https://localhost/team/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({command: "create", name: nameUserTeam})
        });
        response = await POSTTEAM(request);
        expect(response.status).toEqual(401);
        let error: {error: string} = await response.json() as {error: string};
        expect(error.error).toEqual("Non authorized!");

        // Test création de team sans nom
        request = new NextRequest('https://localhost/team/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': token!,
            },
            body: JSON.stringify({command: "create"})
        });
        response = await POSTTEAM(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("'name' is required!");
        token = response.headers.get('token');
        expect(token).not.toBeNull();

        // Création de team test
        request = new NextRequest('https://localhost/team/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': token!,
            },
            body: JSON.stringify({command: "create", name: nameUserTeam})
        });
        response = await POSTTEAM(request);
        expect(response.status).toEqual(200);
        objID = await response.json() as id;
        expect(objID.id).not.toBeNull();
        idBadTeam = objID.id;
        expect(response.headers.get('token')).not.toEqual(token);
        token = response.headers.get('token');
        expect(token).not.toBeNull();

        // Test GET sans rien
        request = new NextRequest(`https://localhost/team/`);
        response = await GETTEAM(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("Need 'id' (X)OR 'name' to fetch a team!");

        // Test GET avec nom et ID
        request = new NextRequest(`https://localhost/team/?id=${idBadTeam}&name=${badUserTeam}`);
        response = await GETTEAM(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("Need 'id' (X)OR 'name' to fetch a team!");

        // Test GET avec ID éroné
        request = new NextRequest(`https://localhost/team/?id=-1`);
        response = await GETTEAM(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("This team does not exist!");

        // Test GET avec name éroné
        request = new NextRequest(`https://localhost/team/?name=prout`);
        response = await GETTEAM(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("This team does not exist!");

        // Test GET members avec ID éroné
        request = new NextRequest(`https://localhost/team/?id=-1&g=members`);
        response = await GETTEAM(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("This team does not exist or is deleted!");

        // Test GET members avec name éroné
        request = new NextRequest(`https://localhost/team/?name=prout&g=members`);
        response = await GETTEAM(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("This team does not exist or is deleted!");

        // Test GET avec g éroné
        request = new NextRequest(`https://localhost/team/?name=${badUserTeam}&g=proiut`);
        response = await GETTEAM(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("'g' must equal 'history' or 'members'");

        // Test GET history avec ID éroné
        request = new NextRequest(`https://localhost/team/?id=-1&g=history`);
        response = await GETTEAM(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("Team does not exist!");

        // Test GET history avec name éroné
        request = new NextRequest(`https://localhost/team/?name=prout&g=history`);
        response = await GETTEAM(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("Team does not exist!");

        // Test rename sans new_name
        request = new NextRequest(`https://localhost/team/`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'token': token!,
                },
                body: JSON.stringify({command: "rename", id_team: idBadTeam})
            });
        response = await POSTTEAM(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("'id_team' and 'new_name' are required!");
        token = response.headers.get('token');
        expect(token).not.toBeNull();

        // Test rename sans id_team
        request = new NextRequest(`https://localhost/team/`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'token': token!,
                },
                body: JSON.stringify({command: "rename", new_name: badUser2Team})
            });
        response = await POSTTEAM(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("'id_team' and 'new_name' are required!");
        token = response.headers.get('token');
        expect(token).not.toBeNull();

        // Test rename sans id_team et new_name
        request = new NextRequest(`https://localhost/team/`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'token': token!,
                },
                body: JSON.stringify({command: "rename"})
            });
        response = await POSTTEAM(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("'id_team' and 'new_name' are required!");
        token = response.headers.get('token');
        expect(token).not.toBeNull();

        // Test rename sans token
        request = new NextRequest(`https://localhost/team/`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({command: "rename", id_team: idBadTeam, new_name: badUser2Team})
            });
        response = await POSTTEAM(request);
        expect(response.status).toEqual(401);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("Non authorized!");

        // Test add member sans id_user
        request = new NextRequest(`https://localhost/team/`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'token': token!,
                },
                body: JSON.stringify({command: "add", id_team: idBadTeam})
            });
        response = await POSTTEAM(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("'id_user' and 'id_team' are required!");
        token = response.headers.get('token');
        expect(token).not.toBeNull();

        // Test add member sans id_team
        request = new NextRequest(`https://localhost/team/`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'token': token!,
                },
                body: JSON.stringify({command: "add", id_user: badUserID2Team})
            });
        response = await POSTTEAM(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("'id_user' and 'id_team' are required!");
        token = response.headers.get('token');
        expect(token).not.toBeNull();

        // Test add member sans id_team et id_user
        request = new NextRequest(`https://localhost/team/`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'token': token!,
                },
                body: JSON.stringify({command: "add"})
            });
        response = await POSTTEAM(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("'id_user' and 'id_team' are required!");
        token = response.headers.get('token');
        expect(token).not.toBeNull();

        // Ajout test member
        request = new NextRequest(`https://localhost/team/`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'token': token!,
                },
                body: JSON.stringify({command: "add", id_team: idBadTeam, id_user: badUserID2Team})
            });
        response = await POSTTEAM(request);
        expect(response.status).toEqual(200);
        token = response.headers.get('token');
        expect(token).not.toBeNull();

        // Test rm member sans id_user
        request = new NextRequest(`https://localhost/team/`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'token': token!,
                },
                body: JSON.stringify({command: "rm", id_team: idBadTeam})
            });
        response = await POSTTEAM(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("'id_user' and 'id_team' are required!");
        token = response.headers.get('token');
        expect(token).not.toBeNull();

        // Test rm member sans id_team
        request = new NextRequest(`https://localhost/team/`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'token': token!,
                },
                body: JSON.stringify({command: "rm", id_user: badUserID2Team})
            });
        response = await POSTTEAM(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("'id_user' and 'id_team' are required!");
        token = response.headers.get('token');
        expect(token).not.toBeNull();

        // Test rm member sans id_team et id_user
        request = new NextRequest(`https://localhost/team/`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'token': token!,
                },
                body: JSON.stringify({command: "rm"})
            });
        response = await POSTTEAM(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("'id_user' and 'id_team' are required!");
        token = response.headers.get('token');
        expect(token).not.toBeNull();

        // Test erase Team sans id_team
        request = new NextRequest(`https://localhost/team/`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'token': token!,
                },
                body: JSON.stringify({command: "erase"})
            });
        response = await POSTTEAM(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("'id_team' is required!");
        token = response.headers.get('token');
        expect(token).not.toBeNull();

        // Test erase Team sans token
        request = new NextRequest(`https://localhost/team/`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({command: "erase", id_team: idBadTeam})
            });
        response = await POSTTEAM(request);
        expect(response.status).toEqual(401);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("Non authorized!");

        // Test destruct Team sans être admin
        request = new NextRequest(`https://localhost/team/`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'token': token!,
                },
                body: JSON.stringify({command: "destruct", id_team: idBadTeam})
            });
        response = await POSTTEAM(request);
        expect(response.status).toEqual(403);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("Only admin can totally delete a team!");
    });
    test("Tournament perfect use", async() => {
        // Création test users et tests teams
        for (let i = 0; i < usersPT.length; i += 1) {
            let request = new NextRequest('https://localhost/user/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({command: "new", username: usersPT[i], password : usersPT[i]})
            });
            let response = await POSTUSER(request);
            expect(response.status).toEqual(200);
            let objID: id = await response.json() as id;
            expect(objID.id).not.toBeNull();
            let token = response.headers.get('token');
            expect(token).not.toBeNull();
            usersPTToken.push(token!);
            usersPTID.push(objID.id);
            request = new NextRequest(`https://localhost/team/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'token': usersPTToken[i]
                },
                body: JSON.stringify({command: "create", name: usersPT[i]})
            });
            response = await POSTTEAM(request);
            expect(response.status).toEqual(200);
            token = response.headers.get('token');
            expect(token).not.toBeNull();
            usersPTToken[i] = token!;
            objID = await response.json() as id;
            teamsPTID.push(objID.id);
        }

        // Création tournois
        let start_visibility = new Date();
        start_visibility.setDate(start_visibility.getDate() + 1);
        let open_registration = new Date(start_visibility);
        open_registration.setDate(open_registration.getDate() + 1);
        let close_registration = new Date(open_registration);
        close_registration.setDate(close_registration.getDate() + 2);
        let start = new Date(close_registration);
        let request = new NextRequest(`https://localhost/tournament/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': usersPTToken[0]
            },
            body: JSON.stringify({command: "create", name: "Mon Tournoi", description: "Ceci est vraiment un super tournoi", format: 'SIMPLE', size: 8, start_visibility: start_visibility, open_registration: open_registration, close_registration: close_registration, start: start})
        });
        let response = await POSTTOUR(request);
        expect(response.status).toEqual(200);
        let token: string | null = response.headers.get('token');
        expect(token).not.toBeNull();
        usersPTToken[0] = token!;
        const id: id = await response.json() as id;
        expect(id.id).not.toBeNull();
        PTID = id.id!;

        // Test edit
        start_visibility = new Date();
        start_visibility.setMilliseconds(0);
        open_registration = new Date(start_visibility);
        close_registration = new Date(open_registration);
        close_registration.setSeconds(close_registration.getSeconds() + 1);
        start = new Date(close_registration);
        request = new NextRequest(`https://localhost/tournament/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': usersPTToken[0]
            },
            body: JSON.stringify({command: "edit", id_tournament: PTID, name: "Mon Tournoi édité", description: "Ceci est une édition", format: 'SIMPLE', size: 4, start_visibility: start_visibility, open_registration: open_registration, close_registration: close_registration, start: start})
        });
        response = await POSTTOUR(request);
        expect(response.status).toEqual(200);
        token = response.headers.get('token');
        expect(token).not.toBeNull();
        usersPTToken[0] = token!;

        // Test Get
        request = new NextRequest(`https://localhost/tournament/?id=${PTID}`);
        response = await GETTOUR(request);
        expect(response.status).toEqual(200);
        const tournament: Tournament = await response.json() as Tournament;
        expect(tournament).toEqual({...tournament, name: "Mon Tournoi édité", description: "Ceci est une édition", format: 'SIMPLE', size: 4, start_visibility: start_visibility.toISOString(), open_registration: open_registration.toISOString(), close_registration: close_registration.toISOString(), start: start.toISOString()});

        // Test Get Teams à vide
        request = new NextRequest(`https://localhost/tournament/?id=${PTID}&g=teams`);
        response = await GETTOUR(request);
        expect(response.status).toEqual(200);
        let teamsRegistration: (Team & TeamTournament)[] = (await response.json() as {teams: (Team & TeamTournament)[]}).teams;
        expect(teamsRegistration.length).toEqual(0);

        // Test Get matchs à vide
        request = new NextRequest(`https://localhost/tournament/?id=${PTID}&g=matchs`);
        response = await GETTOUR(request);
        expect(response.status).toEqual(200);
        let matchs: TournamentMatch[] = (await response.json() as {matchs: TournamentMatch[]}).matchs;
        expect(matchs.length).toEqual(0);

        // Test registration
        for (let i = 0; i < usersPTID.length; i++) {
            request = new NextRequest(`https://localhost/tournament/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'token': usersPTToken[i],
                },
                body: JSON.stringify({command: "register", id_tournament: PTID})
            });
            response = await POSTTOUR(request);
            expect(response.status).toEqual(200);
            token = response.headers.get('token');
            expect(token).not.toBeNull();
            usersPTToken[i] = token!;
        }

        // Test GET teams
        request = new NextRequest(`https://localhost/tournament/?id=${PTID}&g=teams`);
        response = await GETTOUR(request);
        expect(response.status).toEqual(200);
        teamsRegistration = (await response.json() as {teams: (Team & TeamTournament)[]}).teams;
        expect(teamsRegistration.length).toEqual(usersPTID.length);
        for (let i = 0; i < teamsRegistration.length; i++) {
            expect(teamsPTID).toContain(teamsRegistration[i].id_team);
            expect(teamsRegistration[i].team_id).not.toBeUndefined();
            expect(teamsRegistration[i].team_tournament_id).not.toBeUndefined();
            expect(teamsRegistration[i].id_tournament).not.toBeUndefined();
            expect(teamsRegistration[i].id_owner).not.toBeUndefined();
            expect(teamsRegistration[i].name).not.toBeUndefined();
            expect(teamsRegistration[i].position).not.toBeUndefined();
            expect(teamsRegistration[i].creation_date).not.toBeUndefined();
            if (i > 0)
                expect(teamsRegistration[i]).not.toEqual(teamsRegistration[i - 1]);
        }

        // Test unregistration
        for (let i = 0; i < usersPTID.length; i++) {
            request = new NextRequest(`https://localhost/team/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'token': usersPTToken[i],
                },
                body: JSON.stringify({command: "unregister", id_tournament: PTID})
            });
            response = await POSTTOUR(request);
            token = response.headers.get('token');
            expect(token).not.toBeNull();
            usersPTToken[i] = token!;
        }

        // Test GET teams après unregistration
        request = new NextRequest(`https://localhost/tournament/?id=${PTID}&g=teams`);
        response = await GETTOUR(request);
        expect(response.status).toEqual(200);
        teamsRegistration = (await response.json() as {teams: (Team & TeamTournament)[]}).teams;
        expect(teamsRegistration.length).toEqual(0);

        // Reset registration
        for (let i = 0; i < usersPTID.length; i++) {
            request = new NextRequest(`https://localhost/team/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'token': usersPTToken[i],
                },
                body: JSON.stringify({command: "register", id_tournament: PTID})
            });
            response = await POSTTOUR(request);
            expect(response.status).toEqual(200);
            token = response.headers.get('token');
            expect(token).not.toBeNull();
            usersPTToken[i] = token!;
        }

        // Vérification historique registration par team
        for (let i = 0; i < usersPTID.length; i++) {
            request = new NextRequest(`https://localhost/team/?id=${teamsPTID[i]}&g=history`);
            response = await GETTEAM(request);
            const registration: History[] = (await response.json() as {histories: History[]}).histories;
            expect(registration.length).toEqual(1);
            expect(registration[0].tournament_id).toEqual(PTID);
        }

        // Simulation de lancement pour getMatchs
        //      Attente de la fin des inscriptions
        await sleep(3000);

        //      Lancement tournoi
        const database = Controller.getInstance();
        const status: getMatchs = await database.setupTournament(PTID);
        expect(status.success).toBeTruthy();

        // Test Get matchs
        request = new NextRequest(`https://localhost/tournament/?id=${PTID}&g=matchs`);
        response = await GETTOUR(request);
        expect(response.status).toEqual(200);
        matchs = (await response.json() as {matchs: TournamentMatch[]}).matchs;
        expect(matchs.length).toEqual(2);
        for (const match of matchs) {
            expect(match.id_tournament).toEqual(PTID);
            expect(match.score_host).toEqual(0);
            expect(match.score_guest).toEqual(0);
        }

        // Test erase
        request = new NextRequest(`https://localhost/tournament/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': usersPTToken[0],
            },
            body: JSON.stringify({command: "erase", id_tournament: PTID})
        });
        response = await POSTTOUR(request);
        expect(response.status).toEqual(200);
        token = response.headers.get('token');
        expect(token).not.toBeNull();
        usersPTToken[0] = token!;
    });
    test("Tournament bad use", async() => {
        // Création test users et tests teams
        let request = new NextRequest('https://localhost/user/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({command: "new", username: userBT1, password : passwordUserAPI})
        });
        let response = await POSTUSER(request);
        expect(response.status).toEqual(200);
        let objID: id = await response.json() as id;
        expect(objID.id).not.toBeNull();
        iduserBT1 = objID.id;
        let tmp_token = response.headers.get('token');
        expect(tmp_token).not.toBeNull();
        BTtoken1 = tmp_token!;

        request = new NextRequest('https://localhost/user/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({command: "new", username: userBT2, password : passwordUserAPI})
        });
        response = await POSTUSER(request);
        expect(response.status).toEqual(200);
        objID = await response.json() as id;
        expect(objID.id).not.toBeNull();
        iduserBT2 = objID.id;
        tmp_token = response.headers.get('token');
        expect(tmp_token).not.toBeNull();
        BTtoken2 = tmp_token!;

        request = new NextRequest(`https://localhost/team/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': BTtoken1,
            },
            body: JSON.stringify({command: "create", name: userBT1})
        });
        response = await POSTTEAM(request);
        expect(response.status).toEqual(200);
        tmp_token = response.headers.get('token');
        expect(tmp_token).not.toBeNull();
        BTtoken1 = tmp_token!;
        objID = await response.json() as id;
        id_teamBT = objID.id;

        // Création tournois sans token
        let start_visibility = new Date();
        start_visibility.setDate(start_visibility.getDate() + 1);
        let open_registration = new Date(start_visibility);
        open_registration.setDate(open_registration.getDate() + 1);
        let close_registration = new Date(open_registration);
        close_registration.setDate(close_registration.getDate() + 2);
        let start = new Date(close_registration);
        request = new NextRequest(`https://localhost/tournament/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({command: "create", name: "Mon Tournoi", description: "Ceci est vraiment un super tournoi", format: 'SIMPLE', size: 8, start_visibility: start_visibility, open_registration: open_registration, close_registration: close_registration, start: start})
        });
        response = await POSTTOUR(request);
        expect(response.status).toEqual(401);
        let error: {error: string} = await response.json() as {error: string};
        expect(error.error).toEqual("Non authorized!");

        // Création tournois sans name
        request = new NextRequest(`https://localhost/tournament/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': BTtoken1,
            },
            body: JSON.stringify({command: "create", description: "Ceci est vraiment un super tournoi", format: 'SIMPLE', size: 8, start_visibility: start_visibility, open_registration: open_registration, close_registration: close_registration, start: start})
        });
        response = await POSTTOUR(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("At least one parameter is missing! ('name', 'description', 'format', 'size', 'start_visibility', 'open_registration', 'close_registration', 'start'");
        tmp_token = response.headers.get('token');
        expect(tmp_token).not.toBeNull();
        BTtoken1 = tmp_token!;

        // Création tournois sans description
        request = new NextRequest(`https://localhost/tournament/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': BTtoken1,
            },
            body: JSON.stringify({command: "create", name: "Test tournois!", format: 'SIMPLE', size: 8, start_visibility: start_visibility, open_registration: open_registration, close_registration: close_registration, start: start})
        });
        response = await POSTTOUR(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("At least one parameter is missing! ('name', 'description', 'format', 'size', 'start_visibility', 'open_registration', 'close_registration', 'start'");
        tmp_token = response.headers.get('token');
        expect(tmp_token).not.toBeNull();
        BTtoken1 = tmp_token!;

        // Création tournois sans format
        request = new NextRequest(`https://localhost/tournament/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': BTtoken1,
            },
            body: JSON.stringify({command: "create", name: "Test tournois!", description: "Ceci est vraiment un super tournoi", size: 8, start_visibility: start_visibility, open_registration: open_registration, close_registration: close_registration, start: start})
        });
        response = await POSTTOUR(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("At least one parameter is missing! ('name', 'description', 'format', 'size', 'start_visibility', 'open_registration', 'close_registration', 'start'");
        tmp_token = response.headers.get('token');
        expect(tmp_token).not.toBeNull();
        BTtoken1 = tmp_token!;

        // Création tournois sans size
        request = new NextRequest(`https://localhost/tournament/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': BTtoken1,
            },
            body: JSON.stringify({command: "create", name: "Test tournois!", descriBTion: "Ceci est vraiment un super tournoi", format: 'SIMPLE', start_visibility: start_visibility, open_registration: open_registration, close_registration: close_registration, start: start})
        });
        response = await POSTTOUR(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("At least one parameter is missing! ('name', 'description', 'format', 'size', 'start_visibility', 'open_registration', 'close_registration', 'start'");
        tmp_token = response.headers.get('token');
        expect(tmp_token).not.toBeNull();
        BTtoken1 = tmp_token!;

        // Création tournois sans start_visibility
        request = new NextRequest(`https://localhost/tournament/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': BTtoken1,
            },
            body: JSON.stringify({command: "create", name: "Test tournois!", description: "Ceci est vraiment un super tournoi", format: 'SIMPLE', size: 8, open_registration: open_registration, close_registration: close_registration, start: start})
        });
        response = await POSTTOUR(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("At least one parameter is missing! ('name', 'description', 'format', 'size', 'start_visibility', 'open_registration', 'close_registration', 'start'");
        tmp_token = response.headers.get('token');
        expect(tmp_token).not.toBeNull();
        BTtoken1 = tmp_token!;

        // Création tournois sans open_registration
        request = new NextRequest(`https://localhost/tournament/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': BTtoken1,
            },
            body: JSON.stringify({command: "create", name: "Test tournois!", description: "Ceci est vraiment un super tournoi", format: 'SIMPLE', size: 8, start_visibility: start_visibility, close_registration: close_registration, start: start})
        });
        response = await POSTTOUR(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("At least one parameter is missing! ('name', 'description', 'format', 'size', 'start_visibility', 'open_registration', 'close_registration', 'start'");
        tmp_token = response.headers.get('token');
        expect(tmp_token).not.toBeNull();
        BTtoken1 = tmp_token!;

        // Création tournois sans close_registration
        request = new NextRequest(`https://localhost/tournament/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': BTtoken1,
            },
            body: JSON.stringify({command: "create", name: "Test tournois!", description: "Ceci est vraiment un super tournoi", format: 'SIMPLE', size: 8, start_visibility: start_visibility, open_registration: open_registration, start: start})
        });
        response = await POSTTOUR(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("At least one parameter is missing! ('name', 'description', 'format', 'size', 'start_visibility', 'open_registration', 'close_registration', 'start'");
        tmp_token = response.headers.get('token');
        expect(tmp_token).not.toBeNull();
        BTtoken1 = tmp_token!;

        // Création tournois sans start
        request = new NextRequest(`https://localhost/tournament/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': BTtoken1,
            },
            body: JSON.stringify({command: "create", name: "Test tournois!", description: "Ceci est vraiment un super tournoi", format: 'SIMPLE', size: 8, start_visibility: start_visibility, open_registration: open_registration, close_registration: close_registration})
        });
        response = await POSTTOUR(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("At least one parameter is missing! ('name', 'description', 'format', 'size', 'start_visibility', 'open_registration', 'close_registration', 'start'");
        tmp_token = response.headers.get('token');
        expect(tmp_token).not.toBeNull();
        BTtoken1 = tmp_token!;

        // Création test tournois
        request = new NextRequest(`https://localhost/tournament/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': BTtoken1,
            },
            body: JSON.stringify({command: "create", name: "Test tournois!", description: "Ceci est vraiment un super tournoi", format: 'SIMPLE', size: 8, start_visibility: start_visibility, open_registration: open_registration, close_registration: close_registration, start: start})
        });
        response = await POSTTOUR(request);
        expect(response.status).toEqual(200);
        tmp_token = response.headers.get('token');
        expect(tmp_token).not.toBeNull();
        BTtoken1 = tmp_token!;
        const id: id = await response.json() as id;
        expect(id.id).not.toBeNull();
        BTID = id.id!;

        // Test edit sans token
        request = new NextRequest(`https://localhost/tournament/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({command: "edit", id_tournament: BTID, name: "Mon Tournoi édité", description: "Ceci est une édition", format: 'SIMPLE', size: 4, start_visibility: start_visibility, open_registration: open_registration, close_registration: close_registration, start: start})
        });
        response = await POSTTOUR(request);
        expect(response.status).toEqual(401);
        error =  await response.json() as {error: string};
        expect(error.error).toEqual("Non authorized!");

        // Test edit avec le token de quelqu'un d'autre
        request = new NextRequest(`https://localhost/tournament/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': BTtoken2,
            },
            body: JSON.stringify({command: "edit", id_tournament: BTID, name: "Mon Tournoi édité", description: "Ceci est une édition", format: 'SIMPLE', size: 4, start_visibility: start_visibility, open_registration: open_registration, close_registration: close_registration, start: start})
        });
        response = await POSTTOUR(request);
        expect(response.status).toEqual(403);
        error =  await response.json() as {error: string};
        expect(error.error).toEqual("You don't have the permission to do this !");
        tmp_token = response.headers.get('token');
        expect(tmp_token).not.toBeNull();
        BTtoken2 = tmp_token!;

        // Test registration sans token
        request = new NextRequest(`https://localhost/tournament/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({command: "register", id_tournament: BTID})
        });
        response = await POSTTOUR(request);
        expect(response.status).toEqual(401);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("Non authorized!");

        // Test registration en étant pas le owner
        //      Ajout d'un membre dans l'équipe test
        request = new NextRequest(`https://localhost/team/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': BTtoken1,
            },
            body: JSON.stringify({command: "add", id_user: iduserBT2, id_team: id_teamBT})
        });
        response = await POSTTEAM(request);
        expect(response.status).toEqual(200);
        tmp_token = response.headers.get('token');
        expect(tmp_token).not.toBeNull();
        BTtoken1 = tmp_token!;
        //      Test registration
        request = new NextRequest(`https://localhost/tournament/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': BTtoken2,
            },
            body: JSON.stringify({command: "register", id_tournament: BTID})
        });
        response = await POSTTOUR(request);
        expect(response.status).toEqual(403);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("You need to own a team to register !");
        tmp_token = response.headers.get('token');
        expect(tmp_token).not.toBeNull();
        BTtoken2 = tmp_token!;

        // Test GET sans rien
        request = new NextRequest(`https://localhost/tournament/`);
        response = await GETTOUR(request);
        expect(response.status).toEqual(400);
        error =  await response.json() as {error: string};
        expect(error.error).toEqual("'id' is required!");

        // Test GET avec g éroné
        request = new NextRequest(`https://localhost/tournament/?id=${BTID}&g=prout`);
        response = await GETTOUR(request);
        expect(response.status).toEqual(400);
        error =  await response.json() as {error: string};
        expect(error.error).toEqual("'g' must equal to 'teams' or 'matchs' to fetch it!");

        // Test erase sans token
        request = new NextRequest(`https://localhost/tournament/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({command: "erase", id_tournament: BTID})
        });
        response = await POSTTOUR(request);
        expect(response.status).toEqual(401);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("Non authorized!");

        // Test erase sans id_tournament
        request = new NextRequest(`https://localhost/tournament/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': BTtoken1,
            },
            body: JSON.stringify({command: "erase"})
        });
        response = await POSTTOUR(request);
        expect(response.status).toEqual(400);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("'id_tournament' is required!");
        tmp_token = response.headers.get('token');
        expect(tmp_token).not.toBeNull();
        BTtoken1 = tmp_token!;

        // Test erase sans être le propriétaire
        request = new NextRequest(`https://localhost/tournament/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': BTtoken2,
            },
            body: JSON.stringify({command: "erase", id_tournament: BTID})
        });
        response = await POSTTOUR(request);
        expect(response.status).toEqual(403);
        error = await response.json() as {error: string};
        expect(error.error).toEqual("You don't have the permission to do this!");
        tmp_token = response.headers.get('token');
        expect(tmp_token).not.toBeNull();
        BTtoken2 = tmp_token!;
    });
    afterAll(async() => {
        const database = Controller.getInstance();

        // User Perfect use
        await database.deleteUser(idUserAPI);

        // User Bad use
        await database.deleteUser(badUser1API);
        await database.deleteUser(badUser2API);

        // Team Perfect use
        await database.hardDeleteTeam(idPerfectTeam);
        await database.hardDeleteTeam(nameUserTeam);
        await database.deleteUser(idUserTeam);
        await database.deleteUser(idUser2Team);
        await database.deleteUser(nameUserTeam);
        await database.deleteUser(nameUser2Team);
        await database.deleteUser(adminTeam);

        // Team Bad use
        await database.hardDeleteTeam(badUserTeam);
        await database.hardDeleteTeam(badUser2Team);
        await database.deleteUser(badUserTeam);
        await database.deleteUser(badUser2Team);
        await database.deleteUser(badUserIDTeam);
        await database.deleteUser(badUserID2Team);

        // Tournament Perfect use
        if (PTID)
            await database.deleteTournament(PTID);
        for (const id of teamsPTID)
            await database.hardDeleteTeam(id);
        for (const id of usersPTID)
            await database.deleteUser(id);

        // Tournament bad use
        if (BTID)
            await database.deleteTournament(BTID);
        await database.hardDeleteTeam(id_teamBT);
        await database.deleteUser(iduserBT1);
        await database.deleteUser(iduserBT2);
        await database.deleteUser(userBT1);
        await database.deleteUser(userBT2);
    });
});