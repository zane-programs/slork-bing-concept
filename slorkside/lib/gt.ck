//-----------------------------------------------------------------------------
// name: gt.ck (orig. gt_kb_dupe.ck)
// desc: either a gametrak controller if available, or a keyboard duplicate if not.
//       the two modes are meant to be drop in replacements of each other.
//       in the keyboard mode, control left thing by `wasd + eq`, right thing by `ijkl + uo`
//
// note: stripped the trailing demo loop, just the importable class now
//
// author: Anthony Maltsev (amaltsev@stanford.edu), Ge Wang (ge@ccrma.stanford.edu)
// date: summer 2014, spring 2026
//-----------------------------------------------------------------------------
public class GameTrak
{
    0 => int keyboard_mode; // bool

    0 => float DEADZONE;
    0 => int device;

    time lastTime;
    time currTime;

    float lastAxis[6];
    float axis[6];

    fun @construct() {
        __init(0);
    }

    fun @construct(int device_in) {
        __init(device_in);
    }

    fun @construct(int device_in, float deadzone_in) {
        deadzone_in => DEADZONE;
        __init(device_in);
    }


    fun void __init(int device_in) {
        Hid trak;
        device_in => device;
        // open joystick 0, default to kb mode if fail
        if( !trak.openJoystick( device ) ) 1 => keyboard_mode;

        if (keyboard_mode) {
            <<< "launching kb mode","">>>;
            spork ~ keyboard_sim();
            <<< "Gametrack (keyboard simulation) launched", "" >>>;
        }
        else { // gt mode
            spork ~ gametrak();
            <<< "Gametrack (physical) launched", "" >>>;
        }
    }

    fun void gametrak() {
        Hid trak;
        HidMsg trak_msg;
        trak.openJoystick( device );
        while( true )
        {
            trak => now;

            while( trak.recv( trak_msg ) )
            {
                if( trak_msg.isAxisMotion() )
                {
                    if( trak_msg.which >= 0 && trak_msg.which < 6 )
                    {
                        if( now > currTime )
                        {
                            currTime => lastTime;
                            now => currTime;
                        }
                        axis[trak_msg.which] => lastAxis[trak_msg.which];

                        if( trak_msg.which != 2 && trak_msg.which != 5 )
                        {
                            trak_msg.axisPosition => axis[trak_msg.which];
                        }
                        else
                        {
                            1 - ((trak_msg.axisPosition + 1) / 2) - DEADZONE => axis[trak_msg.which];
                            if( axis[trak_msg.which] < 0 ) 0 => axis[trak_msg.which];
                        }
                    }
                }

                else if( trak_msg.isButtonDown() )
                {
                    <<< "button", trak_msg.which, "down" >>>;
                }

                else if( trak_msg.isButtonUp() )
                {
                    <<< "button", trak_msg.which, "up" >>>;
                }
            }
        }
    }



    fun void keyboard_sim() {
        <<< "enter keyboard_sim" >>>;
        int key_held[256]; // ascii index map to bool held
        spork ~ kb_listener(key_held);

        @(0., 0., 0.) => vec3 left_pos;
        @(0., 0., 0.) => vec3 right_pos;
        @(0., 0., 0.) => vec3 gt_left;
        @(0., 0., 0.) => vec3 gt_right;

        while(true) {
            left_update(key_held) +=> left_pos;
            Math.clampf(left_pos.x, -1., 1.) => left_pos.x;
            Math.clampf(left_pos.y, -1., 1.) => left_pos.y;
            Math.clampf(left_pos.z, 0., 1.) => left_pos.z;
            right_update(key_held) +=> right_pos;
            Math.clampf(right_pos.x, -1., 1.) => right_pos.x;
            Math.clampf(right_pos.y, -1., 1.) => right_pos.y;
            Math.clampf(right_pos.z, 0., 1.) => right_pos.z;
            // <<< left_pos, right_pos >>>;

            xyz_to_gt_pos(left_pos) => gt_left;
            xyz_to_gt_pos(right_pos) => gt_right;
            // <<< gt_left, gt_right >>>;

            for (0 => int i; i < 6; i++) {
                axis[i] => lastAxis[i];
            }
            Math.clampf(gt_left.x, -1., 1.) => axis[0];
            Math.clampf(gt_left.y, -1., 1.) => axis[1];
            Math.clampf(gt_left.z, 0., 1.) => axis[2];
            Math.clampf(gt_right.x, -1., 1.) => axis[3];
            Math.clampf(gt_right.y, -1., 1.) => axis[4];
            Math.clampf(gt_right.z, 0., 1.) => axis[5];
            currTime => lastTime;
            now => currTime;
            1::ms => now;
        }

    }


