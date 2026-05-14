import styles from "./landing.module.css";

export default function DeviceLanding({ onJoin }: { onJoin: () => void }) {
  return (
    <div className={styles.landing}>
      <ul>
        <li>Turn ON ringer</li>
        <li>Set volume to 100%</li>
        <li>Set brightness to maximum</li>
        <li>Tap button below!</li>
      </ul>
      <button onClick={onJoin}>Tap to join</button>
    </div>
  );
}
