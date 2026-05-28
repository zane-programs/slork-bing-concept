import { useState } from "react";
import { loginWithPasscode, type AuthRole } from "../../lib/auth";
import styles from "./passcode-gate.module.css";

interface Props {
  title: string;
  role: AuthRole;
  onAuthorized: () => void;
}

export default function PasscodeGate({ title, role, onAuthorized }: Props) {
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy || passcode.length === 0) return;
    setBusy(true);
    setError(null);
    const result = await loginWithPasscode(role, passcode);
    setBusy(false);
    if (result.ok) {
      onAuthorized();
      return;
    }
    if (result.error.kind === "network") {
      setError("Network error.");
    } else {
      setError("Wrong passcode.");
      setPasscode("");
    }
  };

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{title}</h1>
      <input
        className={styles.passInput}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        autoFocus
        value={passcode}
        onChange={(e) => setPasscode(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        placeholder="passcode"
      />
      <button
        type="button"
        className={styles.submit}
        onClick={submit}
        disabled={busy || passcode.length === 0}
      >
        {busy ? "…" : "Enter"}
      </button>
      <div className={styles.error}>{error ?? ""}</div>
    </div>
  );
}
