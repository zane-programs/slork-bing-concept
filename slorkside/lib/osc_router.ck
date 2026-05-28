@import {"../movements/wake.ck", "../movements/clicking.ck"}

// one OscIn for the whole station, dispatch by address. bridge heartbeats
// every 500ms so we just trust what we see + don't need delta tracking
public class OscRouter {
  5461 => int OSC_PORT;

  OscIn oin;
  OscMsg msg;

  WakeMovement @ wake;
  ClickingMovement @ clicking;

  Movement @ current;

  RegistrationDoer _registration;

  -1 => int device_idx;

  fun @construct(WakeMovement w, ClickingMovement c) {
    w @=> wake;
    c @=> clicking;

    OSC_PORT => oin.port;
    oin.addAddress("/state/none");
    oin.addAddress("/state/movement");
    
    // movements
    oin.addAddress("/movement/wake");
    oin.addAddress("/movement/clicking");

    oin.addAddress("/beatinfo");
    oin.addAddress("/beatinfo/clear");
    oin.addAddress("/beatmetro");
    oin.addAddress("/register/pong");
  }

  fun void start() {
    spork ~ _listen();
    chout <= "[osc] listening on OSC udp:" <= OSC_PORT <= IO.newline();
  }

  fun void register(int idx) {
    idx => device_idx;
    _registration.register(idx);
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
    else if (m.address == "/movement/clicking") {
      m.getFloat(0) => float g;
      m.getFloat(1) => float intensity;
      clicking.set_data(g, intensity);
    }

    else if (m.address == "/beatinfo") {
      //TODO:
    }
    else if (m.address == "/beatinfo/clear") {
      //no internal clock to clear, ignore
    }
    else if (m.address == "/beatmetro") {
      // bridge-driven per-beat tick (broadcasted to all stations)
      m.getInt(0) => int target_idx;
      m.getInt(1) => int beat_num;
      if (current != null) {
        current.on_beat(beat_num, target_idx == device_idx);
      }
    }
    else if (m.address == "/register/pong") {
      // ACK from bridge. heartbeats keep arriving; only log first transition.
      m.getInt(0) => int echoed_idx;
      if (echoed_idx == device_idx && !_registration.is_registered) {
        _registration.set_registered();
        chout <= "[state] register success!" <= IO.newline();
      }
    }
  }

  fun Movement _lookup(string name) {
    if (name == "wake") return wake;
    if (name == "clicking") return clicking;
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

// doer? i hardly kn- nevermind
class RegistrationDoer {
  int is_registered;

  "255.255.255.255" => string hostname;
  5462 => int port;

  Shred @ _loop;

  fun void set_registered() {
    1 => is_registered;
  }

  fun void register(int device_idx) {
    if (_loop == null) {
      spork ~ _register_loop(device_idx) @=> _loop;
    } else {
      <<< "register already running", "" >>>;
    }
  }

  fun void _register_loop(int device_idx) {
    while (true) {
      OscOut xmit;
      xmit.dest(hostname, port);
      xmit.start("/register/ping");
      device_idx => xmit.add;
      xmit.send();

      if (is_registered) 1::second => now;
      else 200::ms => now;
    }
  }
}