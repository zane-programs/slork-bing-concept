@import "gt.ck"

public class Movement extends GGen {
  // master fader, every movement patches its sound through this
  Envelope bus => dac;
  300::ms => dur BUS_RAMP;

  GameTrak @ gt;
  0 => int active;

  fun @construct() {
    BUS_RAMP => bus.duration;
    0 => bus.value;
  }

  fun void set_gt(GameTrak g) {
    g @=> gt;
  }

  // attach + flip active. don't set bus target here, tick() does that
  // so we don't pop at full volume before reading the conductor's gain
  fun void enter() {
    1 => active;
    this --> GG.scene();
    _on_enter();
  }

  // bus ramp down, visuals stay around until silent, then detach
  fun void leave() {
    if (!active) return;
    0 => active;
    bus.target(0.);
    _on_leave();
    spork ~ _detach_when_silent();
  }

  fun void _detach_when_silent() {
    BUS_RAMP + 50::ms => now;
    this --< GG.scene();
  }

  //default no-ops, subclasses override what they care about
  fun void on_beat(int beat, int is_mine) {}
  fun void tick() {}
  fun void _on_enter() {}
  fun void _on_leave() {}

  // -------- gt helpers --------
  // [-1,1] axis -> [lo,hi], centered at rest
  fun float gt_bipolar(float v, float lo, float hi) {
    Math.clampf((v + 1.) * 0.5, 0., 1.) => float t;
    return lo + t * (hi - lo);
  }

  // [0,1] axis (the z foot pedal) -> [lo,hi]
  fun float gt_unipolar(float v, float lo, float hi) {
    Math.clampf(v, 0., 1.) => float t;
    return lo + t * (hi - lo);
  }

  fun void drive_bus(float cap) {
    if (!active) {
      bus.target(0.);
      return;
    }
    if (gt == null) {
      // edge case, no gametrak controller
      bus.target(cap);
      return;
    }
    Math.max(gt.left_z(), gt.right_z()) => float z;
    Math.clampf(z, 0., 1.) => z;
    bus.target(cap * z);
  }
}
