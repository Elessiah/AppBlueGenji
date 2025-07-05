import React from "react";
import "./Modal.css";

const Modal: React.FC<{text: string, onClose: () => void}> = ({ text, onClose }) => {
    if (text.length > 0) {
        return (
            <div className="modal-overlay" onClick={() => onClose()}>
                <div className={"modal-content"}>
                    <p>{text}</p>
                </div>
            </div>
        );
    }
    return null;
}

export default Modal;