    // ---------------- utils ----------------

    fun void kb_listener(int key_held[]) {
        Hid kb;
        HidMsg kb_msg;
        if (!kb.openKeyboard(0)) me.exit();

        while (true) {
            kb => now;
            while (kb.recv(kb_msg)) {
                if (kb_msg.isButtonDown()) 1 => key_held[kb_msg.which];
                else if (kb_msg.isButtonUp()) 0 => key_held[kb_msg.which];
                else <<< "huh?? at ", kb_msg.which >>>;
                // <<< kb_msg.which >>>;
            }
        }
    }

    0.001 => float u_scale;
    fun vec3 left_update(int key_held[]) {
        @(0., 0., 0.) => vec3 offset;
        if (key_held[4]) @(-1., 0., 0.) +=> offset;   // a
        if (key_held[7]) @(1., 0., 0.) +=> offset;    // d
        if (key_held[26]) @(0., 1., 0.) +=> offset;   // w
        if (key_held[22]) @(0., -1., 0.) +=> offset;  // s
        if (key_held[8]) @(0., 0., 1.) +=> offset;    // e
        if (key_held[20]) @(0., 0., -1.) +=> offset;  // q
        return u_scale * offset;
    }
    fun vec3 right_update(int key_held[]) {
        @(0., 0., 0.) => vec3 offset;
        if (key_held[13]) @(-1., 0., 0.) +=> offset;  // j
        if (key_held[15]) @(1., 0., 0.) +=> offset;   // l
        if (key_held[12]) @(0., 1., 0.) +=> offset;   // i
        if (key_held[14]) @(0., -1., 0.) +=> offset;  // k
        if (key_held[18]) @(0., 0., 1.) +=> offset;   // o
        if (key_held[24]) @(0., 0., -1.) +=> offset;  // u
        return u_scale * offset;
    }

    1. => float t_scale;
    // this one is probably buggy ==> TODO check constants
    fun vec3 gt_pos_to_xyz(float lr, float fb, float mag) {
        mag * Math.sin(Math.pi / 3. * lr) => float x;
        0 - mag * Math.sin(Math.pi / 3. * fb) => float z;
        mag * (1 - Math.pow(Math.sin(Math.pi / 3. * lr), 2) - Math.pow(Math.sin(Math.pi / 3. * fb), 2))=> float y;
        @(t_scale*x, t_scale*y, t_scale*z) => vec3 ret;
        return ret;
    }

    fun vec3 xyz_to_gt_pos(vec3 pos) {
        0.0001 => float eps;
        Math.clampf(Math.sqrt(Math.pow(pos.x, 2) + Math.pow(pos.y, 2) + Math.pow(pos.z, 2)), 0., 1.) => float mag;
        Math.asin(pos.x/(mag+eps)) / (Math.PI / 2.) => float lr;
        Math.asin(pos.y/(mag+eps)) / (Math.PI / 2.) => float fb;
        @(1./t_scale*lr, 1./t_scale*fb, 1./t_scale*(mag)) => vec3 ret;
        return ret;
    }

    //accessors so movement code doesn't have to deal w/ axis index magic numbers
    fun float left_x()  { return axis[0]; }
    fun float left_y()  { return axis[1]; }
    fun float left_z()  { return axis[2]; }
    fun float right_x() { return axis[3]; }
    fun float right_y() { return axis[4]; }
    fun float right_z() { return axis[5]; }
}
