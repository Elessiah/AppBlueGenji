import styles from "./Ticker.module.css";

interface TickerProps {
  items: string[];
}

export function Ticker({ items }: TickerProps) {
  const doubled = [...items, ...items];

  return (
    <div className={styles.ticker}>
      <div className={styles.track}>
        {doubled.map((item, i) => (
          <span key={i} className={styles.item}>
            {item}
            <i className={styles.sep}>◆</i>
          </span>
        ))}
      </div>
    </div>
  );
}
