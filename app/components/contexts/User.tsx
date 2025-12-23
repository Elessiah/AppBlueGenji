"use client";
import React, { createContext, useContext, useState } from "react";
import {Player} from "../../../lib/types";

interface UserContextType {
    user: Player & {token: string},
    setUser: React.Dispatch<React.SetStateAction<Player & {token: string}>>
}
const defaultUser: Player & {token: string} = {id_user: -1, username: "", token: "", id_team: null, is_admin: false};
const defaultContextUser = {user: defaultUser, setUser: () => {}};

const UserContext = createContext<UserContextType>(defaultContextUser);

export function UserProvider({children}: {children: React.ReactNode}) {
    const [user, setUser] = useState<Player & {token: string}>(defaultUser);
    return (
        <UserContext.Provider value={{ user: user, setUser: setUser }}>
            {children}
        </UserContext.Provider>
    );
}

export const useUser = () => useContext(UserContext);
