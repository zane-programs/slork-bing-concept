@import "../lib/movement.ck"

// wake: phones do soft bell notes spread across octaves, we sit under it
// with a chord drone. 12 sines gated by the pitch-class bitmask, this
// preserves the og slorkstation.ck behavior basically just OO'd
//
// gt mapping:
//   left x   bend, +/-600 cents
//   left y   gain trim on conductor gain, [0, 1.5]
//   right x  lpf tone, log [200, 8000] hz
//   right y  vibrato depth, [0, 40] cents
public class WakeMovement extends Movement {
  3 => int OCTAVE;
  500::ms => dur NOTE_RAMP;
  0.06 => float PER_VOICE_GAIN;

  LPF tone => bus;
  4000. => tone.freq;

  //one lfo shared across voices so the vibrato moves together
  SinOsc lfo => blackhole;
  5 => lfo.freq;
  0.0 => float vibrato_cents;

  SinOsc oscs[12];
  Envelope note_envs[12];
  float base_freqs[12];

  0.0 => float conductor_gain;
  0 => int mask;

  float bend_cents;

  // 12 dots across the bottom, one per pitch class
  GPlane indicators[12];
  FlatMaterial indicator_mats[12];
  @(.10, .18, .42) => vec3 OFF_COLOR;
  @(.55, .80, 1.0) => vec3 ON_COLOR;

  fun @construct() {
    for (0 => int i; i < 12; i++) {
      oscs[i] => note_envs[i] => tone;
      NOTE_RAMP => note_envs[i].duration;
      0 => note_envs[i].value;
      PER_VOICE_GAIN => oscs[i].gain;
      Std.mtof((OCTAVE + 1) * 12 + i) => base_freqs[i];
      base_freqs[i] => oscs[i].freq;

      indicator_mats[i].color(OFF_COLOR);
      indicators[i].mat(indicator_mats[i]);
      indicators[i].sca(@(0.18, 0.18, 1.));
      //spaced across the default chugl view, eyeballed
      (i - 5.5) * 0.36 => float x;
      indicators[i].pos(@(x, -1.2, 0.));
      indicators[i] --> this;
    }
  }

  fun void set_data(float g, int mk) {
    g => conductor_gain;
    mk => mask;
    if (active) {
      _apply_chord();
      _refresh_indicators();
    }
  }

  fun void _on_enter() {
    _apply_chord();
    _refresh_indicators();
  }

  fun void _on_leave() {
    for (0 => int i; i < 12; i++) note_envs[i].keyOff();
  }

  fun void _apply_chord() {
    for (0 => int i; i < 12; i++) {
      if ((mask & (1 << i)) != 0) note_envs[i].keyOn();
      else note_envs[i].keyOff();
    }
  }

  fun void _refresh_indicators() {
    for (0 => int i; i < 12; i++) {
      if ((mask & (1 << i)) != 0) indicator_mats[i].color(ON_COLOR);
      else indicator_mats[i].color(OFF_COLOR);
    }
  }

  fun void tick() {
    if (gt == null) return;

    gt_bipolar(gt.left_y(), 0., 1.5) => float trim;
    bus.target(active ? conductor_gain * trim : 0.);

    gt_bipolar(gt.left_x(), -600., 600.) => bend_cents;
    gt_bipolar(gt.right_y(), 0., 40.) => vibrato_cents;
    // 200 * 2^5.32 ~= 8000, log feels nicer than linear here
    Math.pow(2., gt_bipolar(gt.right_x(), 0., 5.32)) * 200. => tone.freq;

    //apply bend + vibrato to every active voice
    lfo.last() * vibrato_cents + bend_cents => float total_cents;
    Math.pow(2., total_cents / 1200.) => float ratio;
    for (0 => int i; i < 12; i++) {
      if ((mask & (1 << i)) != 0) base_freqs[i] * ratio => oscs[i].freq;
    }

    // gentle breathing on the active dots
    bus.value() * 0.4 + 0.6 => float pulse;
    for (0 => int i; i < 12; i++) {
      if ((mask & (1 << i)) != 0) {
        indicators[i].sca(@(0.18 * pulse, 0.18 * pulse, 1.));
      } else {
        indicators[i].sca(@(0.12, 0.12, 1.));
      }
    }
  }
}
