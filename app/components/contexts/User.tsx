"use client";
import React, { createContext, useContext, useState } from "react";
import {UserInfo} from "../../../lib/types";

interface UserContextType {
    user: UserInfo & {token: string},
    setUser: React.Dispatch<React.SetStateAction<UserInfo & {token: string}>>
}
const defaultUser: UserInfo & {token: string} = {user_id: -1, username: "", token: "", id_team: null, is_admin: false};
const defaultContextUser = {user: defaultUser, setUser: () => {}};

const UserContext = createContext<UserContextType>(defaultContextUser);

export function UserProvider({children}: {children: React.ReactNode}) {
    const [user, setUser] = useState<UserInfo & {token: string}>(defaultUser);
    return (
        <UserContext.Provider value={{ user: user, setUser: setUser }}>
            {children}
        </UserContext.Provider>
    );
}

export const useUser = () => useContext(UserContext);
