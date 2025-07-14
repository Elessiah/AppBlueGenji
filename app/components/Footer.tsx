"use client";

import Link from "next/link";
import { X, Luggage, MessageCircleMore, Globe } from "lucide-react";
import "./Footer.css";

export default function Footer() {
    return (
        <footer className="site-footer">
            <div className="social-links">
                <Link href="https://x.com/BluegenjiEsport" target="_blank">
                    <X size={20} />
                    <span>Twitter</span>
                </Link>
                <Link href="https://www.linkedin.com/company/bluegenji-esport/" target="_blank">
                    <Luggage size={20} />
                    <span>LinkedIn</span>
                </Link>
                <Link href="https://bsky.app/profile/bluegenjiesport.bsky.social" target="_blank">
                    <Globe size={20} />
                    <span>BlueSky</span>
                </Link>
                <Link href="https://discord.gg/VPGZ4eBfwN" target="_blank">
                    <MessageCircleMore size={20} />
                    <span>Discord</span>
                </Link>
            </div>

            <div className="consent-info">
                En utilisant ce site, vous acceptez que vos données soient sauvegardées de manière sécurisée.
                Votre mot de passe est <b>hashé</b>, jamais stocké en clair, et vous pouvez demander la suppression de votre compte à tout moment via votre page de profil.
            </div>

            <p className="footer-note">© {new Date().getFullYear()} BlueGenji – Tous droits réservés</p>
        </footer>
    );
}
