@import "../lib/movement.ck"

// clicking: phones do high tri clicks on the beat. we anchor the low end
// with a kick / thump on every beat. quick pluck envelope on a sub sine
//
// gt mapping:
//   left x   thump pitch shift, +/-12 semis
//   left y   gain trim, [0, 1.5]
//   right x  lpf tone, log [60, 1200] hz (rumble -> thwack)
//   right y  decay length, [50, 600] ms
public class ClickingMovement extends Movement {
  55. => float BASE_HZ;

  SinOsc body => Envelope env => LPF tone => bus;
  600. => tone.freq;
  0.8 => body.gain;
  3::ms => env.duration;
  0 => env.value;
  //softer sub partial for body weight
  SinOsc sub => env;
  BASE_HZ / 2. => sub.freq;
  0.5 => sub.gain;

  0.0 => float intensity;
  float pitch_shift_semis;
  150::ms => dur decay;

  //full-screen flash plane sits behind whatever else
  GPlane flash;
  FlatMaterial flash_mat;
  @(0., 0., 0.) => vec3 OFF_COLOR;
  0 => int last_hue_step;

  fun @construct() {
    flash_mat.color(OFF_COLOR);
    flash.mat(flash_mat);
    flash.sca(@(20., 12., 1.));
    flash.pos(@(0., 0., -1.));
    flash --> this;
  }

  fun void set_data(float i) {
    Math.clampf(i, 0., 1.) => intensity;
  }

  fun void _on_leave() {
    flash_mat.color(OFF_COLOR);
  }

  fun void on_beat(int beat) {
    if (!active) return;
    spork ~ _thump(beat);
  }

  fun void _thump(int beat) {
    Math.pow(2., pitch_shift_semis / 12.) => float ratio;
    BASE_HZ * ratio => body.freq;
    BASE_HZ * ratio * 0.5 => sub.freq;

    intensity * 0.9 + 0.1 => float amp;
    amp => env.target;
    env.keyOn();
    20::ms => now;
    0. => env.target;
    env.keyOff();
    decay => now;

    //color cycles every beat just so the flashes don't all look the same
    (beat % 6) => last_hue_step;
    _hue_for(last_hue_step, intensity) => vec3 c;
    flash_mat.color(c);
    decay * 0.5 => now;
    flash_mat.color(OFF_COLOR);
  }

  fun vec3 _hue_for(int step, float amt) {
    Math.max(0.15, amt) => float a;
    if (step == 0) return @(a, a*0.2, a*0.4);
    if (step == 1) return @(a*0.3, a, a*0.5);
    if (step == 2) return @(a*0.4, a*0.5, a);
    if (step == 3) return @(a, a*0.7, a*0.2);
    if (step == 4) return @(a*0.6, a*0.2, a);
    return @(a*0.9, a*0.9, a*0.9);
  }

  fun void tick() {
    if (gt == null) return;

    gt_bipolar(gt.left_y(), 0., 1.5) => float trim;
    bus.target(active ? intensity * trim : 0.);

    gt_bipolar(gt.left_x(), -12., 12.) => pitch_shift_semis;
    // 60 * 2^4.32 ~= 1200
    Math.pow(2., gt_bipolar(gt.right_x(), 0., 4.32)) * 60. => tone.freq;
    gt_bipolar(gt.right_y(), 50., 600.)::ms => decay;
  }
}
