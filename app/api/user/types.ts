export interface registerRequest {
    username: string,
    password: string,
    isAdmin?: boolean,
}

export interface loginRequest {
    username: string,
    password: string,
}

export interface patchRequest {
    username?: string,
    password?: string,
    isAdmin?: boolean,
}