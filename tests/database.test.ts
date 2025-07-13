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
    getMatchs,
} from "../lib/types";
import {sleep} from "../lib/tools/sleep";
import {UserEntity} from "../lib/database/UserEntity";
import {TournamentEntity} from "../lib/database/TournamentEntity";
import { TeamEntity } from "../lib/database/TeamEntity";
import { MatchEntity } from "../lib/database/MatchEntity";

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

        // Test fetch ID
        let status: status = await team.fetch(team.id!);
        expect(status.success).toBeTruthy();
        expect(team.name).toEqual(name2TeamManagement);
        expect(team.id_user).toEqual(user.id);

        // Test fetch Name
        status = await team.fetch(team.name!);
        expect(status.success).toBeTruthy();
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
        status = await user.fetch(user.id!);
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
        const user: UserEntity = new UserEntity();
        let setUserResult: status & id = await user.new(badTeamManagement, passwordUser);
        expect(setUserResult.success).toBeTruthy();
        expect(setUserResult.id).not.toEqual(-1);

        //      User 2
        const user2: UserEntity = new UserEntity();
        setUserResult = await user2.new(bad2TeamManagement, passwordUser);
        expect(setUserResult.success).toBeTruthy();
        expect(setUserResult.id).not.toEqual(-1);

        //      User 3
        const user3: UserEntity = new UserEntity();
        setUserResult = await user3.new(bad3TeamManagement, passwordUser);
        expect(setUserResult.success).toBeTruthy();
        expect(setUserResult.id).not.toEqual(-1);

        //      Test Team
        const team: TeamEntity = new TeamEntity();
        let setTeamResult: status & id = await team.create(badTeamManagement, user);
        expect(setTeamResult.success).toBeTruthy();
        expect(setTeamResult.id).not.toEqual(-1);

        //      Test Team 2
        const team2: TeamEntity = new TeamEntity();
        setTeamResult = await team2.create(bad2TeamManagement, user2);
        expect(setTeamResult.success).toBeTruthy();
        expect(setTeamResult.id).not.toEqual(-1);

        // Test fetch ID eroné
        const errorTeam: TeamEntity = new TeamEntity();
        let status: status = await errorTeam.fetch(-1);
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("This team does not exist!");
        expect(errorTeam.is_loaded).toEqual(false);

        // Test fetch Name éroné
        status = await errorTeam.fetch(" ");
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("This team does not exist!");
        expect(errorTeam.is_loaded).toEqual(false);

        // Vérification status avec id éroné
        let checkOwnerShip: status & {result: number} = await TeamEntity.isTeamOwner(new UserEntity());
        expect(checkOwnerShip.success).toBeFalsy();
        expect(checkOwnerShip.error).toEqual("Broken user!");
        expect(checkOwnerShip.result).toEqual(-1);

        // Test création avec utilisateur broken
        const errorUser: UserEntity = new UserEntity();
        setTeamResult = await errorTeam.create(badTeamManagement, errorUser);
        expect(setTeamResult.success).toBeFalsy();
        expect(setTeamResult.error).toEqual("Parameter owner does not exist or badly constructed");
        expect(setTeamResult.id).toEqual(-1);

        // Test création avec utilisateur inconnu
        status = await errorUser.fetch(user.id!);
        expect(status.success).toBeTruthy();
        errorUser.id = -1;
        errorUser.name = " ";
        setTeamResult = await errorTeam.create(badTeamManagement, errorUser);
        expect(setTeamResult.success).toBeFalsy();
        expect(setTeamResult.error).toEqual("Parameter owner does not exist or badly constructed");
        expect(setTeamResult.id).toEqual(-1);

        // Test création avec nom trop court
        setTeamResult = await errorTeam.create("", user3);
        expect(setTeamResult.success).toBeFalsy();
        expect(setTeamResult.error).toEqual("The name must be at least 3 characters and maximum 15!");
        expect(setTeamResult.id).toEqual(-1);
        setTeamResult = await errorTeam.create("az", user3);
        expect(setTeamResult.success).toBeFalsy();
        expect(setTeamResult.error).toEqual("The name must be at least 3 characters and maximum 15!");
        expect(setTeamResult.id).toEqual(-1);

        // Test création avec nom trop long
        setTeamResult = await errorTeam.create("1234567890123456", user3);
        expect(setTeamResult.success).toBeFalsy();
        expect(setTeamResult.error).toEqual("The name must be at least 3 characters and maximum 15!");
        expect(setTeamResult.id).toEqual(-1);

        // Test création d'équipe en doublons
        const sameTeamName: status & id = await errorTeam.create(badTeamManagement, user3);
        expect(sameTeamName.success).toBeFalsy();
        expect(sameTeamName.error).toEqual("Team name already exist !");
        expect(sameTeamName.id).toEqual(-1);

        // Test rename avec nom déjà pris
        status = await team2.rename(badTeamManagement);
        expect(status.success).toBeFalsy();

        // Test rename avec nom trop court
        status = await team2.rename("");
        expect(status.success).toBeFalsy();
        status = await team2.rename("az");
        expect(status.success).toBeFalsy();

        // Test rename avec nom trop long
        status = await team2.rename("1234567890123456");
        expect(status.success).toBeFalsy();

        // Test ajout de membre avec paramètre user cassé
         status = await team.addMember(errorUser);
        expect(status.success).toBeFalsy();

        // Test ajout de l'owner dans sa propre équipe
        status = await team.addMember(user);
        expect(status.success).toBeFalsy();

        // Test ajout double invitation
        //      Invitation fonctionnelle
        status = await team.addMember(user3);
        expect(status.success).toBeTruthy();
        //      Invitation non fonctionnelle
        status = await team.addMember(user3);
        expect(status.success).toBeFalsy();

        status = await team2.hardDelete();
        expect(status.success).toBeTruthy();

        // Test give ownership à un utilisateur hors équipe
        status = await team.giveOwnership(user, user2);
        expect(status.success).toBeFalsy();

        // Test give owner à l'owner
        status = await team.giveOwnership(user, user);
        expect(status.success).toBeTruthy(); // Ne se passe rien mais génère pas d'erreur donc OK

        // Test give non owner à lui-même
        status = await team.giveOwnership(user3, user3);
        expect(status.success).toBeFalsy();

        // Test owner éroné
        status = await team.giveOwnership(errorUser, user2);
        expect(status.success).toBeFalsy();

        // Test new_owner éroné
        status = await team.giveOwnership(user, errorUser);
        expect(status.success).toBeFalsy();

        // Test double éroné
        status = await team.giveOwnership(errorUser, errorUser);
        expect(status.success).toBeFalsy();

        // Ajout user3 pour plus de tests
        status = await team.addMember(user2);
        expect(status.success).toBeTruthy();

        // Test non owner à other non owner
        status = await team.giveOwnership(user2, user3);
        expect(status.success).toBeFalsy();

        // Test récupération des membres avec classe broken
        let teamMembers : getTeamMembers = await errorTeam.getMembers();
        expect(teamMembers.success).toBeFalsy();

        // Test kick avec entrée cassé
        status = await team.rmMember(errorUser);
        expect(status.success).toBeFalsy();

        // Test kick owner
        status = await team.rmMember(user);
        expect(status.success).toBeFalsy();

        // Test suppression avec paramètre éroné
        status = await errorTeam.hardDelete();
        expect(status.success).toBeFalsy();
    });
    test("Tournament Management perfect use", async() => {
        // Init Test variables

        //      Init Users
        const user: UserEntity = new UserEntity();
        let setResult: status & id = await user.new(nameTournamentTest, passwordUser);
        expect(setResult.success).toBeTruthy();
        const user2: UserEntity = new UserEntity();
        setResult = await user2.new(teamTournamentTest, passwordUser);
        expect(setResult.success).toBeTruthy();

        //      Init Teams
        const team: TeamEntity = new TeamEntity();
        setResult = await team.create(nameTournamentTest, user);
        expect(setResult.success).toBeTruthy();
        const team2: TeamEntity = new TeamEntity();
        setResult = await team2.create(teamTournamentTest, user2);
        expect(setResult.success).toBeTruthy();

        // Init settings tournament
        const visibility = new Date(baseYear, baseMonth, baseDate, baseHour + 1, baseMinutes);
        const open_registration = new Date(baseYear, baseMonth, baseDate + 5, baseHour, baseMinutes);
        const close_registration = new Date(baseYear, baseMonth, baseDate + 12, baseHour, baseMinutes);
        const start = new Date(baseYear, baseMonth, baseDate + 13, baseHour, baseMinutes);
        const description: string = "Je suis une description sans importance.";
        const format: 'SIMPLE' | 'DOUBLE' | null = 'SIMPLE';
        const size: number = 8;

        // Test création de tournois
        const tournament: TournamentEntity = new TournamentEntity();
        setResult = await tournament.create(
            nameTournamentTest,
            description,
            format,
            size,
            user,
            visibility,
            open_registration,
            close_registration,
            start);
        expect(setResult.success).toBeTruthy();
        idTournament = setResult.id;
        expect(tournament.name).toEqual(nameTournamentTest);
        expect(tournament.description).toEqual(description);
        expect(tournament.format).toEqual(format);
        expect(tournament.size).toEqual(size);
        expect(tournament.owner!.id!).toEqual(user.id);
        expect(tournament.creation_date).not.toBeUndefined();
        if (!tournament.creation_date)
            throw "Erreur !";
        expect(tournament.creation_date.getTime() - now.getTime()).toBeLessThanOrEqual(5000);
        expect(tournament.start_visibility?.getTime()).toEqual(visibility.getTime());
        expect(tournament.open_registration?.getTime()).toEqual(open_registration.getTime());
        expect(tournament.close_registration?.getTime()).toEqual(close_registration.getTime());
        expect(tournament.start?.getTime()).toEqual(start.getTime());

        let copyTournament: TournamentEntity = new TournamentEntity(tournament);
        let status: status = await tournament.fetch(tournament.id!);
        expect(status.success).toBeTruthy();
        expect(tournament.compare(copyTournament)).toBeTruthy()
        const OGTournament: TournamentEntity = new TournamentEntity(tournament);

        // Test edit name
        status = await tournament.edit(teamTournamentTest);
        expect(status.success).toBeTruthy();
        expect(tournament.name).toEqual(teamTournamentTest);

        // Vérification edit name
        copyTournament = new TournamentEntity(tournament);
        status = await tournament.fetch(tournament.id!);
        expect(status.success).toBeTruthy();
        expect(tournament.compare(copyTournament)).toBeTruthy();

        // Test edit description et retour OG name
        status = await tournament.edit(nameTournamentTest, description.toUpperCase());
        expect(status.success).toBeTruthy();
        expect(tournament.name).toEqual(nameTournamentTest);
        expect(tournament.description).toEqual(description.toUpperCase());

        // Vérification edit description et nom
        copyTournament = new TournamentEntity(tournament);
        status = await tournament.fetch(tournament.id!);
        expect(status.success).toBeTruthy();
        expect(tournament.compare(copyTournament)).toBeTruthy();

        // Test edit format et retour description
        status = await tournament.edit(null, description, "DOUBLE");
        expect(status.success).toBeTruthy();
        expect(tournament.description).toEqual(description);
        expect(tournament.format).toEqual("DOUBLE");

        // Vérification edit format
        copyTournament = new TournamentEntity(tournament);
        status = await tournament.fetch(tournament.id!);
        expect(status.success).toBeTruthy();
        expect(tournament.compare(copyTournament)).toBeTruthy();

        // Test edit size et retour format
        status = await tournament.edit(null, null, format, 4);
        expect(status.success).toBeTruthy();
        expect(tournament.format).toEqual(format);
        expect(tournament.size).toEqual(4);

        // Vérification edit size et format
        copyTournament = new TournamentEntity(tournament);
        status = await tournament.fetch(tournament.id!);
        expect(status.success).toBeTruthy();
        expect(tournament.compare(copyTournament)).toBeTruthy();

        // Test edit start_visibility et retour size
        let tmp_date: Date = new Date(visibility);
        tmp_date.setHours(tmp_date.getHours() + 1);
        status = await tournament.edit(null, null, null, size, tmp_date);
        expect(status.success).toBeTruthy();
        expect(tournament.size).toEqual(size);
        expect(tournament.start_visibility?.getTime()).toEqual(tmp_date.getTime());

        // Vérification edit start_visibility et retour size
        copyTournament = new TournamentEntity(tournament);
        status = await tournament.fetch(tournament.id!);
        expect(status.success).toBeTruthy();
        expect(tournament.compare(copyTournament)).toBeTruthy();

        // Test edit open_registration et retour start_visibility
        tmp_date = new Date(open_registration);
        tmp_date.setHours(open_registration.getHours() - 1);
        status = await tournament.edit(null, null, null, null, visibility, tmp_date);
        expect(status.success).toBeTruthy();
        expect(tournament.start_visibility?.getTime()).toEqual(visibility.getTime());
        expect(tournament.open_registration?.getTime()).toEqual(tmp_date.getTime());

        // Vérification edit open_registration et retour start_visibility
        copyTournament = new TournamentEntity(tournament);
        status = await tournament.fetch(tournament.id!);
        expect(status.success).toBeTruthy();
        expect(tournament.compare(copyTournament)).toBeTruthy();

        // Test edit close_registration et retour open_registration
        tmp_date = new Date(close_registration);
        tmp_date.setHours(close_registration.getHours() + 10);
        status = await tournament.edit(null, null, null, null, null, open_registration, tmp_date);
        expect(status.success).toBeTruthy();
        expect(tournament.open_registration?.getTime()).toEqual(open_registration.getTime());
        expect(tournament.close_registration?.getTime()).toEqual(tmp_date.getTime());

        // Vérification edit close_registration et retour open_registration
        copyTournament = new TournamentEntity(tournament);
        status = await tournament.fetch(tournament.id!);
        expect(status.success).toBeTruthy();
        expect(tournament.compare(copyTournament)).toBeTruthy();

        // Test edit start et retour close_registration
        tmp_date = new Date(start);
        tmp_date.setHours(start.getHours() + 8);
        status = await tournament.edit(null, null, null, null, null, null, close_registration, tmp_date);
        expect(status.success).toBeTruthy();
        expect(tournament.close_registration?.getTime()).toEqual(close_registration.getTime());
        expect(tournament.start?.getTime()).toEqual(tmp_date.getTime());

        // Vérification edit start et retour close_registration
        copyTournament = new TournamentEntity(tournament);
        status = await tournament.fetch(tournament.id!);
        expect(status.success).toBeTruthy();
        expect(tournament.compare(copyTournament)).toBeTruthy();

        // Test edit retour close_registration
        status = await tournament.edit(null, null, null, null, null, null, null, start);
        expect(status.success).toBeTruthy();

        // Vérification edit retour OG
        expect(tournament.compare(OGTournament)).toBeTruthy();

        // Ouverture des inscriptions pour les tests
        status = await tournament.edit(null, null, null, null, null, now);
        expect(status.success).toBeTruthy();

        //      Pour éviter un problème d'égalité avec les périodes d'inscriptions et les inscriptions
        await sleep(1000);

        // Test inscription
        status = await tournament.registration(team);
        expect(status.success).toBeTruthy();

        // Inscription deuxième équipe
        status = await tournament.registration(team2);
        expect(status.success).toBeTruthy();

        // Vérification inscription par getRegisterTeams
        let getTeams : getTournamentTeams = await tournament.getRegisterTeams();
        expect(getTeams.success).toBeTruthy();
        expect(getTeams.teams.length).toEqual(2);

        // Vérification inscription par récupération des historiques teams
        let getHistories: getHistories = await team.getHistory();
        expect(getHistories.success).toBeTruthy();
        expect(getHistories.histories.length).toEqual(1);

        // Vérification inscription par récupération des historiques utilisateurs
        let userHistory: getHistories = await user.getHistory();
        expect(userHistory.success).toBeTruthy();
        expect(userHistory.histories.length).toEqual(1);
        expect(getHistories.histories).toEqual(userHistory.histories);

        // Test désinscription
        status = await tournament.unregistration(team2);
        expect(status.success).toBeTruthy();

        // Vérification désinscription par getRegisterTeams
        getTeams = await tournament.getRegisterTeams();
        expect(getTeams.success).toBeTruthy();
        expect(getTeams.teams.length).toEqual(1);

        // Vérification désinscription par récupération des historiques teams
        getHistories = await team2.getHistory();
        expect(getHistories.success).toBeTruthy();
        expect(getHistories.histories.length).toEqual(0);

        // Vérification désinscription par récupération des historiques utilisateurs
        userHistory = await user2.getHistory();
        expect(userHistory.success).toBeTruthy();
        expect(userHistory.histories.length).toEqual(0);

        // Réinscription pour test suppression de tournois
        // Inscription deuxième équipe
        status = await tournament.registration(team2);
        expect(status.success).toBeTruthy();

        // Test suppression
        status = await tournament.delete();
        expect(status.success).toBeTruthy();

        // Vérification suppression par getTeams
        getTeams = await tournament.getRegisterTeams();
        expect(getTeams.success).toBeFalsy();
        expect(getTeams.teams.length).toEqual(0);

        // Vérification suppression du tournoi par historique des équipes
        getHistories = await team.getHistory();
        expect(getHistories.success).toBeTruthy();
        expect(getHistories.histories.length).toEqual(0);

        // Vérification suppression du tournoi par historique des équipes
        getHistories = await team2.getHistory();
        expect(getHistories.success).toBeTruthy();
        expect(getHistories.histories.length).toEqual(0);

        // Vérification suppression du tournoi par historique des utilisateurs
        getHistories = await user2.getHistory();
        expect(getHistories.success).toBeTruthy();
        expect(getHistories.histories.length).toEqual(0);

        // Vérification suppression du tournoi par historique des utilisateurs
        getHistories = await user2.getHistory();
        expect(getHistories.success).toBeTruthy();
        expect(getHistories.histories.length).toEqual(0);

        // Test inscription tournoi supprimé
        status = await tournament.registration(team);
        expect(status.success).toBeFalsy();
    });
    test("Tournament Management bad use", async() => {
        // Init Test variables

        //      Init Users
        const user: UserEntity = new UserEntity();
        let setResult: status & id = await user.new(BadTournamentTest, passwordUser);
        expect(setResult.success).toBeTruthy();

        const user2: UserEntity = new UserEntity();
        setResult = await user2.new(Bad2TournamentTest, passwordUser);
        expect(setResult.success).toBeTruthy();

        const user3: UserEntity = new UserEntity();
        setResult = await user3.new(Bad3TournamentTest, passwordUser);
        expect(setResult.success).toBeTruthy();

        const user4: UserEntity = new UserEntity();
        setResult = await user4.new(Bad4TournamentTest, passwordUser);
        expect(setResult.success).toBeTruthy();

        const user5: UserEntity = new UserEntity();
        setResult = await user5.new(Bad5TournamentTest, passwordUser);
        expect(setResult.success).toBeTruthy();

        //      Init Teams
        const team: TeamEntity = new TeamEntity();
        setResult = await team.create(BadTournamentTest, user);
        expect(setResult.success).toBeTruthy();

        const team2: TeamEntity = new TeamEntity();
        setResult = await team2.create(Bad2TournamentTest, user2);
        expect(setResult.success).toBeTruthy();

        const team3: TeamEntity = new TeamEntity();
        setResult = await team3.create(Bad3TournamentTest, user3);
        expect(setResult.success).toBeTruthy();

        const team4: TeamEntity = new TeamEntity();
        setResult = await team4.create(Bad4TournamentTest, user4);
        expect(setResult.success).toBeTruthy();

        const team5: TeamEntity = new TeamEntity();
        setResult = await team5.create(Bad5TournamentTest, user5);
        expect(setResult.success).toBeTruthy();


        // Test size tournois
        //      Init tournois
        let tmp_date: Date = new Date();
        tmp_date.setMilliseconds(tmp_date.getMilliseconds() + 1000);
        const tournament: TournamentEntity = new TournamentEntity();
        setResult = await tournament.create(
            nameTournamentTest,
            "Je suis une description sans importance.",
            'SIMPLE',
            4,
            user,
            new Date(baseYear, baseMonth, baseDate, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate, baseHour, baseMinutes),
            tmp_date,
            new Date(baseYear, baseMonth, baseDate + 13, baseHour, baseMinutes));
        expect(setResult.success).toBeTruthy();
        BadIdTournament = setResult.id;

        // Petit sleep pour s'éloigner du départ
        await sleep(100);
        // Inscription team 1/4
        let status: status = await tournament.registration(team);
        expect(status.success).toBeTruthy();

        // Test inscription doublons
        status = await tournament.registration(team);
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("Team already registered!");

        // Inscription team 2/4
        status = await tournament.registration(team2);
        expect(status.success).toBeTruthy();

        // Inscription team 3/4
        status = await tournament.registration(team3);
        expect(status.success).toBeTruthy();

        // Inscription team 4/4
        status = await tournament.registration(team4);
        expect(status.success).toBeTruthy();

        // Inscription team 5/4
        status = await tournament.registration(team5);
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("Tournament does not exist or is full!");

        // Désinscription team pas inscrite
        status = await tournament.unregistration(team5);
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("This team is not register to this tournament!");

        // Désinscription team éroné
        const errorTeam: TeamEntity = new TeamEntity();
        status = await tournament.unregistration(errorTeam);
        expect(status.success).toBeFalsy();

        // Désinscription après close_registration
        //      Sleep pour attendre la fin des inscriptions
        await sleep(3000);
        //      Test désinscription
        status = await tournament.unregistration(team);
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("We are out of the registration period !")

        // Test avec user éroné
        setResult = await tournament.create(
            nameTournamentTest,
            "Je suis une description sans importance.",
            'SIMPLE',
            8,
            new UserEntity(),
            new Date(baseYear, baseMonth, baseDate, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 12, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 13, baseHour, baseMinutes));
        expect(setResult.success).toBeFalsy();
        expect(setResult.error).toEqual("Broken user!");

        // Test création de tournois avec nom trop court
        setResult = await tournament.create(
            "az",
            "Je suis une description sans importance.",
            'SIMPLE',
            8,
            user,
            new Date(baseYear, baseMonth, baseDate, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 5, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 12, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 13, baseHour, baseMinutes));
        expect(setResult.success).toBeFalsy();
        expect(setResult.error).toEqual("Tournament name must be at least 5 characters!");

        // Test création de tournois avec nom trop long
        setResult = await tournament.create(
            "123456789012345678901234567890",
            "Je suis une description sans importance.",
            'SIMPLE',
            8,
            user,
            new Date(baseYear, baseMonth, baseDate, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 5, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 12, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 13, baseHour, baseMinutes));
        expect(setResult.success).toBeFalsy();
        expect(setResult.error).toEqual("Tournament name cannot exceed 25 characters!");

        // Test création de tournois avec taille invalide
        setResult = await tournament.create(
            nameTournamentTest,
            "Je suis une description sans importance.",
            'SIMPLE',
            -1,
            user,
            new Date(baseYear, baseMonth, baseDate, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 5, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 12, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 13, baseHour, baseMinutes));
        expect(setResult.success).toBeFalsy();
        expect(setResult.error).toEqual("The size of the tournament must be at least for 4 teams!");

        // Test création de tournois avec start_visibility dans le passé
        setResult = await tournament.create(
            nameTournamentTest,
            "Je suis une description sans importance.",
            'SIMPLE',
            8,
            user,
            new Date(baseYear - 1, baseMonth, baseDate, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 5, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 12, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 13, baseHour, baseMinutes));
        expect(setResult.success).toBeFalsy();
        expect(setResult.error).toEqual("You cannot setup a date in the past !");

        // Test création de tournoi avec ouverture inscription dans le passé
        setResult = await tournament.create(
            nameTournamentTest,
            "Je suis une description sans importance.",
            'SIMPLE',
            8,
            user,
            new Date(baseYear, baseMonth, baseDate, baseHour, baseMinutes),
            new Date(baseYear - 1, baseMonth, baseDate + 5, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 12, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 13, baseHour, baseMinutes));
        expect(setResult.success).toBeFalsy();
        expect(setResult.error).toEqual("You cannot setup a date in the past !");

        // Test création de tournoi avec une fermeture d'inscription avant l'ouverture
        setResult = await tournament.create(
            nameTournamentTest,
            "Je suis une description sans importance.",
            'SIMPLE',
            8,
            user,
            new Date(baseYear, baseMonth, baseDate, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 5, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate, baseHour, baseMinutes),
            new Date(baseYear, baseMonth, baseDate + 13, baseHour, baseMinutes));
        expect(setResult.success).toBeFalsy();
        expect(setResult.error).toEqual("You cannot setup the close registration date before or at the same time as the open registration date or the start of the visibility of the tournament!");

        // Test création de tournoi avec un début avant la fin des inscriptions
        setResult = await tournament.create(
            nameTournamentTest,
            "Je suis une description sans importance.",
            'SIMPLE',
            8,
            user,
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
        setResult = await tournament.create(
            nameTournamentTest,
            "Je suis une description sans importance.",
            'SIMPLE',
            8,
            user,
            visibility,
            open_registration,
            close_registration,
            start
            );
        expect(setResult.success).toBeTruthy();
        BadEditTournament = setResult.id;

        // Test edit name too short
        // "" vaut null
        status = await tournament.edit("");
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("Nothing to update!");
        status = await tournament.edit("az");
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("Tournament name must be at least 5 characters!");

        // Test edit name too long
        status = await tournament.edit("123456789012345678901234567890");
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("Tournament name cannot exceed 25 characters!");

        // Test edit wrong size
        status = await tournament.edit(null, null, null, -1);
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("The size of the tournament must be at least for 4 teams!");
        // 0 vaut null
        status = await tournament.edit(null, null, null, 0);
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("Nothing to update!");
        status = await tournament.edit(null, null, null, 1);
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("The size of the tournament must be at least for 4 teams!");

        // Test edit visibility in the past
        tmp_date = new Date(now);
        tmp_date.setHours(tmp_date.getHours() - 1);
        status = await tournament.edit(null, null, null, null, tmp_date);
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("Start_visibility cannot be set in the past!");

        // Test edit open registration in the past
        status = await tournament.edit(null, null, null, null, null, tmp_date);
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("The opening of registration cannot be set in the past !");

        // Test edit visibility after closure
        tmp_date = new Date(close_registration);
        tmp_date.setMinutes(tmp_date.getMinutes() + 1);
        status = await tournament.edit(null, null, null, null, tmp_date);
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("Start_visibility cannot be set after the closure of the registration!");

        // Test edit open registration after closure
        status = await tournament.edit(null, null, null, null, null, tmp_date);
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("The opening of registration cannot be set after the closure!");

        // Test edit close registration before visibility
        //      Déplacement de open avant visibility sinon mauvais déclencheur
        tmp_date = new Date(visibility);
        tmp_date.setHours(tmp_date.getHours() - 1)
        status = await tournament.edit(null, null, null, null, null, tmp_date);
        expect(status.success).toBeTruthy();

        //      Test
        tmp_date = new Date(visibility);
        tmp_date.setMinutes(tmp_date.getMinutes() - 1);
        status = await tournament.edit(null, null, null, null, null, null, tmp_date);
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("The closure cannot be set before the start of the visibility of the tournament");

        //      Reset open registration
        status = await tournament.edit(null, null, null, null, null, open_registration);
        expect(status.success).toBeTruthy();

        // Test edit close registration before open_registration
        tmp_date = new Date(open_registration);
        tmp_date.setMinutes(tmp_date.getMinutes() - 1);
        status = await tournament.edit(null, null, null, null, null, null, tmp_date);
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("The closure cannot be set before the opening!");

        // Test edit close registration after the start
        tmp_date = new Date(start);
        tmp_date.setMinutes(tmp_date.getMinutes() + 1);
        status = await tournament.edit(null, null, null, null, null, null, tmp_date);
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("The closure of the registration cannot be set after the start of the tournament!");

        // Test edit start tournament before the close registration
        tmp_date = new Date(close_registration);
        tmp_date.setMinutes(tmp_date.getMinutes() - 1);
        status = await tournament.edit(null, null, null, null, null, null, null, tmp_date);
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("The start of the tournament cannot be set before the start of the tournament!");

        // Test récupération avec id de tournois éroné
        const errorTournament: TournamentEntity = new TournamentEntity();
        let getTeams: getTeams = await errorTournament.getRegisterTeams();
        expect(getTeams.success).toBeFalsy();
        expect(getTeams.teams.length).toEqual(0);

        // Test inscription avec id de tournois éroné
        status = await errorTournament.registration(team);
        expect(status.success).toBeFalsy();

        // Test inscription avec id de team éroné
        status = await tournament.registration(errorTeam);
        expect(status.success).toBeFalsy();

        // Test double suppression
        //      First
        status = await tournament.delete();
        expect(status.success).toBeTruthy();
        //      Second
        status = await tournament.delete();
        expect(status.success).toBeFalsy();
        //      Second with object obsolete
        tournament.is_loaded = true;
        status = await tournament.delete();
        expect(status.success).toBeFalsy();

        // Test suppression avec tournament eroné
        status = await errorTournament.delete();
        expect(status.success).toBeFalsy();
    });
    test("Match and History perfect use", async() => {
        // Init
        // Init variables
        const users: UserEntity[] = [];
        const teams: TeamEntity[] = [];
        let setStatus: status & id;
        let status: status;
        let result: status & {result: boolean};

        //      Init user and teams
        for (const name of namesMatchsHistory) {
            const user: UserEntity = new UserEntity();
            setStatus = await user.new(name, passwordUser);
            expect(setStatus.success).toBeTruthy();
            users.push(user);
            const team: TeamEntity = new TeamEntity();
            setStatus = await team.create(name, user);
            expect(setStatus.success).toBeTruthy();
            teams.push(team);
        }
        const substitute: UserEntity = new UserEntity();
        setStatus = await substitute.new(substituteName, passwordUser)
        expect(setStatus.success).toBeTruthy();
        status = await teams[0].addMember(substitute);
        expect(status.success).toBeTruthy();

        //      Init Tournament
        let visibility: Date = new Date();
        let open_registration: Date = new Date();
        let close_registration: Date = new Date();
        close_registration.setSeconds(close_registration.getSeconds() + 2);
        let start: Date = new Date(close_registration);
        const tournament: TournamentEntity = new TournamentEntity();
        setStatus = await tournament.create("Tournois Test", "Premier tournois à tourner", "SIMPLE", 4, users[0], visibility, open_registration, close_registration, start);
        expect(setStatus.success).toBeTruthy();
        MatchHistoryTournament = setStatus.id;

        // Test isTournamentEnded avec un tournois juste initialisé
        result = await tournament.isEnded();
        expect(result.success).toBeTruthy();
        expect(result.result).toBeFalsy();

        //      Registration
        let setRegistration: status;
        for (const team of teams) {
            setRegistration = await tournament.registration(team);
            expect(setRegistration.success).toBeTruthy();
        }
        // Sleep pour attendre la fin des inscriptions
        await sleep(2500);

        // Test lancement de tournois
        let matchs: getMatchs = await tournament.setup();

        // Test isTournamentEnded avec un tournois lancé mais pas terminé
        result = await tournament.isEnded();
        expect(result.success).toBeTruthy();
        expect(result.result).toBeFalsy();

        // Test Valeur de retour match 1
        expect(matchs.success).toBeTruthy();
        expect(matchs.matchs.length).toEqual(2);
        expect(teams[2].id).toEqual(matchs.matchs[0].teams![0].id_team);
        expect(teams[3].id).toEqual(matchs.matchs[0].teams![1].id_team);
        expect(matchs.matchs[0].teams![0].score).toEqual(0);
        expect(matchs.matchs[0].teams![1].score).toEqual(0);
        expect(matchs.matchs[0].id_victory_team).toBeNull();
        const match1: MatchEntity = new MatchEntity(matchs.matchs[0]);

        // Test fonction getMatchs qui doit renvoyer la même chose !
        const secondMatchs: getMatchs = await tournament.getMatchs();
        expect(matchs.matchs).toEqual(secondMatchs.matchs);

        // Test valeur de retour match 2
        expect(teams[0].id).toEqual(matchs.matchs[1].teams![0].id_team);
        expect(teams[1].id).toEqual(matchs.matchs[1].teams![1].id_team);
        expect(matchs.matchs[1].teams![0].score).toEqual(0);
        expect(matchs.matchs[1].teams![1].score).toEqual(0);
        expect(matchs.matchs[1].id_victory_team).toBeNull();
        const match2: MatchEntity = new MatchEntity(matchs.matchs[1]);

        // Test Update match1 des scores guest
        status = await match1.update([0, 1]);
        expect(status.success).toBeTruthy();

        // Vérification update
        status = await match1.fetch(match1.id!);
        expect(status.success).toBeTruthy();
        expect(match1.teams![0].score).toEqual(0);
        expect(match1.teams![1].score).toEqual(1);
        expect(match1.id_victory_team).toBeNull();

        // Test Update des scores host sans victory
        status = await match2.update([1, 0]);
        expect(status.success).toBeTruthy();

        // Vérification update
        status = await match2.fetch(match2.id!);
        expect(status.success).toBeTruthy();
        expect(match2.teams![0].score).toEqual(1);
        expect(match2.teams![1].score).toEqual(0);
        expect(match2.id_victory_team).toBeNull();

        // Test update victory for guest
        status = await match1.update([0, 2], teams[2].id);
        expect(status.success).toBeTruthy();

        // Vérification update
        status = await match1.fetch(match1.id!);
        expect(status.success).toBeTruthy();
        expect(match1.teams![0].score).toEqual(0);
        expect(match1.teams![1].score).toEqual(2);
        expect(match1.id_victory_team).toEqual(teams[2].id);

        // Test Update des scores victory host
        status = await match2.update([2, 0], teams[1].id);
        expect(status.success).toBeTruthy();

        // Vérification update
        status = await match2.fetch(match2.id!);
        expect(status.success).toBeTruthy();
        expect(match2.teams![0].score).toEqual(2);
        expect(match2.teams![1].score).toEqual(0);
        expect(match2.id_victory_team).toEqual(teams[1].id);

        // Passage automatique au round suivant. Tout les matchs sont terminés
        // Récupération des matchs suivant pour vérifier
        matchs = await tournament.getMatchs();
        expect(matchs.success).toBeTruthy();
        expect(matchs.matchs.length).toEqual(3);
        // Récupération que du dernier match pour faciliter les tests
        matchs = await tournament.getMatchs(1);
        expect(matchs.success).toBeTruthy();
        expect(matchs.matchs.length).toEqual(1);
        const final_match: MatchEntity = new MatchEntity(matchs.matchs[0]);

        // Test isTournamentEnded avec un tournoi en finale
        result = await tournament.isEnded();
        expect(result.success).toBeTruthy();
        expect(result.result).toBeFalsy();

        // Update victory for host
        status = await final_match.update([1, 2], teams[1].id);
        expect(status.success).toBeTruthy();

        // Test setup next round pour tester la butée
        matchs = await tournament.setupNextRound();
        expect(matchs.success).toBeTruthy();
        expect(matchs.matchs.length).toEqual(0);

        // Test isTournamentEnded avec un tournois terminé
        result = await tournament.isEnded();
        expect(result.success).toBeTruthy();
        expect(result.result).toBeTruthy();

        // Test positions des historiques
        //      TOP 4
        let getHistories: getHistories = await teams[0].getHistory();
        expect(getHistories.success).toBeTruthy();
        expect(getHistories.histories.length).toEqual(1);
        expect(getHistories.histories[0].position).toEqual(4);

        getHistories = await teams[3].getHistory();
        expect(getHistories.success).toBeTruthy();
        expect(getHistories.histories.length).toEqual(1);
        expect(getHistories.histories[0].position).toEqual(4)

        //      TOP 2
        getHistories = await teams[2].getHistory();
        expect(getHistories.success).toBeTruthy();
        expect(getHistories.histories.length).toEqual(1);
        expect(getHistories.histories[0].position).toEqual(2)
        //      TOP 1
        getHistories = await teams[1].getHistory();
        expect(getHistories.success).toBeTruthy();
        expect(getHistories.histories.length).toEqual(1);
        expect(getHistories.histories[0].position).toEqual(1)

        // Test récupération des historiques par user
        let secondGetHistories: getHistories = await users[1].getHistory();
        expect(secondGetHistories.histories).toEqual(getHistories.histories);

        // Eviter les problèmes d'arrondi et de temps entre les leave et les start du tournoi
        await sleep(1000);
        // Test avec deux tournois et switch d'équipe
        status = await teams[0].rmMember(substitute);
        expect(status.success).toBeTruthy();
        status = await teams[3].addMember(substitute);
        expect(status.success).toBeTruthy();

        // Eviter les problèmes d'arrondi et de temps entre les join et les start du tournoi
        await sleep(1000);

        //      Init Tournament
        visibility = new Date();
        open_registration = new Date();
        close_registration = new Date();
        close_registration.setSeconds(close_registration.getSeconds() + 2);
        start = new Date(close_registration);

        const tournament2: TournamentEntity = new TournamentEntity();
        setStatus = await tournament2.create("Tournois Test2", "Premier tournois à tourner", "SIMPLE", 4, users[0], visibility, open_registration, close_registration, start);
        expect(setStatus.success).toBeTruthy();
        MatchHistory2Tournament = setStatus.id;
        //      Registrations
        for (const team of teams) {
            status = await tournament2.registration(team);
            expect(status.success).toBeTruthy();
        }
        // Sleep pour attendre la fin des inscriptions
        await sleep(2500);

        // Exécution du tournoi
        matchs = await tournament2.setup();
        expect(matchs.success).toBeTruthy();
        expect(matchs.matchs.length).toEqual(2);

        // Exécution match 1
        status = await matchs.matchs[0].update([2, 5], teams[3].id);
        expect(status.success).toBeTruthy();

        // Exécution match 2
        status = await matchs.matchs[1].update([5, 2], teams[0].id);
        expect(status.success).toBeTruthy();

        // Passage round suivant
        matchs = await tournament2.getMatchs(1);
        expect(matchs.success).toBeTruthy();
        expect(matchs.matchs.length).toEqual(1);

        // Exécution finale
        status = await matchs.matchs[0].update([2, 5], teams[0].id);
        expect(status.success).toBeTruthy();

        // Vérification historique
        getHistories = await substitute.getHistory();
        expect(getHistories.success).toBeTruthy();
        expect(getHistories.histories.length).toEqual(2);
        expect(getHistories.histories[0].position).toEqual(2);
        expect(getHistories.histories[1].position).toEqual(4);

        secondGetHistories = await teams[0].getHistory();
        expect(secondGetHistories.success).toBeTruthy();
        expect(secondGetHistories.histories.length).toEqual(2);

        // Comparaison des historiques sachant qu'on récupère du plus jeune au plus vieux
        expect(getHistories.histories[1]).toEqual(secondGetHistories.histories[1]);

        secondGetHistories = await teams[3].getHistory();
        expect(secondGetHistories.success).toBeTruthy();
        expect(secondGetHistories.histories.length).toEqual(2);

        // Comparaison des historiques avec la deuxième équipe
        expect(getHistories.histories[0]).toEqual(secondGetHistories.histories[0]);

        // Test soft team delete
        status = await teams[0].softDelete();
        expect(status.success).toBeTruthy();
        status = await teams[3].softDelete();
        expect(status.success).toBeTruthy();

        // Les historiques doivent être conservés

        secondGetHistories = await substitute.getHistory();
        expect(secondGetHistories.success).toBeTruthy();
        expect(secondGetHistories.histories.length).toEqual(2);
        expect(secondGetHistories.histories).toEqual(getHistories.histories);

        // Test hard team delete
        status = await teams[0].hardDelete();
        expect(status.success).toBeTruthy();
        status = await teams[3].hardDelete();
        expect(status.success).toBeTruthy();

        // Les historiques doivent disparaitre
        getHistories = await substitute.getHistory();
        expect(getHistories.success).toBeTruthy();
        expect(getHistories.histories.length).toEqual(0);

        // Test delete tournament
        status = await tournament2.delete();
        expect(status.success).toBeTruthy();

        // Test que les matchs sont bien supprimés
        const database: Database = await Database.getInstance();
        let getResult: SQLGetResult = await database.get({table: "`match`", whereOption: [{column: "id_tournament", condition: "=", value: MatchHistory2Tournament}]});
        expect(getResult.success).toBeTruthy();
        expect(getResult.result.length).toEqual(0);

        // Test isTournamentEnded avec un tournois supprimé
        result = await tournament2.isEnded();
        expect(result.success).toBeFalsy();
        expect(result.result).toBeFalsy();

        // Vérification historique. Le tournoi doit disparaitre
        getHistories = await teams[1].getHistory();
        expect(getHistories.success).toBeTruthy();
        expect(getHistories.histories.length).toEqual(1);
        expect(getHistories.histories[0].id_tournament).toEqual(tournament.id);
    }, 10000);
    test("Match and History bad use", async() => {
        // Init
        //   Init variables
        const users: UserEntity[] = [];
        const teams: TeamEntity[] = [];
        let setStatus: status & id;
        let status: status;

        //  Init user
        for (const name of badMatchsHistory) {
            const user: UserEntity = new UserEntity();
            setStatus = await user.new(name, passwordUser);
            expect(setStatus.success).toBeTruthy();
            users.push(user);
            const team: TeamEntity = new TeamEntity();
            setStatus = await team.create(name, user);
            expect(setStatus.success).toBeTruthy();
            teams.push(team);
        }

        //  Init tournament
        let visibility: Date = new Date();
        let open_registration: Date = new Date();
        let close_registration: Date = new Date();
        close_registration.setSeconds(close_registration.getSeconds() + 1);
        let start: Date = new Date(close_registration);

        const tournament: TournamentEntity = new TournamentEntity();
        setStatus = await tournament.create("Bad tournois test", "Premier mauvais tournois", "SIMPLE", 4, users[0], visibility, open_registration, close_registration, start);
        expect(setStatus.success).toBeTruthy();
        expect(setStatus.id).not.toEqual(-1);
        BadHistoryTournament = setStatus.id;

        // Test lancement next round sans équipe avant start
        let getMatchs: getMatchs = await tournament.setupNextRound();
        expect(getMatchs.success).toBeFalsy();

        // Test lancement précoce sans équipe avant start
        getMatchs = await tournament.setup();
        expect(getMatchs.success).toBeFalsy();
        expect(getMatchs.error).toEqual("The tournament has not begun!");

        // Attente pour la fin des inscriptions
        await sleep(2000);

        // Test lancement next round sans équipe après start
        getMatchs = await tournament.setupNextRound();
        expect(getMatchs.success).toBeTruthy();
        expect(getMatchs.error).toEqual("Tournament has ended!");
        expect(getMatchs.matchs.length).toEqual(0)

        // Test lancement sans équipe après start
        getMatchs = await tournament.setup();
        expect(getMatchs.success).toBeFalsy();
        expect(getMatchs.error).toEqual("Tournament has ended!");

        // Reset tournois pour autre tests
        status = await tournament.delete();
        expect(status.success).toBeTruthy();

        // Init nouveau tournois
        visibility = new Date();
        open_registration = new Date();
        close_registration = new Date();
        close_registration.setSeconds(close_registration.getSeconds() + 1);
        start = new Date(close_registration);
        setStatus = await tournament.create("Tournois Test", "Premier tournois à mal tourner", "SIMPLE", 4, users[0], visibility, open_registration, close_registration, start);
        expect(setStatus.success).toBeTruthy();
        BadHistoryTournament = setStatus.id;

        // Registration
        for (const team of teams) {
            status = await tournament.registration(team);
            expect(status.success).toBeTruthy();
        }

        // Start précoce avec équipe
        getMatchs = await tournament.setup();
        expect(getMatchs.success).toBeFalsy();
        expect(getMatchs.error).toEqual("The tournament has not begun!");

        // Setup next round before start
        getMatchs = await tournament.setupNextRound();
        expect(getMatchs.success).toBeFalsy();
        expect(getMatchs.error).toEqual("This tournament have not start yet !");

        // On attends le start
        await sleep(2000);

        // Setup next round before setup tournament
        getMatchs = await tournament.setupNextRound();
        expect(getMatchs.success).toBeFalsy();
        expect(getMatchs.error).toEqual("This tournament have not start yet !");

        // Test setup avec paramètre éroné
        const errorTournament: TournamentEntity = new TournamentEntity();
        getMatchs = await errorTournament.setup();
        expect(getMatchs.success).toBeFalsy();
        expect(getMatchs.error).toEqual("Empty Object!");

        // Setup tournois
        getMatchs = await tournament.setup();
        expect(getMatchs.success).toBeTruthy();
        expect(getMatchs.matchs.length).toEqual(2);

        // Double setup
        getMatchs = await tournament.setup();
        expect(getMatchs.success).toBeFalsy();
        expect(getMatchs.error).toEqual("The tournament has already started!");

        // Test setupNextRound après le setup
        getMatchs = await tournament.setupNextRound();
        expect(getMatchs.success).toBeFalsy();

        // Test update Score avec paramètre éroné
        const errorMatch: MatchEntity = new MatchEntity();
        status = await errorMatch.update([5, 2], teams[0].id);
        expect(status.success).toBeFalsy();

        // Update score
        //      Récupération des matchs
        getMatchs = await tournament.getMatchs();
        expect(getMatchs.success).toBeTruthy();
        expect(getMatchs.matchs.length).toEqual(2);
        //      Test update score
        status = await getMatchs.matchs[0].update([5, 2], teams[2].id);
        expect(status.success).toBeTruthy();

        // Redéfinition score après définir le vainqueur
        status = await getMatchs.matchs[0].update([2, 5]);
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("Match does not exist or is ended!");

        // Redéfinition vainqueur
        status = await getMatchs.matchs[0].update([5, 2], teams[3].id);
        expect(status.success).toBeFalsy();
        expect(status.error).toEqual("Match does not exist or is ended!");

        // Test Get matchs avec paramètre id_tournament éroné
        getMatchs = await errorTournament.getMatchs();
        expect(getMatchs.success).toBeFalsy();
        expect(getMatchs.error).toEqual("Empty Object!");

        // Test get matchs avec paramètre nbFromLast car doit être positif
        // nbFromLast est neutralisé si inférieur ou égale à 0 pas d'erreur renvoyé
        getMatchs = await tournament.getMatchs(-1000);
        expect(getMatchs.success).toBeTruthy();
        expect(getMatchs.matchs.length).toEqual(2);

        // Test setup next round avant la fin des matchs
        getMatchs = await tournament.setupNextRound();
        expect(getMatchs.success).toBeFalsy();
        expect(getMatchs.error).toEqual("All match has not ended!");

        // Définition vainqueur pour continuation des tests
        //  Récupération des matchs
        getMatchs = await tournament.getMatchs();
        expect(getMatchs.success).toBeTruthy();
        expect(getMatchs.matchs.length).toEqual(2);
        //  Définition du vainqueur match 2
        status = await getMatchs.matchs[1].update([1, 3], teams[0].id);
        expect(status.success).toBeTruthy();

        // Setup Next round avec paramètre éroné
        getMatchs = await errorTournament.setupNextRound();
        expect(getMatchs.success).toBeFalsy();

        // Setup next round automatique. Juste récupération de la finale
        getMatchs = await tournament.getMatchs(1);
        expect(getMatchs.success).toBeTruthy();
        expect(getMatchs.matchs.length).toEqual(1);

        // Test isTournamentEnded
        let result: status & {result: boolean};
        //  Test isTournamentEnded avec paramètre éroné
        result = await errorTournament.isEnded();
        expect(result.success).toBeFalsy();

        // Test récupération historique team avec paramètre éroné
        const errorTeam: TeamEntity = new TeamEntity();
        let getHistories: getHistories = await errorTeam.getHistory()
        expect(getHistories.success).toBeFalsy();

        // Test récupération historique utilisateur avec paramètre éroné
        const errorUser: UserEntity = new UserEntity();
        getHistories = await errorUser.getHistory();
        expect(getHistories.success).toBeFalsy();
    }, 10000);
    afterAll(async () => {
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

        // Nettoyage Partie Team Bad
        status = await delTeam.fetch(badTeamManagement);
        if (status.success)
            await delTeam.hardDelete();
        status = await delTeam.fetch(bad2TeamManagement);
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