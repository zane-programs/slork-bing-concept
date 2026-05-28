@import "../lib/movement.ck"

// gt mapping:
//   left/right z  primary gain (height) - whichever is higher drives the
//                 bus, scaled by the conductor's gain cap. see Movement.drive_bus
public class WakeMovement extends Movement {
  3 => int OCTAVE;
  500::ms => dur NOTE_RAMP;
  0.06 => float PER_VOICE_GAIN;

  SinOsc oscs[12];
  Envelope note_envs[12];

  0.0 => float conductor_gain;
  0 => int mask;

  // fullscreen backdrop, color ramps black -> white with gametrak height
  GPlane backdrop;
  FlatMaterial backdrop_mat;

  fun @construct() {
    backdrop_mat.color(@(0., 0., 0.));
    backdrop.mat(backdrop_mat);
    backdrop --> this;

    for (0 => int i; i < 12; i++) {
      oscs[i] => note_envs[i] => bus;
      NOTE_RAMP => note_envs[i].duration;
      0 => note_envs[i].value;
      PER_VOICE_GAIN => oscs[i].gain;
      Std.mtof((OCTAVE + 1) * 12 + i) => oscs[i].freq;
    }
  }

  fun void set_data(float g, int mk) {
    g => conductor_gain;
    mk => mask;
    if (active) _apply_chord();
  }

  fun void _on_enter() {
    _apply_chord();
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

  fun void tick() {
    // gain: conductor sets the cap, gametrak z (height) drives it from 0..cap
    drive_bus(conductor_gain);

    // size backdrop to fill the camera frame
    GG.camera().viewSize() => float vh;
    vh * (GG.frameWidth() $ float / GG.frameHeight() $ float) => float vw;
    backdrop.sca(@(vw, vh, 1.));

    // height (same z that drives gain) -> backdrop brightness
    0. => float z;
    if (gt != null) {
      Math.max(gt.left_z(), gt.right_z()) => z;
      Math.clampf(z, 0., 1.) => z;
    }
    backdrop_mat.color(@(z, z, z));
  }
}
