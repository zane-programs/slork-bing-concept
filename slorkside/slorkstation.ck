@import {"lib/gt.ck", "lib/osc_router.ck"}

// slorkstation: the slork-side companion to the audience phones.
// listens to the conductor (via the node osc-bridge), routes state to
// one of four movements, each with its own complementary voice + visual.
// performer drives vol/tone/vibrato/pitch through a gametrak (or kb-sim
// fallback) shared across all four

Std.atoi(me.arg(0)) => int device_idx;
<<< "[init] Welcome, device", device_idx >>>;

GameTrak gt;
WakeMovement wake;
ClickingMovement clicking;

wake.set_gt(gt);
clicking.set_gt(gt);

OscRouter router(wake, clicking);
router.register(device_idx);
router.start();

GG.windowTitle("SLOrkStation");


//only the active movement ticks. inactive ones sit silent (bus env @ 0)
while (true) {
  router.active() @=> Movement m;
  if (m != null) m.tick();
  GG.nextFrame() => now;
}