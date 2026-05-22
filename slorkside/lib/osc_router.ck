@import {"../movements/wake.ck"}

// one OscIn for the whole station, dispatch by address. bridge heartbeats
// every 500ms so we just trust what we see + don't need delta tracking
public class OscRouter {
  5461 => int OSC_PORT;

  OscIn oin;
  OscMsg msg;

  WakeMovement @ wake;

  Movement @ current;

  fun @construct(WakeMovement w) {
    w @=> wake;

    OSC_PORT => oin.port;
    oin.addAddress("/state/none");
    oin.addAddress("/state/movement");
    oin.addAddress("/movement/wake");
    oin.addAddress("/movement/turn");
    oin.addAddress("/movement/clicking");
    oin.addAddress("/movement/counting");
    oin.addAddress("/beat");
    oin.addAddress("/beat/clear");
  }

  fun void start() {
    spork ~ _listen();
    chout <= "[slorkstation] listening on OSC udp:" <= OSC_PORT <= IO.newline();
  }

  fun void _listen() {
    while (true) {
      oin => now;
      while (oin.recv(msg)) _handle(msg);
    }
  }

  fun void _handle(OscMsg m) {
    if (m.address == "/state/none") {
      chout <= "[state] cleared" <= IO.newline();
      _switch_to(null);
    }
    else if (m.address == "/state/movement") {
      m.getString(0) => string name;
      chout <= "[state] movement=" <= name <= IO.newline();
      _switch_to(_lookup(name));
    }
    else if (m.address == "/movement/wake") {
      m.getFloat(0) => float g;
      m.getInt(1) => int mask;
      wake.set_data(g, mask);
    }
    else if (m.address == "/movement/turn") {
      m.getFloat(0) => float g;
      m.getString(1) => string names;
      m.getInt(2) => int octave;
      m.getFloat(3) => float vibrato_cents;
      m.getFloat(4) => float timbre;
    }
    else if (m.address == "/movement/clicking") {
      m.getFloat(0) => float intensity;
      <<<"not implemented yet", "">>>;
    }
    else if (m.address == "/movement/counting") {
      m.getInt(0) => int n;
      m.getFloat(1) => float g;
      m.getFloat(2) => float pmul;
      <<<"not implemented yet", "">>>;
    }
    else if (m.address == "/beat") {
      // arg 0 is anchorMs as a string (doesnt fit in osc f32), we don't need it
      m.getInt(2) => int origin;
      if (current != null) current.on_beat(origin);
    }
    else if (m.address == "/beat/clear") {
      //no internal clock to clear, ignore
    }
  }

  fun Movement _lookup(string name) {
    if (name == "wake") return wake;
    return null;
  }

  fun void _switch_to(Movement next) {
    if (current == next) return;
    if (current != null) current.leave();
    next @=> current;
    if (current != null) current.enter();
  }

  fun Movement active() {
    return current;
  }
}
