@import "../lib/movement.ck"

// FOR MY FELLOW SLORKERS
// gt mapping:
//   left/right z  primary gain (height) - whichever is higher drives the
//                 bus, scaled by the conductor's gain cap. see Movement.drive_bus
public class ClickingMovement extends Movement {
  float WINDOW_W;
  float WINDOW_H;
  float ASPECT_RATIO;

  float vw;
  float vh;

  .1 => float intensity;
  // conductor's gain cap (max loudness). default 1.0 so the bus headroom
  // is the click's own env.gain until the conductor attenuates
  1.0 => float conductor_gain;
  25::ms => dur CLICK_DUR;

  GPlane flash;
  FlatMaterial flash_mat;

  fun @construct() {
    flash_mat.color(@(4., 4., 4.));
    flash.mat(flash_mat);
  }

  fun void set_data(float g, float i) {
    g => conductor_gain;
    i => intensity;
  }

  fun void on_beat(int beat_num, int is_mine) {
    if (is_mine) {
      // show flash
      flash --> this;
    } else {
      flash --< this;
    }
    spork ~ click();
  }

  fun void tick() {
    GG.camera().viewSize() => float vh;
    vh * ASPECT_RATIO => float vw;

    GG.frameWidth() => WINDOW_W;
    GG.frameHeight() => WINDOW_H;
    WINDOW_W/WINDOW_H => ASPECT_RATIO;

    flash.sca(@(vw, vh, 1.));

    // gain: conductor sets the cap, gametrak z (height) drives it on interval [0,cap]
    drive_bus(conductor_gain);
  }

  fun void click() {
    TriOsc osc => ADSR env => bus;

    env.set(0.15::ms, CLICK_DUR, 0.0, 0::ms);
    0.6 => env.gain;
    1800 + intensity * 400 => osc.freq;

    env.keyOn();
    1::ms + CLICK_DUR + 10::ms => now;
    env.keyOff();

    osc =< env =< bus;
  }
}