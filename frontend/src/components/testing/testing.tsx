import { useMemo, useState } from "react";
import styles from "./testing.module.css";

const GRID_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8];

export default function TestingPage() {
  const [n, setN] = useState(3);

  const cells = useMemo(() => {
    const count = n * n;
    return Array.from({ length: count }, (_, i) => i);
  }, [n]);

  return (
    <div className={styles.testing}>
      <div className={styles.controls}>
        <label htmlFor="grid-size">grid</label>
        <select
          id="grid-size"
          value={n}
          onChange={(e) => setN(Number(e.target.value))}
        >
          {GRID_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt}×{opt}
            </option>
          ))}
        </select>
        <span>({n * n} devices)</span>
      </div>
      <div
        className={styles.grid}
        style={{
          gridTemplateColumns: `repeat(${n}, 1fr)`,
          gridTemplateRows: `repeat(${n}, 1fr)`,
        }}
      >
        {cells.map((i) => (
          <div key={i} className={styles.cell}>
            <iframe src="/" title={`device-${i}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
