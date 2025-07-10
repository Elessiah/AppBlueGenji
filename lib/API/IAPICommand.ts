export interface IAPICommand {
    command: string;

    handler(): void;
}