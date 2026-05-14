import styles from "./landing.module.css";

export default function DeviceLanding({ onJoin }: { onJoin: () => void }) {
  return (
    <div className={styles.landing}>
      <button onClick={onJoin}>Tap to join</button>
    </div>
  );
}
