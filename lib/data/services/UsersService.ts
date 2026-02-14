// services/UsersService.ts
import bcrypt from "bcrypt";
import crypto from "node:crypto";
import { UsersRepository } from "../repositories/UsersRepository";
import {PublicUser, status, User} from "../../types";

/**
 * Logique applicative lié à l'utilisateur
 */
export class UsersService {
    /**
     * Constructeur
     * @param usersRepository repository utilisateur à utiliser pour l'accès aux données
     */
    constructor(private readonly usersRepository: UsersRepository) {}

    /**
     * Récupère un utilisateur
     * @param idUser id de l'utilisateur
     */
    async getById(idUser: number): Promise<User | null> {
        return this.usersRepository.getById(idUser);
    }

    /**
     * Récupère un utilisateur public
     * @param idUser id de l'utilisateur
     */
    async getPublicById(idUser: number): Promise<PublicUser | null> {
        return this.usersRepository.getPublicById(idUser);
    }

    /**
     * Récupère un utilisateur
     * @param username nom de l'utilisateur à récupérer
     */
    async getByUsername(username: string): Promise<User | null> {
        return this.usersRepository.getByUsername(username);
    }

    /**
     * Créer un utilisateur
     * @param username nom du nouvel utilisateur
     * @param password mot de passe du nouvel utilisateur
     * @param isAdmin status admin du nouvel utilisateur
     */
    async create(username: string, password: string, isAdmin = false): Promise<status> {
        if (!(await this.checkName(username))) {
            return { success: false, message: "Username doesn't match rules" };
        }

        if (!(await this.checkPassword(password))) {
            return { success: false, message: "Password doesn't match rules" };
        }

        const passwordHash: string = await bcrypt.hash(password, 12);

        await this.usersRepository.create(username, passwordHash, isAdmin);

        return { success: true };
    }

    /**
     * Authentifie un utilisateur
     * @param username Nom de l'utilisateur à authentifier
     * @param password Mot de passe à tester
     */
    async authenticate(username: string, password: string): Promise<string | null> {
        const user: User | null = await this.usersRepository.getByUsername(username);
        if (!user) return null;

        const ok: boolean = await bcrypt.compare(password, user.password_hash);
        if (!ok) return null;

        const token: string = UsersService.newToken();
        await this.usersRepository.setToken(user.id_user, token);

        return token;
    }

    /**
     * Récupère un utilisateur
     * @param token Token de l'utilisateur à récupérer
     */
    async authenticateToken(token: string): Promise<User | null> {
        return this.usersRepository.getByToken(token);
    }

    /**
     * Change le token d'un utilisateur
     * @param idUser id de l'utilisateur à modifier
     */
    async rotateToken(idUser: number): Promise<string> {
        const token: string = UsersService.newToken();
        await this.usersRepository.setToken(idUser, token);
        return token;
    }

    /**
     * Supprime le token d'un utilisateur
     * @param idUser id de l'utilisateur
     */
    async revokeToken(idUser: number): Promise<void> {
        await this.usersRepository.revokeToken(idUser);
    }

    /**
     * Mets à jour le nom d'un utilisateur
     * @param idUser id de l'utilisateur à mettre à jour
     * @param username nouveau nom à appliquer
     */
    async updateUsername(idUser: number, username: string): Promise<status> {
        if (!(await this.checkName(username))) {
            return { success: false, message: "Username doesn't match rules" };
        }
        await this.usersRepository.setUsername(idUser, username);
        return { success: true };
    }

    /**
     * Modifie le mot de passe d'un utilisateur
     * @param idUser id de l'utilisateur à modifier
     * @param newPassword nouveau mot de passe
     */
    async updatePassword(idUser: number, newPassword: string): Promise<status> {
        if (!(await this.checkPassword(newPassword))) {
            return { success: false, message: "Password doesn't match rules" };
        }

        const passwordHash: string = await bcrypt.hash(newPassword, 12);
        await this.usersRepository.setPasswordHash(idUser, passwordHash);

        return { success: true };
    }

    /**
     * Change le status admin d'un utilisateur
     * @param idUser id de l'utilisateur à changer
     * @param isAdmin nouveau status admin à appliquer
     */
    async setAdmin(idUser: number, isAdmin: boolean): Promise<void> {
        await this.usersRepository.setAdmin(idUser, isAdmin);
    }

    /**
     * Supprime un utilisateur
     * @param idUser id de l'utilisateur à supprimer
     */
    async delete(idUser: number): Promise<void> {
        await this.usersRepository.delete(idUser);
    }

    /**
     * Génère un nouveau token de 96 caractères
     * @private
     */
    private static newToken(): string {
        return crypto.randomBytes(48).toString("hex"); // 96 chars
    }

    /**
     * Vérifie la conformité du nom.
     * Qu'il est bien entre les limites de caractères ( 3 >= nom <= 29)
     * Qu'il n'existe pas déjà
     * @param username nom à tester
     * @private
     */
    private async checkName(username: string): Promise<boolean> {
        if (username.length < 3 || username.length > 30) return false;

        const existing: User | null = await this.usersRepository.getByUsername(username);
        return !existing;
    }

    /**
     * Vérifie la conformité du mot de passe
     * Qu'il est bien entre les limites de caractères ( 12 >= mdp <= 50)
     * @param password mot de passe à tester
     * @private
     */
    private async checkPassword(password: string): Promise<boolean> {
        return password.length >= 12 && password.length <= 50;
    }
}
