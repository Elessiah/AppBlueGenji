import Image from "next/image";
import Link from "next/link";
import "./Header.css";

export default function Header() {
    return (
        <header className="header">
            <Link href="/" className="home-button">
                <Image
                    src="/logo_bg.webp"
                    alt="Logo BlueGenji"
                    width={70}
                    height={70}
                    className="logo-header"
                />
            </Link>

            <section className="navigation-bar">
                <Link href="/tournament/list" className={"text-button"}>Tournois</Link>
                <Link href="/team/create" className={"text-button"}>Equipe</Link>
                <Link href="/login" className={"text-button"}>Compte</Link>
            </section>
        </header>
    );
}
