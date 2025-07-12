import {Database} from "../lib/database/database";
import {afterAll, beforeAll, describe, expect, test} from "@jest/globals"

import {
    getTeamMembers,
    getTeams,
    getHistories,
    id,
    status,
    Team,
    User,
    SQLGetResult,
    getTournamentTeams,
    Tournament,
    getMatchs,
    Match,
    TeamTournament, TeamInfo, UserInfo
} from "../lib/types";
import {sleep} from "../lib/tools/sleep";
import {UserEntity} from "../lib/database/UserEntity";
import {TournamentEntity} from "../lib/database/TournamentEntity";
import { TeamEntity } from "../lib/database/TeamEntity";

describe("Database", () => {
    // Primary functions
    let id_primary_user: number;
    // User perfect use
    const nameUserManagement: string = "JestElessiah";

    // User bad use
    const badUserManagement: string = "BadElessiah";
    const nameAlreadyUsed: string = "Used";

    // Team perfect use
    const nameTeamManagement: string = "JestTeamAilée";
    const name2TeamManagement: string = "JestTeamAilée2";

    // Team bad use
    const badTeamManagement: string = "BadTeamAilée";
    const bad2TeamManagement: string = "Bad2TeamAilée";
    const bad3TeamManagement: string = "Bad3TeamAilée";

    // Tournament management perfect use
    const nameTournamentTest: string = "TournamentJest";
    const teamTournamentTest: string = "Tournament2Jest";
    let idTournament: number | undefined;

    // Tournament management bad use
    const BadTournamentTest: string = "TournamentBad";
    const Bad2TournamentTest: string = "Tournament2Bad";
    const Bad3TournamentTest: string = "Tournament3Bad";
    const Bad4TournamentTest: string = "Tournament4Bad";
    const Bad5TournamentTest: string = "Tournament5Bad";
    let BadIdTournament: number | undefined;
    let BadEditTournament: number | undefined;

    // Match & History perfect use
    const namesMatchsHistory: string[] = ["MatchHistory1", "MatchHistory2", "MatchHistory3", "MatchHistory4"];
    const substituteName: string = "MatchHistorySub";
    let MatchHistoryTournament: number | undefined;
    let MatchHistory2Tournament: number | undefined;

    // Match & History bad use
    const badMatchsHistory: string[] = ["BadHistory1", "BadHistory2", "BadHistory3", "BadHistory4"];
    let BadHistoryTournament: number | undefined;

    //      Init Date
    const now = new Date();
    const baseYear = now.getFullYear();
    const baseMonth = now.getMonth();
    const baseDate = now.getDate();
    const baseHour = now.getHours();
    const baseMinutes = now.getMinutes();
    
    //      Hash
    const passwordUser = "HashTestHashTest";
    beforeAll(async () => {
    });
    test("Primary database function", async() => {
        // Récupération de l'instance
        const database: Database = await Database.getInstance();
        // Test insert sain
        let insertStatus : status & id = await database.insert({ table: "user", columns : ["username", "hash"], values: ["TestInsertJEST", "MyElessiah"]});
        expect(insertStatus.success).toBeTruthy();
        id_primary_user = insertStatus.id;

        // Test get sain
        let result : SQLGetResult = await database.get({ table: "user", values: ["*"], whereOption: [{ column: "username", condition: "=", value: "TestInsertJEST"}]});
        expect(result.success).toBeTruthy();
        let userInfos = result.result as User[];
        expect(userInfos.length).toEqual(1);
        expect(userInfos[0]).toEqual({ id_user: id_primary_user, username: "TestInsertJEST", hash: "MyElessiah", token: null, is_admin: 0 });

        // Test update sain
        let status : status = await database.update({ table: "user", columns: ["username"], values: ["48"]}, [{ column: "id_user", condition: "=", value: id_primary_user}]);
        expect(status.success).toBeTruthy();

        // Vérification update
        result = await database.get({ table: "user", whereOption: [{ column: "id_user", condition: "=", value: id_primary_user}]});
        expect(result.success).toBeTruthy();
        userInfos = result.result as User[];
        expect(userInfos.length).toEqual(1);
        expect(userInfos[0]).toEqual({ id_user: id_primary_user, username: "48", hash: "MyElessiah", token: null, is_admin: 0 });

        // Test remove sain
        status = await database.remove({ table: "user", whereOption: [{ column: "id_user", condition: "=", value: id_primary_user}]});
        expect(status.success).toBeTruthy();

        // Vérification suppression
        result = await database.get({ table: "user",  whereOption: [{ column: "id_user", condition: "=", value: id_primary_user}]});
        expect(result.success).toBeTruthy();
        expect(result.result.length).toEqual(0);
    });
    test("User management perfect use", async() => {
        // Création utilisateur
        const user: UserEntity = new UserEntity();
        let setResult: status & id & {token: string} = await user.new(nameUserManagement, passwordUser);
        expect(setResult.success).toBeTruthy();
        expect(setResult.id).not.toEqual(-1);
        expect(user.id).toEqual(setResult.id);
        expect(user.name).toEqual(nameUserManagement);
        expect(user.team).toBeNull();
        expect(user.is_admin).toEqual(false);
        let user_token = setResult.token;

        // Test fetch ID
        let status : status = await user.fetch(user.id!);
        expect(status.success).toBeTruthy();
        expect(user.id).toEqual(setResult.id);
        expect(user.name).toEqual(nameUserManagement);
        expect(user.team).toBeNull();
        expect(user.is_admin).toEqual(false);

        // Test fetch Username
        status = await user.fetch(nameUserManagement);
        expect(status.success).toBeTruthy();
        expect(user.id).toEqual(setResult.id);
        expect(user.name).toEqual(nameUserManagement);
        expect(user.team).toBeNull();
        expect(user.is_admin).toEqual(false);

        // Test token auth
        let token_status: status & {token: string} = await user.authToken(user_token);
        expect(token_status.success).toBeTruthy();
        expect(token_status.token.length).toBeGreaterThan(0);
        expect(token_status.token).not.toEqual(user_token);
        user_token = token_status.token;

        // Test password
        token_status = await user.authPassword(passwordUser);
        expect(token_status.success).toBeTruthy();
        expect(token_status.token.length).toBeGreaterThan(0);
        expect(token_status.token).not.toEqual(user_token);
        user_token = token_status.token;

        // Test edit password
        token_status = await user.updatePassword(passwordUser, nameUserManagement);
        expect(token_status.success).toBeTruthy();
        expect(token_status.token.length).toBeGreaterThan(0);
        expect(token_status.token).not.toEqual(user_token);
        user_token = token_status.token;

        // Vérification edit password
        token_status = await user.authPassword(nameUserManagement);
        expect(token_status.success).toBeTruthy();
        expect(token_status.token.length).toBeGreaterThan(0);
        expect(token_status.token).not.toEqual(user_token);
        user_token = token_status.token;

        // Reset for next
        token_status = await user.updatePassword(nameUserManagement, passwordUser);
        expect(token_status.success).toBeTruthy();
        expect(token_status.token.length).toBeGreaterThan(0);
        expect(token_status.token).not.toEqual(user_token);
        user_token = token_status.token;

        // Test rename
        status = await user.rename(nameUserManagement.toUpperCase());
        expect(status.success).toBeTruthy();
        expect(user.name).toEqual(nameUserManagement.toUpperCase());
        expect((await user.fetch(nameUserManagement)).success).toBeFalsy();
        expect((await user.fetch(nameUserManagement.toUpperCase())).success).toBeTruthy();

        // Reset name for next
        status = await user.rename(nameUserManagement);
        expect(status.success).toBeTruthy();
        expect(user.name).toEqual(nameUserManagement);

        // Test suppression
        let delResult = await user.delete();
        expect(delResult.success).toBeTruthy();
        expect(user.is_loaded).toBeFalsy();
        expect((await user.fetch(nameUserManagement)).success).toBeFalsy();

        // Test Création admin
        setResult = await user.new(nameUserManagement, passwordUser, true);
        expect(setResult.success).toBeTruthy();
        expect(setResult.id).not.toEqual(-1);
        expect(user.is_admin).toBeTruthy();
        const admin_id = setResult.id;

        // Test suppression par ID
        delResult = await user.delete();
        expect(delResult.success).toBeTruthy();
    });
    test("User management bad use", async() => {
        // Init test user
        const user: UserEntity = new UserEntity();
        let setResult : status & id & {token: string} = await user.new(badUserManagement, passwordUser);
        expect(setResult.success).toBeTruthy();
        expect(setResult.id).not.toEqual(-1);
        const id_user : number = setResult.id;
        let user_token: string = setResult.token;

        const user2: UserEntity = new UserEntity();
        setResult = await user2.new(nameAlreadyUsed, passwordUser);
        expect(setResult.success).toBeTruthy();
        expect(setResult.id).not.toEqual(-1);

        // Test création doublons
        const badUser: UserEntity = new UserEntity();
        let setError : status & id = await badUser.new(badUserManagement, passwordUser);
        expect(setError.success).toBeFalsy();
        expect(setError.error).toEqual("Username already exist !");

        // Test création trop courte
        setError = await badUser.new("", passwordUser);
        expect(setError.success).toBeFalsy();
        expect(setError.error).toEqual("The name must be at least 3 characters and maximum 15!");
        setError = await badUser.new("az", passwordUser);
        expect(setError.success).toBeFalsy();
        expect(setError.error).toEqual("The name must be at least 3 characters and maximum 15!");

        // Test création trop longue
        setError = await badUser.new("1234567890123456", passwordUser);
        expect(setError.success).toBeFalsy();
        expect(setError.error).toEqual("The name must be at least 3 characters and maximum 15!");

        // Test création avec mot de passe trop court
        setError = await badUser.new(badUserManagement.toUpperCase(), "");
        expect(setError.success).toBeFalsy();
        expect(setError.error).toEqual("Password must be contain between 8 and 50 characters!");
        setError = await badUser.new(badUserManagement.toUpperCase(), "azeze");
        expect(setError.success).toBeFalsy();
        expect(setError.error).toEqual("Password must be contain between 8 and 50 characters!");

        // Test création avec mot de passe trop long
        setError = await badUser.new(badUserManagement.toUpperCase(), "1234567890123456789012345678901234567890123456789012345678901234567890");
        expect(setError.success).toBeFalsy();
        expect(setError.error).toEqual("Password must be contain between 8 and 50 characters!");

        // Test authPasswordUser password éroné
        let statusToken: status & {token: string} = await user.authPassword("JeNeSuisPasLeBonMDP");
        expect(statusToken.success).toBeTruthy();
        expect(statusToken.token.length).toEqual(0);

        // Test editPasswordUser old_password éroné
        statusToken = await user.updatePassword("JeNeSuisPasLeBonMDP", "JeSuisLeNouveauMDP");
        expect(statusToken.success).toBeFalsy();
        expect(statusToken.token.length).toEqual(0);

        // Test editPasswordUser old_password et new_password éroné
        statusToken = await user.updatePassword(passwordUser, passwordUser);
        expect(statusToken.success).toBeFalsy();
        expect(statusToken.error).toEqual("The new password is the same as the last one!");
        expect(statusToken.token.length).toEqual(0);

        // Test editPasswordUser new_password trop court
        statusToken = await user.updatePassword(passwordUser, "");
        expect(statusToken.success).toBeFalsy();
        expect(statusToken.error).toEqual("Password must be contain between 8 and 50 characters!");
        expect(statusToken.token.length).toEqual(0);
        statusToken = await user.updatePassword(passwordUser, "az");
        expect(statusToken.success).toBeFalsy();
        expect(statusToken.error).toEqual("Password must be contain between 8 and 50 characters!");
        expect(statusToken.token.length).toEqual(0);

        // Test editPasswordUser new_password trop long
        statusToken = await user.updatePassword(passwordUser, "1234567890123456789012345678901234567890123456789012345678901234567890");
        expect(statusToken.success).toBeFalsy();
        expect(statusToken.error).toEqual("Password must be contain between 8 and 50 characters!");
        expect(statusToken.token.length).toEqual(0);

        // Edit password for further tests
        statusToken = await user.updatePassword(passwordUser, "TemporaryPassword");
        expect(statusToken.success).toBeTruthy();
        expect(statusToken.token.length).toBeGreaterThan(0);
        expect(statusToken.token).not.toEqual(user_token);

        // Use old_password
        statusToken = await user.authPassword(passwordUser);
        expect(statusToken.success).toBeTruthy();
        expect(statusToken.token.length).toEqual(0);

        // Reset password for further tests
        statusToken = await user.updatePassword("TemporaryPassword", passwordUser);
        expect(statusToken.success).toBeTruthy();
        expect(statusToken.token.length).toBeGreaterThan(0);
        expect(statusToken.token).not.toEqual(user_token);
        user_token = statusToken.token;

        // Test authTokenUser avec un mauvais token
        statusToken = await user.authToken("WrongToken");
        expect(statusToken.success).toBeTruthy();
        expect(statusToken.token.length).toEqual(0);

        // Test authTokenUser double utilisation
        //      Première utilisation
        statusToken = await user.authToken(user_token);
        expect(statusToken.success).toBeTruthy();
        expect(statusToken.token.length).toBeGreaterThan(0);
        expect(statusToken.token).not.toEqual(user_token);
        //      Seconde utilisation
        statusToken = await user.authToken(user_token);
        expect(statusToken.success).toBeTruthy();
        expect(statusToken.token.length).toEqual(0);

        // Test edit avec nouveau Nom non conforme
        //          Trop court
        let status: status = await user.rename("");
        expect(status.success).toBeFalsy();
        status = await user.rename("za");
        expect(status.success).toBeFalsy();

        //          Déjà pris
        status = await user.rename(nameAlreadyUsed);
        expect(status.success).toBeFalsy();

        //          Le même
        status = await user.rename(badUserManagement);
        expect(status.success).toBeFalsy();

        //          Trop long
        status = await user.rename("12345678901234567");
        expect(status.success).toBeFalsy();
    });
    test("Team Management perfect use", async() => {
        // Création test User
        const user: UserEntity = new UserEntity();
        let setUserResult: status & id = await user.new(nameTeamManagement, passwordUser);
        expect(setUserResult.success).toBeTruthy();
        expect(setUserResult.id).not.toEqual(-1);

        // Création test user 2
        const user2: UserEntity = new UserEntity();
        setUserResult = await user2.new(name2TeamManagement, passwordUser);
        expect(setUserResult.success).toBeTruthy();
        expect(setUserResult.id).not.toBeUndefined();

        // Test création d'équipe
        const team: TeamEntity = new TeamEntity();
        let setTeamResult : status & id = await team.create(name2TeamManagement, user);
        expect(setTeamResult.success).toBeTruthy();
        expect(setUserResult.id).not.toEqual(-1);
        expect(team.name).toEqual(name2TeamManagement);
        expect(team.id_user).toEqual(user.id);

        // Test ownership with owner
        let checkOwnerShip: status & {result: number} = await TeamEntity.isTeamOwner(user);
        expect(checkOwnerShip.success).toBeTruthy();
        expect(checkOwnerShip.result).toEqual(team.id);

        // Test ownership with random user
        checkOwnerShip = await TeamEntity.isTeamOwner(user2);
        expect(checkOwnerShip.success).toBeTruthy();
        expect(checkOwnerShip.result).toEqual(-1);

        // Vérification création
        const database: Database = await Database.getInstance();
        let getResult: SQLGetResult = await database.get({ table: "team", whereOption: [{ column: "id_team", condition: "=", value: setTeamResult.id}] });
        expect(getResult.success).toBeTruthy();
        expect(getResult.result.length).toBe(1);
        let verifTeam : Team = getResult.result[0] as Team;
        expect(verifTeam.id_team).toEqual(team.id);
        expect(verifTeam.name).toEqual(name2TeamManagement);
        expect(verifTeam.id_user).toEqual(user.id);

        // Vérification MAJ user1
        let status: status = await user.fetch(user.id!);
        expect(status.success).toBeTruthy();

        // Test rename team
        status = await team.rename(nameTeamManagement);
        expect(status.success);
        expect(team.name).toEqual(nameTeamManagement);

        // Test ajout de membre
        status = await team.addMember(user2);
        expect(status.success).toBeTruthy();
        expect(team.members_count).toEqual(2);
        status = await team.fetch(team.id!);
        expect(status.success).toBeTruthy();
        expect(team.members_count).toEqual(2);

        // Vérification status owner après ajout de membre
        checkOwnerShip = await TeamEntity.isTeamOwner(user2);
        expect(checkOwnerShip.success).toBeTruthy();
        expect(checkOwnerShip.result).toEqual(-1);

        // Test getMembers après ajout de membre
        const getMembers: getTeamMembers = await team.getMembers();
        expect(getMembers.success).toBeTruthy();
        expect(getMembers.members.length).toBe(2);
        expect(getMembers.members[0].id_user).toEqual(user.id);
        expect(getMembers.members[1].id_user).toEqual(user2.id);

        // Vérification user2 profile
        let checkStatus: status & {result: number} = await TeamEntity.isMemberOfTeam(user2.id!);
        expect(checkStatus.success).toBeTruthy();
        expect(checkStatus.result).toEqual(team.id);

        // Test switch ownership
        status = await team.giveOwnership(user, user2);
        expect(status.success).toBeTruthy();

        // Test kick d'une équipe
        status = await team.rmMember(user);
        expect(status.success).toBeTruthy();

        // Vérification maj profil
        checkStatus = await TeamEntity.isMemberOfTeam(user.id!);
        expect(checkStatus.success).toBeTruthy();
        expect(checkStatus.result).toEqual(-1);

        // Rajout pour test suppression
        status = await team.addMember(user);
        expect(status.success).toBeTruthy();

        // Test suppression team
        status = await team.hardDelete();
        expect(status.success).toBeTruthy();

        // Vérification maj profil owner
        checkStatus = await TeamEntity.isMemberOfTeam(user.id!);
        expect(checkStatus.success).toBeTruthy();
        expect(checkStatus.result).toEqual(-1);

        // Vérification maj profil member
        checkStatus = await TeamEntity.isMemberOfTeam(user2.id!);
        expect(checkStatus.success).toBeTruthy();
        expect(checkStatus.result).toEqual(-1);
    });
    test("Team Management bad use", async() => {
        // Init
        //      User 1
        let setUserResult: status & id = await database.newUser(badTeamManagement, passwordUser);
        expect(setUserResult.success).toBeTruthy();
        expect(setUserResult.id).not.toEqual(-1);
        const user1 = setUserResult.id;

        //      User 2
        setUserResult = await database.newUser(bad2TeamManagement, passwordUser);
        expect(setUserResult.success).toBeTruthy();
        expect(setUserResult.id).not.toEqual(-1);
        const user2 = setUserResult.id;

        //      User 3
        setUserResult = await database.newUser(bad3TeamManagement, passwordUser);
        expect(setUserResult.success).toBeTruthy();
        expect(setUserResult.id).not.toEqual(-1);
        const user3 = setUserResult.id;

        //      Test Team
        let setTeamResult: status & id = await database.createTeam(badTeamManagement, user1);
        expect(setTeamResult.success).toBeTruthy();
        expect(setTeamResult.id).not.toEqual(-1);
        const test_team = setTeamResult.id;

        // Test getTeamInfo avec id éroné
        let getTeamInfo: status & Partial<TeamInfo> = await database.getTeamInfo(-1);
        expect(getTeamInfo.success).toBeFalsy();

        // Vérification status avec id éroné
        let checkOwnerShip: status & {result: number} = await database.isTeamOwner(-1);
        expect(checkOwnerShip.success).toBeFalsy();
        expect(checkOwnerShip.result).toEqual(-1);

        // Test création avec utilisateur non existant
        setTeamResult = await database.createTeam(badTeamManagement, 1596357);
        expect(setTeamResult.success).toBeFalsy();
        expect(setTeamResult.error).toEqual("This user does not exist!");
        expect(setTeamResult.id).toEqual(-1);

        // Test création avec nom trop court
        setTeamResult = await database.createTeam("", user1);
        expect(setTeamResult.success).toBeFalsy();
        expect(setTeamResult.error).toEqual("The name must be at least 3 characters and maximum 15!");
        expect(setTeamResult.id).toEqual(-1);
        setTeamResult = await database.createTeam("az", user1);
        expect(setTeamResult.success).toBeFalsy();
        expect(setTeamResult.error).toEqual("The name must be at least 3 characters and maximum 15!");
        expect(setTeamResult.id).toEqual(-1);

        // Test création avec nom trop long
        setTeamResult = await database.createTeam("1234567890123456", user1);
        expect(setTeamResult.success).toBeFalsy();
        expect(setTeamResult.error).toEqual("The name must be at least 3 characters and maximum 15!");
        expect(setTeamResult.id).toEqual(-1);

        // Test création d'équipe en doublons
        const sameTeamName: status & id = await database.createTeam(badTeamManagement, user1);
        expect(sameTeamName.success).toBeFalsy();
        expect(sameTeamName.error).toEqual("Team name already exist !");
        expect(sameTeamName.id).toEqual(-1);

        // Test rename avec nom déjà pris
        let status : status = await database.renameTeam(test_team, badTeamManagement);
        expect(status.success).toBeFalsy();

        // Test rename avec nom trop court
        status = await database.renameTeam(test_team, "");
        expect(status.success).toBeFalsy();
        status = await database.renameTeam(test_team, "az");
        expect(status.success).toBeFalsy();

        // Test rename avec nom trop long
        status = await database.renameTeam(test_team, "1234567890123456");
        expect(status.success).toBeFalsy();

        // Test rename d'une team inexistante
        status = await database.renameTeam(-1, "JefonctionnePas")
        expect(status.success).toBeFalsy();

        // Test ajout de membre avec paramètre user cassé
         status = await database.addTeamMember(448844, test_team);
        expect(status.success).toBeFalsy();

        // Test ajout de membre avec paramètre team cassé
        status = await database.addTeamMember(user2, 884488);
        expect(status.success).toBeFalsy();

        // Test ajout de membre avec double paramètre cassé
        status = await database.addTeamMember(9999999, 9999999);
        expect(status.success).toBeFalsy();

        // Test ajout de l'owner dans sa propre équipe
        status = await database.addTeamMember(user1, test_team);
        expect(status.success).toBeFalsy();

        // Test ajout double invitation
        //      Invitation fonctionnelle
        status = await database.addTeamMember(user2, test_team);
        expect(status.success).toBeTruthy();
        //      Invitation non fonctionnelle
        status = await database.addTeamMember(user2, test_team);
        expect(status.success).toBeFalsy();

        // Test give ownership à un utilisateur hors équipe
        status = await database.giveTeamOwnership(user1, user3);
        expect(status.success).toBeFalsy();

        // Test give owner à l'owner
        status = await database.giveTeamOwnership(user1, user1);
        expect(status.success).toBeTruthy(); // Ne se passe rien mais génère pas d'erreur donc OK

        // Test give non owner à lui-même
        status = await database.giveTeamOwnership(user2, user2);
        expect(status.success).toBeFalsy();

        // Test owner éroné
        status = await database.giveTeamOwnership(-1, user2);
        expect(status.success).toBeFalsy();

        // Test new_owner éroné
        status = await database.giveTeamOwnership(user1, -1);
        expect(status.success).toBeFalsy();

        // Test double éroné
        status = await database.giveTeamOwnership(-1, -1);
        expect(status.success).toBeFalsy();

        // Ajout user3 pour plus de tests
        status = await database.addTeamMember(user3, test_team);
        expect(status.success).toBeTruthy();

        // Test non owner à other non owner
        status = await database.addTeamMember(user2, user3);
        expect(status.success).toBeFalsy();

        // Test récupération des membres par ID avec paramètres cassé
        let teamMembers : getTeamMembers = await database.getTeamMembers(1234567890123456);
        expect(teamMembers.success).toBeFalsy();

        // Test récupération des membres par Nom avec nom inconnu
        teamMembers = await database.getTeamMembers("Je ne suis pas un nom d'équipe !");
        expect(teamMembers.success).toBeFalsy();

        // Test kick avec entrée cassé
        status = await database.rmTeamMember(546511);
        expect(status.success).toBeFalsy();

        // Test kick owner
        status = await database.rmTeamMember(user1);
        expect(status.success).toBeFalsy();

        // Test suppression avec id eroné
        status = await database.hardDeleteTeam(-1);
        expect(status.success).toBeFalsy();

        // Test suppression avec nom eroné
        status = await database.hardDeleteTeam("");
        expect(status.success).toBeFalsy();

        status = await database.hardDeleteTeam("az");
        expect(status.success).toBeFalsy();
    });
    test("Tournament Management perfect use", async() => {
        // Init Test variables

        //      Init Users
        let setResult: status & id = await database.newUser(nameTournamentTest, passwordUser);
        expect(setResult.success).toBeTruthy();
        const owner_id: number = setResult.id;
        setResult = await database.newUser(teamTournamentTest, passwordUser);
        expect(setResult.success).toBeTruthy();
        const second_owner_id: number = setResult.id;

        //      Init Teams
        setResult = await database.createTeam(nameTournamentTest, owner_id);
        expect(setResult.success).toBeTruthy();
        const team_one_id = setResult.id;
        setResult = await database.createTeam(teamTournamentTest, second_owner_id);
        expect(setResult.success).toBeTruthy();
        const team_two_id = setResult.id;

        // Init settings tournament
        const visibility = new Date(baseYear, baseMonth, baseDate, baseHour + 1, baseMinutes);
        const open_registration = new Date(baseYear, baseMonth, baseDate + 5, baseHour, baseMinutes);
        const close_registration = new Date(baseYear, baseMonth, baseDate + 12, baseHour, baseMinutes);
        const start = new Date(baseYear, baseMonth, baseDate + 13, baseHour, baseMinutes);
        const description: string = "Je suis une description sans importance.";
        const format: 'SIMPLE' | 'DOUBLE' | null = 'SIMPLE';
        const size: number = 8;

        // Test création de tournois
        setResult = await database.createTournament(
            nameTournamentTest,
            description,
            format,
            size,
            owner_id,
            visibility,
            open_registration,
            close_registration,
            start);
        expect(setResult.success).toBeTruthy();
        idTournament = setResult.id;

        // Test récupération
        const tournament: status & Partial<Tournament> = await database.getTournament(idTournament);
        expect(tournament.success).toBeTruthy();
        expect(tournament.name).toEqual(nameTournamentTest);
        expect(tournament.description).toEqual(description);
        expect(tournament.format).toEqual(format);
        expect(tournament.size).toEqual(size);
        expect(tournament.id_owner).toEqual(owner_id);
        expect(tournament.creation_date).not.toBeUndefined();
        if (!tournament.creation_date)
            throw "Erreur !";
        expect(tournament.creation_date.getTime() - now.getTime()).toBeLessThanOrEqual(5000);
        expect(tournament.start_visibility?.getTime()).toEqual(visibility.getTime());
        expect(tournament.open_registration?.getTime()).toEqual(open_registration.getTime());
        expect(tournament.close_registration?.getTime()).toEqual(close_registration.getTime());
        expect(tournament.start?.getTime()).toEqual(start.getTime());

        // Test edit name
        let status: status = await database.editTournament(idTournament, teamTournamentTest);
        expect(status.success).toBeTruthy();

        // Vérification edit name
        let test_tournament: status & Partial<Tournament> = await database.getTournament(idTournament);
        expect(test_tournament).toEqual({...tournament, name: teamTournamentTest});

        // Test edit description et retour OG name
        status = await database.editTournament(idTournament, nameTournamentTest, description.toUpperCase());
        expect(status.success).toBeTruthy();

        // Vérification edit description et nom
        test_tournament = await database.getTournament(idTournament);
        expect(test_tournament).toEqual({...tournament, description: description.toUpperCase()});

        // Test edit format et retour description
        status = await database.editTournament(idTournament, null, description, "DOUBLE");
        expect(status.success).toBeTruthy();

        // Vérification edit format
        test_tournament = await database.getTournament(idTournament);
        expect(test_tournament).toEqual({...tournament, format: "DOUBLE"});

        // Test edit size et retour format
        status = await database.editTournament(idTournament, null, null, 'SIMPLE', 4);
        expect(status.success).toBeTruthy();

        // Vérification edit size et format
        test_tournament = await database.getTournament(idTournament);
        expect(test_tournament).toEqual({...tournament, size: 4});

        // Test edit start_visibility et retour size
        let tmp_date: Date = new Date(visibility);
        tmp_date.setHours(tmp_date.getHours() + 1);
        status = await database.editTournament(idTournament, null, null, null, 8, tmp_date);
        expect(status.success).toBeTruthy();

        // Vérification edit start_visibility et retour size
        test_tournament = await database.getTournament(idTournament);
        expect(test_tournament).toEqual({...tournament, start_visibility: tmp_date});

        // Test edit open_registration et retour start_visibility
        tmp_date = new Date(open_registration);
        tmp_date.setHours(open_registration.getHours() - 1);
        status = await database.editTournament(idTournament, null, null, null, null, visibility, tmp_date);
        expect(status.success).toBeTruthy();

        // Vérification edit open_registration et retour start_visibility
        test_tournament = await database.getTournament(idTournament);
        expect(test_tournament).toEqual({...tournament, open_registration: tmp_date});

        // Test edit close_registration et retour open_registration
        tmp_date = new Date(close_registration);
        tmp_date.setHours(close_registration.getHours() + 10);
        status = await database.editTournament(idTournament, null, null, null, null, null, open_registration, tmp_date);
        expect(status.success).toBeTruthy();

        // Vérification edit close_registration et retour open_registration
        test_tournament = await database.getTournament(idTournament);
        expect(test_tournament).toEqual({...tournament, close_registration: tmp_date});

        // Test edit start et retour close_registration
        tmp_date = new Date(start);
        tmp_date.setHours(start.getHours() + 8);
        status = await database.editTournament(idTournament, null, null, null, null, null, null, close_registration, tmp_date);
        expect(status.success).toBeTruthy();

        // Vérification edit start et retour close_registration
        test_tournament = await database.getTournament(idTournament);
        expect(test_tournament).toEqual({...tournament, start: tmp_date});

        // Test edit retour close_registration
        status = await database.editTournament(idTournament, null, null, null, null, null, null, null, start);
        expect(status.success).toBeTruthy();

        // Vérification edit start_visibility et retour size
        test_tournament = await database.getTournament(idTournament);
        expect(test_tournament).toEqual({...tournament});

        // Ouverture des inscriptions pour les tests
        status = await database.editTournament(idTournament, null, null, null, null, null, now);
        expect(status.success).toBeTruthy();

        //      Pour éviter un problème d'égalité avec les périodes d'inscriptions et les inscriptions
        await sleep(500);

        // Test inscription
        status = await database.tournamentRegistration(idTournament, team_one_id);
        expect(status.success).toBeTruthy();

        // Inscription deuxième équipe
        status = await database.tournamentRegistration(idTournament, team_two_id);
        expect(status.success).toBeTruthy();

        // Vérification inscription par getRegisterTeams
        let getTeams : getTournamentTeams = await database.getRegisterTeams(idTournament);
        expect(getTeams.success).toBeTruthy();
        expect(getTeams.teams.length).toEqual(2);

        // Vérification inscription par récupération des historiques teams
        let getHistories: getHistories = await database.getTeamHistory(team_one_id);
        expect(getHistories.success).toBeTruthy();
        expect(getHistories.histories.length).toEqual(1);

        // Vérification inscription par récupération des historiques utilisateurs
        let userHistory: getHistories = await database.getUserHistory(owner_id);
        expect(userHistory.success).toBeTruthy();
        expect(userHistory.histories.length).toEqual(1);
        expect(getHistories.histories).toEqual(userHistory.histories);

        // Test désinscription
        status = await database.tournamentUnregistration(idTournament, team_two_id);
        expect(status.success).toBeTruthy();

        // Vérification désinscription par getRegisterTeams
        getTeams = await database.getRegisterTeams(idTournament);
        expect(getTeams.success).toBeTruthy();
        expect(getTeams.teams.length).toEqual(1);

        // Vérification désinscription par récupération des historiques teams
        getHistories = await database.getTeamHistory(team_two_id);
        expect(getHistories.success).toBeTruthy();
        expect(getHistories.histories.length).toEqual(0);

        // Vérification désinscription par récupération des historiques utilisateurs
        userHistory = await database.getUserHistory(second_owner_id);
        expect(userHistory.success).toBeTruthy();
        expect(userHistory.histories.length).toEqual(0);

        // Réinscription pour test suppression de tournois
        // Inscription deuxième équipe
        status = await database.tournamentRegistration(idTournament, team_two_id);
        expect(status.success).toBeTruthy();

        // Test suppression
        status = await database.deleteTournament(idTournament);
        expect(status.success).toBeTruthy();

        // Vérification suppression par getTeams
        getTeams = await database.getRegisterTeams(idTournament);
        expect(getTeams.success).toBeFalsy();
        expect(getTeams.teams.length).toEqual(0);

        // Vérification suppression du tournoi par historique des équipes
        getHistories = await database.getTeamHistory(team_one_id);
        expect(getHistories.success).toBeTruthy();
        expect(getHistories.histories.length).toEqual(0);

        // Vérification suppression du tournoi par historique des équipes
        getHistories = await database.getTeamHistory(team_one_id);
        expect(getHistories.success).toBeTruthy();
        expect(getHistories.histories.length).toEqual(0);

        // Test inscription tournoi supprimé
        status = await database.tournamentRegistration(idTournament, team_one_id);
        expect(status.success).toBeFalsy();
    });
    test("Tournament Management bad use", async() => {
        // Init Test variables

        //      Init Users
        let setResult: status & id = await database.newUser(BadTournamentTest, passwordUser);
        expect(setResult.success).toBeTruthy();
        const owner_id: number = setResult.id;
        setResult = await database.newUser(Bad2TournamentTest, passwordUser);
        expect(setResult.success).toBeTruthy();
        const second_owner_id: number = setResult.id;
        setResult = await database.newUser(Bad3TournamentTest, passwordUser);
        expect(setResult.success).toBeTruthy();
        const third_owner_id: number = setResult.id;
        setResult = await database.newUser(Bad4TournamentTest, passwordUser);
        expect(setResult.success).toBeTruthy();
        const fourth_owner_id: number = setResult.id;
        setResult = await database.newUser(Bad5TournamentTest, passwordUser);
        expect(setResult.success).toBeTruthy();
        const fifth_owner_id: number = setResult.id;

        //      Init Teams
        setResult = await database.createTeam(BadTournamentTest, owner_id);
        expect(setResult.success).toBeTruthy();
        const team_one_id = setResult.id;
        setResult = await database.createTeam(Bad2TournamentTest, second_owner_id);
        expect(setResult.success).toBeTruthy();
        const team_two_id = setResult.id;
        setResult = await database.createTeam(Bad3TournamentTest, third_owner_id);
        expect(setResult.success).toBeTruthy();
        const team_three_id: number = setResult.id;
        setResult = await database.createTeam(Bad4TournamentTest, fourth_owner_id);
        expect(setResult.success).toBeTruthy();
        const team_four_id: number = setResult.id;
        setResult = await database.createTeam(Bad5TournamentTest, fifth_owner_id);
        expect(setResult.success).toBeTruthy();
        const team_five_id: number = setResult.id;


        // Test size tournois
        //      Init tournois
        let tmp_date: Date = new Date();
        tmp_date.setMilliseconds(tmp_date.getMilliseconds() + 1000);
        setResult = await database.createTournament(
            nameTournamentTest,
            "Je suis une description sans importance.",
            'SIMPLE',
            4,
            owner_id,
            new Date(baseYear, baseMonth, baseDate, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate, baseHour, baseMinutes),
            tmp_date,
            new Date(baseYear, baseMonth, baseDate + 13, baseHour, baseMinutes));
        expect(setResult.success).toBeTruthy();
        BadIdTournament = setResult.id;

        // Petit sleep pour s'éloigner du départ
        await sleep(100);
        // Inscription team 1/4
        let status: status = await database.tournamentRegistration(BadIdTournament, team_one_id);
        expect(status.success).toBeTruthy();

        // Test inscription doublons
        status = await database.tournamentRegistration(BadIdTournament, team_one_id);
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("Team already registered!");

        // Inscription team 2/4
        status = await database.tournamentRegistration(BadIdTournament, team_two_id);
        expect(status.success).toBeTruthy();

        // Inscription team 3/4
        status = await database.tournamentRegistration(BadIdTournament, team_three_id);
        expect(status.success).toBeTruthy();

        // Inscription team 4/4
        status = await database.tournamentRegistration(BadIdTournament, team_four_id);
        expect(status.success).toBeTruthy();

        // Inscription team 5/4
        status = await database.tournamentRegistration(BadIdTournament, team_five_id);
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("Tournament does not exist or is full!");

        // Désinscription team pas inscrite
        status = await database.tournamentUnregistration(BadIdTournament, team_five_id);
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("This team is not register to this tournament!");

        // Désinscription team id éroné
        status = await database.tournamentUnregistration(BadIdTournament, -1);
        expect(status.success).toBeFalsy();

        // Désinscription tournois id éroné
        status = await database.tournamentUnregistration(-1, team_one_id);
        expect(status.success).toBeFalsy();

        // Désinscription après close_registration
        //      Sleep pour attendre la fin des inscriptions
        await sleep(3000);
        //      Test désinscription
        status = await database.tournamentUnregistration(BadIdTournament, team_one_id);
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("We are out of the registration period !")

        // Test avec user éroné
        setResult = await database.createTournament(
            nameTournamentTest,
            "Je suis une description sans importance.",
            'SIMPLE',
            8,
            -1,
            new Date(baseYear, baseMonth, baseDate, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 12, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 13, baseHour, baseMinutes));
        expect(setResult.success).toBeFalsy();
        expect(setResult.error).toEqual("User does not exist!");

        // Test création de tournois avec nom trop court
        setResult = await database.createTournament(
            "az",
            "Je suis une description sans importance.",
            'SIMPLE',
            8,
            owner_id,
            new Date(baseYear, baseMonth, baseDate, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 5, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 12, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 13, baseHour, baseMinutes));
        expect(setResult.success).toBeFalsy();
        expect(setResult.error).toEqual("Tournament name must be at least 5 characters!");

        // Test création de tournois avec nom trop long
        setResult = await database.createTournament(
            "123456789012345678901234567890",
            "Je suis une description sans importance.",
            'SIMPLE',
            8,
            owner_id,
            new Date(baseYear, baseMonth, baseDate, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 5, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 12, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 13, baseHour, baseMinutes));
        expect(setResult.success).toBeFalsy();
        expect(setResult.error).toEqual("Tournament name cannot exceed 25 characters!");

        // Test création de tournois avec taille invalide
        setResult = await database.createTournament(
            nameTournamentTest,
            "Je suis une description sans importance.",
            'SIMPLE',
            -1,
            owner_id,
            new Date(baseYear, baseMonth, baseDate, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 5, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 12, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 13, baseHour, baseMinutes));
        expect(setResult.success).toBeFalsy();
        expect(setResult.error).toEqual("The size of the tournament must be at least for 4 teams!");

        // Test création de tournois avec start_visibility dans le passé
        setResult = await database.createTournament(
            nameTournamentTest,
            "Je suis une description sans importance.",
            'SIMPLE',
            8,
            owner_id,
            new Date(baseYear - 1, baseMonth, baseDate, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 5, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 12, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 13, baseHour, baseMinutes));
        expect(setResult.success).toBeFalsy();
        expect(setResult.error).toEqual("You cannot setup a date in the past !");

        // Test création de tournoi avec ouverture inscription dans le passé
        setResult = await database.createTournament(
            nameTournamentTest,
            "Je suis une description sans importance.",
            'SIMPLE',
            8,
            owner_id,
            new Date(baseYear, baseMonth, baseDate, baseHour, baseMinutes),
            new Date(baseYear - 1, baseMonth, baseDate + 5, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 12, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 13, baseHour, baseMinutes));
        expect(setResult.success).toBeFalsy();
        expect(setResult.error).toEqual("You cannot setup a date in the past !");

        // Test création de tournoi avec une fermeture d'inscription avant l'ouverture
        setResult = await database.createTournament(
            nameTournamentTest,
            "Je suis une description sans importance.",
            'SIMPLE',
            8,
            owner_id,
            new Date(baseYear, baseMonth, baseDate, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 5, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 13, baseHour, baseMinutes));
        expect(setResult.success).toBeFalsy();
        expect(setResult.error).toEqual("You cannot setup the close registration date before or at the same time as the open registration date or the start of the visibility of the tournament!");

        // Test création de tournoi avec un début avant la fin des inscriptions
        setResult = await database.createTournament(
            nameTournamentTest,
            "Je suis une description sans importance.",
            'SIMPLE',
            8,
            owner_id,
            new Date(baseYear, baseMonth, baseDate, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 5, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 12, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 3, baseHour, baseMinutes));
        expect(setResult.success).toBeFalsy();
        expect(setResult.error).toEqual("You cannot start the tournament before the close registration date!");

        //      Init tournois à édit
        const visibility = new Date(baseYear, baseMonth, baseDate + 3, baseHour, baseMinutes);
        const open_registration = new Date(baseYear, baseMonth, baseDate + 5, baseHour, baseMinutes);
        const close_registration = new Date(baseYear, baseMonth, baseDate + 12, baseHour, baseMinutes);
        const start = new Date(baseYear, baseMonth, baseDate + 13, baseHour, baseMinutes);
        setResult = await database.createTournament(
            nameTournamentTest,
            "Je suis une description sans importance.",
            'SIMPLE',
            8,
            owner_id,
            visibility,
            open_registration,
            close_registration,
            start
            );
        expect(setResult.success).toBeTruthy();
        const idEditTournament = setResult.id;
        BadEditTournament = idEditTournament;

        // Test edit name too short
        // "" vaut null
        status = await database.editTournament(idEditTournament, "");
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("Nothing to update!");
        status = await database.editTournament(idEditTournament, "az");
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("Tournament name must be at least 5 characters!");

        // Test edit name too long
        status = await database.editTournament(idEditTournament, "123456789012345678901234567890");
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("Tournament name cannot exceed 25 characters!");

        // Test edit wrong size
        status = await database.editTournament(idEditTournament, null, null, null, -1);
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("The size of the tournament must be at least for 4 teams!");
        // 0 vaut null
        status = await database.editTournament(idEditTournament, null, null, null, 0);
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("Nothing to update!");
        status = await database.editTournament(idEditTournament, null, null, null, 1);
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("The size of the tournament must be at least for 4 teams!");

        // Test edit visibility in the past
        tmp_date = new Date(now);
        tmp_date.setHours(tmp_date.getHours() - 1);
        status = await database.editTournament(idEditTournament, null, null, null, null, tmp_date);
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("Start_visibility cannot be set in the past!");

        // Test edit open registration in the past
        status = await database.editTournament(idEditTournament, null, null, null, null, null, tmp_date);
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("The opening of registration cannot be set in the past !");

        // Test edit visibility after closure
        tmp_date = new Date(close_registration);
        tmp_date.setMinutes(tmp_date.getMinutes() + 1);
        status = await database.editTournament(idEditTournament, null, null, null, null, tmp_date);
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("Start_visibility cannot be set after the closure of the registration!");

        // Test edit open registration after closure
        status = await database.editTournament(idEditTournament, null, null, null, null, null, tmp_date);
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("The opening of registration cannot be set after the closure!");

        // Test edit close registration before visibility
        //      Déplacement de open avant visibility sinon mauvais déclencheur
        tmp_date = new Date(visibility);
        tmp_date.setHours(tmp_date.getHours() - 1)
        status = await database.editTournament(idEditTournament, null, null, null, null, null, tmp_date);
        expect(status.success).toBeTruthy();

        //      Test
        tmp_date = new Date(visibility);
        tmp_date.setMinutes(tmp_date.getMinutes() - 1);
        status = await database.editTournament(idEditTournament, null, null, null, null, null, null, tmp_date);
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("The closure cannot be set before the start of the visibility of the tournament");

        //      Reset open registration
        status = await database.editTournament(idEditTournament, null, null, null, null, null, open_registration);
        expect(status.success).toBeTruthy();

        // Test edit close registration before open_registration
        tmp_date = new Date(open_registration);
        tmp_date.setMinutes(tmp_date.getMinutes() - 1);
        status = await database.editTournament(idEditTournament, null, null, null, null, null, null, tmp_date);
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("The closure cannot be set before the opening!");

        // Test edit close registration after the start
        tmp_date = new Date(start);
        tmp_date.setMinutes(tmp_date.getMinutes() + 1);
        status = await database.editTournament(idEditTournament, null, null, null, null, null, null, tmp_date);
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("The closure of the registration cannot be set after the start of the tournament!");

        // Test edit start tournament before the close registration
        tmp_date = new Date(close_registration);
        tmp_date.setMinutes(tmp_date.getMinutes() - 1);
        status = await database.editTournament(idEditTournament, null, null, null, null, null, null, null, tmp_date);
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("The start of the tournament cannot be set before the start of the tournament!");

        // Test récupération avec id de tournois éroné
        let getTeams: getTeams = await database.getRegisterTeams(-1);
        expect(getTeams.success).toBeFalsy();
        expect(getTeams.teams.length).toEqual(0);

        // Test inscription avec id de tournois éroné
        status = await database.tournamentRegistration(-1, team_two_id)
        expect(status.success).toBeFalsy();

        // Test inscription avec id de team éroné
        status = await database.tournamentRegistration(BadIdTournament, -1);
        expect(status.success).toBeFalsy();

        // Test inscription avec paramètres éroné
        status = await database.tournamentRegistration(-1, -1);
        expect(status.success).toBeFalsy();

        // Test double suppression
        //      First
        status = await database.deleteTournament(BadIdTournament);
        expect(status.success).toBeTruthy();
        //      Second
        status = await database.deleteTournament(BadIdTournament);
        expect(status.success).toBeFalsy();

        // Test suppression avec paramètre eroné
        status = await database.deleteTournament(-1);
        expect(status.success).toBeFalsy();
    });
    test("Match and History perfect use", async() => {
        // Init
        // Init variables
        const users: number[] = [];
        const teams: number[] = [];
        const registrations:  number[] = [];
        let setStatus: status & id;
        let status: status;
        let result: status & {result: boolean};

        //      Init user and teams
        for (const name of namesMatchsHistory) {
         setStatus = await database.newUser(name, passwordUser);
         expect(setStatus.success).toBeTruthy();
         users.push(setStatus.id);
         setStatus = await database.createTeam(name, setStatus.id);
         expect(setStatus.success).toBeTruthy();
         teams.push(setStatus.id);
        }
        setStatus = await database.newUser(substituteName, passwordUser)
        expect(setStatus.success).toBeTruthy();
        const substitute: number = setStatus.id;
        status = await database.addTeamMember(substitute, teams[0]);
        expect(status.success).toBeTruthy();

        //      Init Tournament
        let visibility: Date = new Date();
        let open_registration: Date = new Date();
        let close_registration: Date = new Date();
        close_registration.setSeconds(close_registration.getSeconds() + 2);
        let start: Date = new Date(close_registration);
        setStatus = await database.createTournament("Tournois Test", "Premier tournois à tourner", "SIMPLE", 4, users[0], visibility, open_registration, close_registration, start);
        expect(setStatus.success).toBeTruthy();
        MatchHistoryTournament = setStatus.id;

        // Test isTournamentEnded avec un tournois juste initialisé
        result = await database.isTournamentEnded(MatchHistoryTournament);
        expect(result.success).toBeTruthy();
        expect(result.result).toBeFalsy();

        //      Registration
        let setRegistration: status & {id_team_tournament: number, id_user_history: number};
        for (const team of teams) {
            setRegistration = await database.tournamentRegistration(MatchHistoryTournament, team);
            expect(setRegistration.success).toBeTruthy();
            registrations.push(setRegistration.id_team_tournament);
        }
        // Sleep pour attendre la fin des inscriptions
        await sleep(2500);

        // Test lancement de tournois
        let matchs: getMatchs = await database.setupTournament(MatchHistoryTournament);

        // Test isTournamentEnded avec un tournois lancé mais pas terminé
        result = await database.isTournamentEnded(MatchHistoryTournament);
        expect(result.success).toBeTruthy();
        expect(result.result).toBeFalsy();

        // Test Valeur de retour match 1
        expect(matchs.success).toBeTruthy();
        expect(matchs.matchs.length).toEqual(2);
        expect(registrations).toContain(matchs.matchs[0].id_team_tournament_host);
        expect(registrations).toContain(matchs.matchs[0].id_team_tournament_guest);
        expect(matchs.matchs[0].score_host).toEqual(0);
        expect(matchs.matchs[0].score_guest).toEqual(0);
        expect(matchs.matchs[0].victory).toBeNull();
        const match1: Match = matchs.matchs[0];

        // Test fonction getMatchs qui doit renvoyer la même chose !
        const secondMatchs: getMatchs = await database.getMatchs(MatchHistoryTournament);
        expect(matchs).toEqual(secondMatchs);

        // Vérification avec GET match 1
        let getResult: SQLGetResult = await database.get({table: "tournament_match", whereOption: [{column: "tournament_match_id", condition: "=", value: match1.tournament_match_id}]});
        expect(getResult.success).toBeTruthy();
        expect(getResult.result.length).toEqual(1);
        let match: Match = getResult.result[0] as Match;
        expect(matchs.matchs[0]).toEqual(match);

        // Test valeur de retour match 2
        expect(registrations).toContain(matchs.matchs[1].id_team_tournament_host);
        expect(registrations).toContain(matchs.matchs[1].id_team_tournament_guest);
        expect(matchs.matchs[1].score_host).toEqual(0);
        expect(matchs.matchs[1].score_guest).toEqual(0);
        expect(matchs.matchs[0].victory).toBeNull();
        const match2: Match = matchs.matchs[1];

        // Vérification avec GET match 2
        getResult = await database.get({table: "tournament_match", whereOption: [{column: "tournament_match_id", condition: "=", value: match2.tournament_match_id}]});
        expect(getResult.success).toBeTruthy();
        expect(getResult.result.length).toEqual(1);
        match = getResult.result[0] as Match;
        expect(matchs.matchs[1]).toEqual(match);

        // Test Update des scores guest
        status = await database.updateScore(match1.tournament_match_id, 0, 1);
        expect(status.success).toBeTruthy();

        // Vérification update
        getResult = await database.get({table: "tournament_match", whereOption: [{column: "tournament_match_id", condition: "=", value: match1.tournament_match_id}]});
        expect(getResult.success).toBeTruthy();
        expect(getResult.result.length).toEqual(1);
        match = getResult.result[0] as Match;
        expect(match.victory).toBeNull();
        expect(match.score_host).toEqual(0);
        expect(match.score_guest).toEqual(1);

        // Test Update des scores host
        status = await database.updateScore(match2.tournament_match_id, 1, 0);
        expect(status.success).toBeTruthy();

        // Vérification update
        getResult = await database.get({table: "tournament_match", whereOption: [{column: "tournament_match_id", condition: "=", value: match2.tournament_match_id}]});
        expect(getResult.success).toBeTruthy();
        expect(getResult.result.length).toEqual(1);
        match = getResult.result[0] as Match;
        expect(match.victory).toBeNull();
        expect(match.score_host).toEqual(1);
        expect(match.score_guest).toEqual(0);

        // Test update victory for guest
        status = await database.updateScore(match1.tournament_match_id, 0, 2, "guest");
        expect(status.success).toBeTruthy();
        let i: number = 0;
        while (i < registrations.length && match1.id_team_tournament_guest != registrations[i])
            i += 1;
        const final_team1_index = i;

        // Vérification update
        getResult = await database.get({table: "tournament_match", whereOption: [{column: "tournament_match_id", condition: "=", value: match1.tournament_match_id}]});
        expect(getResult.success).toBeTruthy();
        expect(getResult.result.length).toEqual(1);
        match = getResult.result[0] as Match;
        expect(match.victory).toEqual("guest");
        expect(match.score_host).toEqual(0);
        expect(match.score_guest).toEqual(2);

        // Test Update des scores victory host
        status = await database.updateScore(match2.tournament_match_id, 2, 0, "host");
        expect(status.success).toBeTruthy();
        i = 0;
        while (i < registrations.length && match2.id_team_tournament_host != registrations[i])
            i += 1;
        const final_team2_index = i;

        // Vérification update
        getResult = await database.get({table: "tournament_match", whereOption: [{column: "tournament_match_id", condition: "=", value: match2.tournament_match_id}]});
        expect(getResult.success).toBeTruthy();
        expect(getResult.result.length).toEqual(1);
        match = getResult.result[0] as Match;
        expect(match.victory).toEqual("host");
        expect(match.score_host).toEqual(2);
        expect(match.score_guest).toEqual(0);

        // Test du setup next round
        matchs = await database.getMatchs(MatchHistoryTournament, 1);
        expect(matchs.success).toBeTruthy();
        expect(matchs.matchs.length).toEqual(1);
        expect([registrations[final_team1_index], registrations[final_team2_index]]).toContain(matchs.matchs[0].id_team_tournament_host);
        expect([registrations[final_team1_index], registrations[final_team2_index]]).toContain(matchs.matchs[0].id_team_tournament_guest);
        expect(matchs.matchs[0].victory).toBeNull();
        expect(matchs.matchs[0].score_host).toEqual(0);
        expect(matchs.matchs[0].score_guest).toEqual(0);

        // Test isTournamentEnded avec un tournoi en finale
        result = await database.isTournamentEnded(MatchHistoryTournament);
        expect(result.success).toBeTruthy();
        expect(result.result).toBeFalsy();

        // Update victory for host
        status = await database.updateScore(matchs.matchs[0].tournament_match_id, 2, 1, "host");
        expect(status.success).toBeTruthy();
        i = 0;
        while (i < registrations.length && match2.id_team_tournament_host != registrations[i])
            i += 1;
        const winner_team_index: number = i;

        // Test setup next round pour tester la butée
        matchs = await database.setupNextRound(MatchHistoryTournament);
        expect(matchs.success).toBeTruthy();
        expect(matchs.matchs.length).toEqual(0);

        // Test isTournamentEnded avec un tournois terminé
        result = await database.isTournamentEnded(MatchHistoryTournament);
        expect(result.success).toBeTruthy();
        expect(result.result).toBeTruthy();

        // Test positions des historiques
        //      TOP 4
        getResult = await database.get({table: "team_tournament", whereOption: [{column: "position", condition: "=", value: 4}, {column: "id_tournament", condition: "=", value: MatchHistoryTournament}]});
        expect(getResult.success).toBeTruthy();
        expect(getResult.result.length).toEqual(2);
        let teamsHistory: TeamTournament[] = getResult.result as TeamTournament[];
        expect([registrations[final_team1_index], registrations[final_team2_index]]).not.toContain(teamsHistory[0].team_tournament_id);
        expect([registrations[final_team1_index], registrations[final_team2_index]]).not.toContain(teamsHistory[1].team_tournament_id);
        //      TOP 2
        // Set Loser marche pas !!
        getResult = await database.get({table: "team_tournament", whereOption: [{column: "position", condition: "=", value: 2}, {column: "id_tournament", condition: "=", value: MatchHistoryTournament}]});
        expect(getResult.success).toBeTruthy();
        expect(getResult.result.length).toEqual(1);
        teamsHistory = getResult.result as TeamTournament[];
        expect([registrations[final_team1_index], registrations[final_team2_index]]).toContain(teamsHistory[0].team_tournament_id);
        expect(teamsHistory[0].team_tournament_id).not.toEqual(registrations[winner_team_index]);
        //      TOP 1
        getResult = await database.get({table: "team_tournament", whereOption: [{column: "position", condition: "=", value: 1}, {column: "id_tournament", condition: "=", value: MatchHistoryTournament}]});
        expect(getResult.success).toBeTruthy();
        expect(getResult.result.length).toEqual(1);
        teamsHistory = getResult.result as TeamTournament[];
        expect(teamsHistory[0].team_tournament_id).toEqual(registrations[winner_team_index]);

        // Test récupération des historiques par team
        //      Top 1
        let getHistories: getHistories = await database.getTeamHistory(teams[winner_team_index]);
        expect(getHistories.success).toBeTruthy();
        expect(getHistories.histories.length).toEqual(1);
        expect(getHistories.histories[0].team_name).toEqual(namesMatchsHistory[winner_team_index]);
        expect(getHistories.histories[0].position).toEqual(1);
        expect(getHistories.histories[0].id_tournament).toEqual(MatchHistoryTournament);
        expect(getHistories.histories[0].id_team).toEqual(teams[winner_team_index]);
        expect(getHistories.histories[0].team_tournament_id).toEqual(registrations[winner_team_index]);

        // Test récupération des historiques par user
        let secondGetHistories: getHistories = await database.getUserHistory(users[winner_team_index]);
        expect(secondGetHistories.histories).toEqual(getHistories.histories);

        // Test avec deux tournois et switch d'équipe
        status = await database.rmTeamMember(substitute);
        expect(status.success).toBeTruthy();
        status = await database.addTeamMember(substitute, teams[3]);
        expect(status.success).toBeTruthy();

        //      Init Tournament
        visibility = new Date();
        open_registration = new Date();
        close_registration = new Date();
        close_registration.setSeconds(close_registration.getSeconds() + 2);
        start = new Date(close_registration);
        setStatus = await database.createTournament("Tournois Test2", "Premier tournois à tourner", "SIMPLE", 4, users[0], visibility, open_registration, close_registration, start);
        expect(setStatus.success).toBeTruthy();
        MatchHistory2Tournament = setStatus.id;
        //      Registrations
        for (const team of teams) {
            setRegistration = await database.tournamentRegistration(MatchHistory2Tournament, team);
            expect(setRegistration.success).toBeTruthy();
            registrations.push(setRegistration.id_team_tournament);
        }
        // Sleep pour attendre la fin des inscriptions
        await sleep(2500);

        // Exécution du tournoi
        matchs = await database.setupTournament(MatchHistory2Tournament);
        expect(matchs.success).toBeTruthy();
        expect(matchs.matchs.length).toEqual(2);

        // Exécution match 1
        status = await database.updateScore(matchs.matchs[0].tournament_match_id, 5, 2, 'host');
        expect(status.success).toBeTruthy();

        // Exécution match 2
        status = await database.updateScore(matchs.matchs[1].tournament_match_id, 2, 5, 'guest');
        expect(status.success).toBeTruthy();

        // Passage round suivant
        matchs = await database.getMatchs(MatchHistory2Tournament, 1);
        expect(matchs.success).toBeTruthy();
        expect(matchs.matchs.length).toEqual(1);

        // Exécution finale
        status = await database.updateScore(matchs.matchs[0].tournament_match_id, 5, 2, 'host');
        expect(status.success).toBeTruthy();

        // Vérification historique
        getHistories = await database.getUserHistory(substitute);
        expect(getHistories.success).toBeTruthy();
        expect(getHistories.histories.length).toEqual(2);

        secondGetHistories = await database.getTeamHistory(teams[0]);
        expect(secondGetHistories.success).toBeTruthy();
        expect(secondGetHistories.histories.length).toEqual(2);

        // Comparaison des historiques sachant qu'on récupère du plus jeune au plus vieux
        expect(getHistories.histories[1]).toEqual(secondGetHistories.histories[1]);

        secondGetHistories = await database.getTeamHistory(teams[3]);
        expect(secondGetHistories.success).toBeTruthy();
        expect(secondGetHistories.histories.length).toEqual(2);

        // Comparaison des historiques avec la deuxième équipe
        expect(getHistories.histories[0]).toEqual(secondGetHistories.histories[0]);

        // Test soft team delete
        status = await database.softDeleteTeam(teams[0]);
        expect(status.success).toBeTruthy();
        status = await database.softDeleteTeam(teams[3]);
        expect(status.success).toBeTruthy();

        // Les historiques doivent être conservés

        secondGetHistories = await database.getUserHistory(substitute);
        expect(secondGetHistories.success).toBeTruthy();
        expect(secondGetHistories.histories.length).toEqual(2);
        expect(secondGetHistories.histories).toEqual(getHistories.histories);

        // Test hard team delete
        status = await database.hardDeleteTeam(teams[0]);
        expect(status.success).toBeTruthy();
        status = await database.hardDeleteTeam(teams[3]);
        expect(status.success).toBeTruthy();

        // Les historiques doivent disparaitre
        getHistories = await database.getUserHistory(substitute);
        expect(getHistories.success).toBeTruthy();
        expect(getHistories.histories.length).toEqual(0);

        // Test delete tournament
        status = await database.deleteTournament(MatchHistoryTournament);
        expect(status.success).toBeTruthy();

        // Test que les matchs sont bien supprimés
        getResult = await database.get({table: "tournament_match", whereOption: [{column: "id_tournament", condition: "=", value: MatchHistoryTournament}]});
        expect(getResult.success).toBeTruthy();
        expect(getResult.result.length).toEqual(0);

        // Test isTournamentEnded avec un tournois supprimé
        result = await database.isTournamentEnded(MatchHistoryTournament);
        expect(result.success).toBeFalsy();
        expect(result.result).toBeFalsy();

        // Vérification historique. Le tournoi doit disparaitre
        getHistories = await database.getTeamHistory(teams[1]);
        expect(getHistories.success).toBeTruthy();
        expect(getHistories.histories.length).toEqual(1);
        expect(getHistories.histories[0].id_tournament).toEqual(MatchHistory2Tournament);
    }, 10000);
    test("Match and History bad use", async() => {
        // Init
        //   Init variables
        const users: number[] = [];
        const teams: number[] = [];
        let setStatus: status & id;
        let status: status;

        //  Init user
        for (const name of badMatchsHistory) {
            setStatus = await database.newUser(name, passwordUser);
            expect(setStatus.success).toBeTruthy();
            users.push(setStatus.id);
            setStatus = await database.createTeam(name, setStatus.id);
            expect(setStatus.success).toBeTruthy();
            teams.push(setStatus.id);
        }

        //  Init tournament
        let visibility: Date = new Date();
        let open_registration: Date = new Date();
        let close_registration: Date = new Date();
        close_registration.setSeconds(close_registration.getSeconds() + 1);
        let start: Date = new Date(close_registration);
        setStatus = await database.createTournament("Bad tournois test", "Premier mauvais tournois", "SIMPLE", 4, users[0], visibility, open_registration, close_registration, start);
        expect(setStatus.success).toBeTruthy();
        expect(setStatus.id).not.toEqual(-1);
        BadHistoryTournament = setStatus.id;

        // Test lancement next round sans équipe avant start
        let getMatchs: getMatchs = await database.setupNextRound(BadHistoryTournament);
        expect(getMatchs.success).toBeFalsy();

        // Test lancement précoce sans équipe avant start
        getMatchs = await database.setupTournament(BadHistoryTournament);
        expect(getMatchs.success).toBeFalsy();
        expect(getMatchs.error).toEqual("The tournament has not begun!");

        // Attente pour la fin des inscriptions
        await sleep(2000);

        // Test lancement next round sans équipe après start
        getMatchs = await database.setupNextRound(BadHistoryTournament);
        expect(getMatchs.success).toBeTruthy();
        expect(getMatchs.error).toEqual("Tournament has ended!");
        expect(getMatchs.matchs.length).toEqual(0)

        // Test lancement sans équipe après start
        getMatchs = await database.setupTournament(BadHistoryTournament);
        expect(getMatchs.success).toBeFalsy();
        expect(getMatchs.error).toEqual("Tournament has ended!");

        // Reset tournois pour autre tests
        status = await database.deleteTournament(BadHistoryTournament);
        expect(status.success).toBeTruthy();

        // Init nouveau tournois
        visibility = new Date();
        open_registration = new Date();
        close_registration = new Date();
        close_registration.setSeconds(close_registration.getSeconds() + 1);
        start = new Date(close_registration);
        setStatus = await database.createTournament("Tournois Test", "Premier tournois à mal tourner", "SIMPLE", 4, users[0], visibility, open_registration, close_registration, start);
        expect(setStatus.success).toBeTruthy();
        BadHistoryTournament = setStatus.id;

        // Registration
        let setRegistration: status & {id_team_tournament: number, id_user_history: number};
        for (const team of teams) {
            setRegistration = await database.tournamentRegistration(BadHistoryTournament, team);
            expect(setRegistration.success).toBeTruthy();
        }

        // Start précoce avec équipe
        getMatchs = await database.setupTournament(BadHistoryTournament);
        expect(getMatchs.success).toBeFalsy();
        expect(getMatchs.error).toEqual("The tournament has not begun!");

        // Setup next round before start
        getMatchs = await database.setupNextRound(BadHistoryTournament);
        expect(getMatchs.success).toBeFalsy();
        expect(getMatchs.error).toEqual("This tournament have not start yet !");

        // On attends le start
        await sleep(2000);

        // Setup next round before setup tournament
        getMatchs = await database.setupNextRound(BadHistoryTournament);
        expect(getMatchs.success).toBeFalsy();
        expect(getMatchs.error).toEqual("This tournament have not start yet !");

        // Test setup avec paramètre éroné
        getMatchs = await database.setupTournament(-1);
        expect(getMatchs.success).toBeFalsy();
        expect(getMatchs.error).toEqual("This tournament does not exist!");

        // Setup tournois
        getMatchs = await database.setupTournament(BadHistoryTournament);
        expect(getMatchs.success).toBeTruthy();
        expect(getMatchs.matchs.length).toEqual(2);

        // Double setup
        getMatchs = await database.setupTournament(BadHistoryTournament);
        expect(getMatchs.success).toBeFalsy();
        expect(getMatchs.error).toEqual("The tournament has already started!");

        // Test setupNextRound après le setup
        getMatchs = await database.setupNextRound(BadHistoryTournament);
        expect(getMatchs.success).toBeFalsy();

        // Test update Score avec paramètre éroné
        status = await database.updateScore(-1, 5, 2, "host");
        expect(status.success).toBeFalsy();

        // Update score
        //      Récupération des matchs
        getMatchs = await database.getMatchs(BadHistoryTournament);
        expect(getMatchs.success).toBeTruthy();
        expect(getMatchs.matchs.length).toEqual(2);
        //      Test update score
        status = await database.updateScore(getMatchs.matchs[0].tournament_match_id, 5, 2, "host");
        expect(status.success).toBeTruthy();

        // Redéfinition score après définir le vainqueur
        status = await database.updateScore(getMatchs.matchs[0].tournament_match_id, 2, 5);
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("Match does not exist or is ended!");

        // Redéfinition vainqueur
        status = await database.updateScore(getMatchs.matchs[0].tournament_match_id, 5, 2, "guest");
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("Match does not exist or is ended!");

        // Test Get matchs avec paramètre id_tournament éroné
        getMatchs = await database.getMatchs(-1);
        expect(getMatchs.success).toBeFalsy();
        expect(getMatchs.error).toEqual("Tournament does not exist!");

        // Test get matchs avec paramètre nbFromLast car doit être positif
        // nbFromLast est neutralisé si inférieur ou égale à 0 pas d'erreur renvoyé
        getMatchs = await database.getMatchs(BadHistoryTournament, -1000);
        expect(getMatchs.success).toBeTruthy();
        expect(getMatchs.matchs.length).toEqual(2);

        // Test setup next round avant la fin des matchs
        getMatchs = await database.setupNextRound(BadHistoryTournament);
        expect(getMatchs.success).toBeFalsy();
        expect(getMatchs.error).toEqual("All match has not ended!");

        // Définition vainqueur pour continuation des tests
        //  Récupération des matchs
        getMatchs = await database.getMatchs(BadHistoryTournament);
        expect(getMatchs.success).toBeTruthy();
        expect(getMatchs.matchs.length).toEqual(2);
        //  Définition du vainqueur match 2
        status = await database.updateScore(getMatchs.matchs[1].tournament_match_id, 1, 3, "guest");
        expect(status.success).toBeTruthy();

        // Setup Next round avec paramètre éroné
        getMatchs = await database.setupNextRound(-1);
        expect(getMatchs.success).toBeFalsy();

        // Setup next round
        getMatchs = await database.getMatchs(BadHistoryTournament, 1);
        expect(getMatchs.success).toBeTruthy();
        expect(getMatchs.matchs.length).toEqual(1);

        // Test isTournamentEnded
        let result: status & {result: boolean};
        //  Test isTournamentEnded avec paramètre éroné
        result = await database.isTournamentEnded(-1);
        expect(result.success).toBeFalsy();

        // Test récupération historique team avec paramètre éroné
        let getHistories: getHistories = await database.getTeamHistory(-1)
        expect(getHistories.success).toBeFalsy();

        // Test récupération historique utilisateur avec paramètre éroné
        getHistories = await database.getUserHistory(-1);
        expect(getHistories.success).toBeFalsy();
    }, 10000);
    afterAll(async () => {
        const database: Database = await Database.getInstance();
        const delUser: UserEntity = new UserEntity();
        const delTeam: TeamEntity = new TeamEntity();
        const delTournament: TournamentEntity = new TournamentEntity();

        // Nettoyage Partie Primaire

        // Nettoyage Partie User Perfect
        let status: status = await delUser.fetch(nameUserManagement);
        if (status.success)
            await delUser.delete();

        // Nettoyage Partie User Bad
        status = await delUser.fetch(badUserManagement);
        if (status.success)
            await delUser.delete();
        status = await delUser.fetch(nameAlreadyUsed);
        if (status.success)
            await delUser.delete();

        // Nettoyage Partie Team Perfect
        status = await delTeam.fetch(nameTeamManagement);
        if (status.success)
            await delTeam.hardDelete();
        status = await delTeam.fetch(name2TeamManagement);
        if (status.success)
            await delTeam.hardDelete();
        status = await delUser.fetch(nameTeamManagement);
        if (status.success)
            await delUser.delete();
        status = await delUser.fetch(name2TeamManagement);
        if (status.success)
            await delUser.delete();
        console.log(nameTeamManagement);
        console.log(name2TeamManagement);

        // Nettoyage Partie Team Bad
        status = await delTeam.fetch(badTeamManagement);
        if (status.success)
            await delTeam.hardDelete();
        status = await delUser.fetch(badTeamManagement);
        if (status.success)
            await delUser.delete();
        status = await delUser.fetch(bad2TeamManagement);
        if (status.success)
            await delUser.delete();
        status = await delUser.fetch(bad3TeamManagement);
        if (status.success)
            await delUser.delete();

        // Nettoyage Partie Tournois Perfect
        if (idTournament) {
            status = await delTournament.fetch(idTournament);
            if (status.success)
                await delTournament.delete();
        }
        status = await delTeam.fetch(teamTournamentTest);
        if (status.success)
            await delTeam.hardDelete();
        status = await delTeam.fetch(nameTournamentTest);
        if (status.success)
            await delTeam.hardDelete();
        status = await delUser.fetch(nameTournamentTest);
        if (status.success)
            await delUser.delete();
        status = await delUser.fetch(teamTournamentTest);
        if (status.success)
            await delUser.delete();

        // Nettoyage Partie Tournois Bad
        if (BadIdTournament) {
            status = await delTournament.fetch(BadIdTournament);
            if (status.success)
                await delTournament.delete();
        }
        if (BadEditTournament) {
            status = await delTournament.fetch(BadEditTournament);
            if (status.success)
                await delTournament.delete();
        }
        status = await delTeam.fetch(BadTournamentTest);
        if (status.success)
            await delTeam.hardDelete();
        status = await delTeam.fetch(Bad2TournamentTest);
        if (status.success)
            await delTeam.hardDelete();
        status = await delTeam.fetch(Bad3TournamentTest);
        if (status.success)
            await delTeam.hardDelete();
        status = await delTeam.fetch(Bad4TournamentTest);
        if (status.success)
            await delTeam.hardDelete();
        status = await delTeam.fetch(Bad5TournamentTest);
        if (status.success)
            await delTeam.hardDelete();
        status = await delUser.fetch(BadTournamentTest);
        if (status.success)
            await delUser.delete();
        status = await delUser.fetch(Bad2TournamentTest);
        if (status.success)
            await delUser.delete();
        status = await delUser.fetch(Bad3TournamentTest);
        if (status.success)
            await delUser.delete();
        status = await delUser.fetch(Bad4TournamentTest);
        if (status.success)
            await delUser.delete();
        status = await delUser.fetch(Bad5TournamentTest);
        if (status.success)
            await delUser.delete();

        // Nettoyage Partie Match & History Perfect
        if (MatchHistoryTournament) {
            status = await delTournament.fetch(MatchHistoryTournament);
            if (status.success)
                await delTournament.delete();
        }
        if (MatchHistory2Tournament) {
            status = await delTournament.fetch(MatchHistory2Tournament);
            if (status.success)
                await delTournament.delete();
        }
        for (const name of namesMatchsHistory) {
            status = await delTeam.fetch(name);
            if (status.success)
                await delTeam.hardDelete();
            status = await delUser.fetch(name);
            if (status.success)
                await delUser.delete();
        }
        status = await delUser.fetch(substituteName);
        if (status.success)
            await delUser.delete();

        // Nettoyage Partie Match & History bad
        if (BadHistoryTournament){
            status = await delTournament.fetch(BadHistoryTournament);
            if (status.success)
                await delTournament.delete();
        }
        for (const name of badMatchsHistory) {
            status = await delTeam.fetch(name);
            if (status.success)
                await delTeam.hardDelete();
            status = await delUser.fetch(name);
            if (status.success)
                await delUser.delete();
        }

        // Fermeture de la base de donnée
        await Database.disconnect();
    });
});