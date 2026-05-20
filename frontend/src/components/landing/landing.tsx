import { useState } from "react";
import styles from "./landing.module.css";
import { unlockAudio, playTone } from "../../lib/audio";
import { midiToFreq, parseNoteToMidi } from "../../lib/music";

const TEST_TONE_FREQS = ["C4", "E4", "G4", "C5", "G4", "E4", "C4"].map((n) =>
  midiToFreq(parseNoteToMidi(n)!),
);

export default function DeviceLanding({ onJoin }: { onJoin: () => void }) {
  const [passedInitialChecks, setPassedInitialChecks] = useState(false);
  const [ranATest, setRanATest] = useState(false);

  const runTest = () => {
    const ctx = unlockAudio();
    if (ctx) {
      const noteDur = 0.16;
      TEST_TONE_FREQS.forEach((freq, i) => {
        playTone(ctx, ctx.currentTime + i * noteDur, freq, noteDur);
      });
    }
    setRanATest(true);
  };

  const onClickNext = () => {
    setPassedInitialChecks(true);
  };

  return (
    <div className={styles.landing}>
      {passedInitialChecks ? (
        <>
          <p>Please test your sound</p>
          <button onClick={runTest}>Test</button>
          {ranATest && (
            <>
              <p>
                If you heard the sound clearly, click "Join" below. <br />
                If not, please check your device settings and try again.
              </p>
              <button onClick={onJoin}>Join</button>
            </>
          )}
        </>
      ) : (
        <>
          <ul>
            <li>Turn ON ringer</li>
            <li>Set volume to 100%</li>
            <li>Set brightness to maximum</li>
            <li>Click "Next" below</li>
          </ul>
          <button onClick={onClickNext}>Next</button>
        </>
      )}
    </div>
  );
}
