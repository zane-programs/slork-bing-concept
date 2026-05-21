@import "../lib/movement.ck"

// counting: phones speak 1..N around the room. we sit under it as a
// harmonic pad, N partials of a fundamental. conductor's pitchMultiply
// transposes the pad in lockstep w/ the spoken samples on phones
//
// gt mapping:
//   left x   extra pitch on top of conductor pitchMultiply, +/-12 semis
//   left y   gain trim, [0, 1.5]
//   right x  lpf tone, log [200, 8000] hz
//   right y  tremolo depth, [0, 0.6]
public class CountingMovement extends Movement {
  110. => float BASE_HZ;
  12 => int MAX_PARTIALS;

  LPF tone => bus;
  4000. => tone.freq;
  //tremolo lfo, applied as a bus level mult in tick()
  SinOsc tremolo => blackhole;
  4 => tremolo.freq;
  float tremolo_depth;

  SawOsc partials[12];
  Envelope partial_envs[12];
  3::second => dur PARTIAL_RAMP;

  4 => int active_n;
  1.0 => float pitch_multiply;
  1.0 => float conductor_gain;
  float extra_shift_semis;

  // row of N circles, the current one lights up on the beat
  GPlane slots[12];
  FlatMaterial slot_mats[12];
  @(.06, .06, .08) => vec3 OFF_COLOR;
  @(0.95, 0.85, 0.45) => vec3 ON_COLOR;
  int current_slot;

  fun @construct() {
    for (0 => int i; i < MAX_PARTIALS; i++) {
      partials[i] => partial_envs[i] => tone;
      PARTIAL_RAMP => partial_envs[i].duration;
      0 => partial_envs[i].value;
      0.04 => partials[i].gain;
      BASE_HZ * (i + 1) => partials[i].freq;

      slot_mats[i].color(OFF_COLOR);
      slots[i].mat(slot_mats[i]);
      slots[i].sca(@(0.32, 0.32, 1.));
      slots[i] --> this;
    }
    _layout_slots();
  }

  fun void set_data(int n, float g, float pmul) {
    Math.max(1, n) => active_n;
    //cap at MAX_PARTIALS even tho conductor can send up to 20, we just don't visualize past 12
    if (active_n > MAX_PARTIALS) MAX_PARTIALS => active_n;
    Math.max(0., g) => conductor_gain;
    Math.max(0.1, pmul) => pitch_multiply;
    _retune_partials();
    _refresh_active_partials();
    _layout_slots();
  }

  fun void _retune_partials() {
    Math.pow(2., extra_shift_semis / 12.) => float ratio;
    BASE_HZ * pitch_multiply * ratio => float fund;
    for (0 => int i; i < MAX_PARTIALS; i++) fund * (i + 1) => partials[i].freq;
  }

  fun void _refresh_active_partials() {
    for (0 => int i; i < MAX_PARTIALS; i++) {
      if (i < active_n) partial_envs[i].keyOn();
      else partial_envs[i].keyOff();
    }
  }

  fun void _layout_slots() {
    for (0 => int i; i < MAX_PARTIALS; i++) {
      if (i >= active_n) {
        slots[i].sca(@(0., 0., 1.));
        continue;
      }
      (i - (active_n - 1) / 2.) * 0.5 => float x;
      slots[i].pos(@(x, 0., 0.));
      slots[i].sca(@(0.32, 0.32, 1.));
    }
  }

  fun void _on_enter() {
    _refresh_active_partials();
  }

  fun void _on_leave() {
    for (0 => int i; i < MAX_PARTIALS; i++) partial_envs[i].keyOff();
    for (0 => int i; i < MAX_PARTIALS; i++) slot_mats[i].color(OFF_COLOR);
  }

  fun void on_beat(int beat) {
    if (!active || active_n == 0) return;
    //handle negative beat values (originBeat can shift)
    ((beat % active_n) + active_n) % active_n => current_slot;
    for (0 => int i; i < MAX_PARTIALS; i++) {
      if (i == current_slot) slot_mats[i].color(ON_COLOR);
      else if (i < active_n) slot_mats[i].color(OFF_COLOR);
    }
  }

  fun void tick() {
    if (gt == null) return;

    gt_bipolar(gt.left_y(), 0., 1.5) => float trim;
    //tremolo wobbles bus level around 1 - depth/2
    gt_bipolar(gt.right_y(), 0., 0.6) => tremolo_depth;
    1. - tremolo_depth * 0.5 * (1. - tremolo.last()) => float trem;
    bus.target(active ? conductor_gain * trim * trem : 0.);

    gt_bipolar(gt.left_x(), -12., 12.) => extra_shift_semis;
    _retune_partials();
    Math.pow(2., gt_bipolar(gt.right_x(), 0., 5.32)) * 200. => tone.freq;

    //active slot breathes w/ the bus (whether or not a beat just hit)
    bus.value() * 0.5 + 0.5 => float pulse;
    if (current_slot >= 0 && current_slot < active_n) {
      slots[current_slot].sca(@(0.32 * pulse, 0.32 * pulse, 1.));
    }
  }
}
