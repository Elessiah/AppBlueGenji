"use client";
import {redirect, useSearchParams} from "next/navigation";

export default function Home() {
    const searchParams = useSearchParams();
    const error: string | null = searchParams.get('error');
    if (error != null) {
        redirect("/tournament/list?error=" + error);
    }
    redirect("/tournament/list");
}
