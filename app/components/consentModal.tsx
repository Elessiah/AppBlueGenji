"use client";
import React from "react";
import "./consentModal.css";

type ConsentModalProps = {
    isOpen: boolean;
    onAcceptAction: () => void;
};

export default function ConsentModal({ isOpen, onAcceptAction }: ConsentModalProps) {

    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <h2>Consentement à la sauvegarde des données</h2>
                <p>
                    En utilisant ce site, vous acceptez que les données que vous saisissez
                    soient sauvegardées dans notre base de données. Votre mot de passe
                    sera <b>hashé de manière sécurisée</b> et <b>jamais stocké</b>.
                </p>
                <p>
                    Vous pouvez <b>supprimer complètement votre compte</b> et
                    vos données personnelles à tout moment via le bouton dédié dans
                    votre page de profil.
                </p>
                <button className="accept-btn" onClick={onAcceptAction}>
                    Accepter
                </button>
            </div>
        </div>
    );
}
