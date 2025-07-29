import * as motion from "motion/react-client";
import "./Home.css";

export default function Home() {

    const items = [
        { src: "/BotPart.png", className: "top", alt: "Bot Part" },
        { src: "/MarvelRivalsPart.jpg", className: "right", alt: "Marvel Rivals" },
        { src: "/tournamentPart.jpeg", className: "bottom", alt: "Tournament" },
        { src: "/OverwatchPart.png", className: "left", alt: "Overwatch" },
    ];

    return (
        <div className="triangle-container">
            {/* Logo central */}
            <div className="triangle-center">
                <img src="/logo_bg.webp" alt="BlueGenji" />
            </div>

            {/* Triangles en cascade */}
            {items.map((item, index) => (
                <motion.div
                    key={item.className}
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.4 + index * 0.3,
                        type: "spring",
                        bounce: 0.4,
                        duration: 0.6, }}
                >
                    <img src={item.src} className={`triangle ${item.className}`} alt={item.alt} />
                </motion.div>
            ))}
        </div>
    );
}