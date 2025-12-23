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
                <svg viewBox="0 0 200 200" className="circle-text">
                    <defs>
                        <path id="circlePath" d="M 30,150 A 80,80 0 0,0 170,150" />
                    </defs>
                    <text>
                        <textPath href="#circlePath" startOffset="50%" textAnchor="middle">
                            BlueGenji
                        </textPath>
                    </text>
                </svg>
            </div>

            {/* Triangles en cascade
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

                </motion.div>
            ))}
             */}
            <img src="/BotPart.png" className='triangle top' />
            <img src="/MarvelRivalsPart.jpg" className='triangle right' />
            <img src="/tournamentPart.jpeg" className='triangle bottom' />
            <img src="/OverwatchPart.png" className='triangle left' />
        </div>
    );
}