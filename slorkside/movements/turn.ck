@import "../lib/movement.ck"

// turn: phones do triangle melodies w/ vibrato over the conductor's palette.
// we hold the chord underneath as a triangle pad an octave below
//
// gt mapping:
//   left x   bend, +/-600 cents
//   left y   gain trim, [0, 1.5]
//   right x  lpf tone, log [200, 8000] hz (on top of conductor timbre)
//   right y  extra vibrato on top of the conductor's vibrato max, [0, 50] cents
public class TurnMovement extends Movement {
  ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"] @=> string PC_NAMES[];
  0.06 => float PER_VOICE_GAIN;
  400::ms => dur NOTE_RAMP;

  LPF tone => bus;
  4000. => tone.freq;

  SinOsc lfo => blackhole;
  5 => lfo.freq;
  0.0 => float total_vibrato_cents;

  TriOsc oscs[12];
  Envelope note_envs[12];
  float base_freqs[12];
  int active_mask;

  float conductor_gain;
  int octave;
  float conductor_vibrato_max;
  float bend_cents;

  //up to 12 vertical bars across the middle
  GPlane bars[12];
  FlatMaterial bar_mats[12];
  @(.06, .04, .14) => vec3 OFF_COLOR;
  @(1.0, .55, .35) => vec3 ON_COLOR;

  fun @construct() {
    4 => octave;
    for (0 => int i; i < 12; i++) {
      oscs[i] => note_envs[i] => tone;
      NOTE_RAMP => note_envs[i].duration;
      0 => note_envs[i].value;
      PER_VOICE_GAIN => oscs[i].gain;
      _retune_voice(i);

      bar_mats[i].color(OFF_COLOR);
      bars[i].mat(bar_mats[i]);
      bars[i].sca(@(0.18, 0.6, 1.));
      (i - 5.5) * 0.30 => float x;
      bars[i].pos(@(x, 0., 0.));
      bars[i] --> this;
    }
  }

  // names come in csv from the bridge, e.g. "D,E,G,A"
  fun void set_data(float g, string names_csv, int oct, float vibrato_cents, float timbre) {
    g => conductor_gain;
    oct => octave;
    vibrato_cents => conductor_vibrato_max;
    //TODO maybe use `timbre` to bias the tone cutoff so we follow the phones
    _parse_mask(names_csv) => active_mask;
    for (0 => int i; i < 12; i++) _retune_voice(i);
    if (active) {
      _apply_chord();
      _refresh_bars();
    }
  }

  // walk csv by hand bc chuck's string api is slim. names assumed clean
  fun int _parse_mask(string csv) {
    0 => int mk;
    0 => int start;
    while (start <= csv.length()) {
      csv.find(",", start) => int idx;
      if (idx < 0) csv.length() => idx;
      csv.substring(start, idx - start) => string name;
      if (name.length() > 0) {
        _name_to_pc(name) => int pc;
        if (pc >= 0) (1 << pc) | mk => mk;
      }
      idx + 1 => start;
    }
    return mk;
  }

  fun int _name_to_pc(string name) {
    for (0 => int i; i < PC_NAMES.size(); i++) {
      if (PC_NAMES[i] == name) return i;
    }
    //flat aliases just in case the bridge ever sends em
    if (name == "Db") return 1;
    if (name == "Eb") return 3;
    if (name == "Gb") return 6;
    if (name == "Ab") return 8;
    if (name == "Bb") return 10;
    return -1;
  }

  // sit one octave below the phones, MIDI fmla = (octave+1)*12+pc
  fun void _retune_voice(int i) {
    Std.mtof((octave - 1 + 1) * 12 + i) => base_freqs[i];
    base_freqs[i] => oscs[i].freq;
  }

  fun void _on_enter() {
    _apply_chord();
    _refresh_bars();
  }

  fun void _on_leave() {
    for (0 => int i; i < 12; i++) note_envs[i].keyOff();
  }

  fun void _apply_chord() {
    for (0 => int i; i < 12; i++) {
      if ((active_mask & (1 << i)) != 0) note_envs[i].keyOn();
      else note_envs[i].keyOff();
    }
  }

  fun void _refresh_bars() {
    for (0 => int i; i < 12; i++) {
      if ((active_mask & (1 << i)) != 0) bar_mats[i].color(ON_COLOR);
      else bar_mats[i].color(OFF_COLOR);
    }
  }

  fun void tick() {
    if (gt == null) return;

    gt_bipolar(gt.left_y(), 0., 1.5) => float trim;
    bus.target(active ? conductor_gain * trim : 0.);

    gt_bipolar(gt.left_x(), -600., 600.) => bend_cents;
    //conductor's vibrato + the performer's gt right-y boost
    conductor_vibrato_max + gt_bipolar(gt.right_y(), 0., 50.) => total_vibrato_cents;
    Math.pow(2., gt_bipolar(gt.right_x(), 0., 5.32)) * 200. => tone.freq;

    lfo.last() * total_vibrato_cents + bend_cents => float total_cents;
    Math.pow(2., total_cents / 1200.) => float ratio;
    for (0 => int i; i < 12; i++) {
      if ((active_mask & (1 << i)) != 0) base_freqs[i] * ratio => oscs[i].freq;
    }

    //bars breathe with the bus
    bus.value() * 0.5 + 0.5 => float pulse;
    for (0 => int i; i < 12; i++) {
      if ((active_mask & (1 << i)) != 0) {
        bars[i].sca(@(0.18, 0.6 + 0.6 * pulse, 1.));
      } else {
        bars[i].sca(@(0.18, 0.1, 1.));
      }
    }
  }
}
