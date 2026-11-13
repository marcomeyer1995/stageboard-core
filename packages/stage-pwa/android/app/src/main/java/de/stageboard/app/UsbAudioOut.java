package de.stageboard.app;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;

import java.util.ArrayList;
import java.util.List;

/**
 * The own USB audio driver's Java half (docs/28 §4, #837): finds a USB audio interface, asks for the
 * permission (Android's dialog, once per plug-in), reads its descriptors, takes the streaming
 * interface from Android's driver, picks the alt setting and sets the rate. The isochronous stream
 * itself runs in native_output.cpp on the connection's file descriptor. Taken from the #481 spike,
 * output only.
 */
final class UsbAudioOut {
    static final String PERMISSION = "de.stageboard.app.USB_AUDIO_PERMISSION";

    /** What the native side needs, or why there is nothing to start. */
    static final class Opened {
        String error;
        String device;
        int fd, epOut, maxPacket, epFb, fbMaxPacket, channels, subslot;
        boolean highSpeed;
    }

    interface Permission {
        void result(boolean granted);
    }

    private static final class AltInfo {
        int ifno, alt, channels, subslot, bits, epOut, maxPacket, epFb, fbMaxPacket;
    }

    private static final class Descriptors {
        int acIf = -1, clockId = -1, protocol;
        final List<AltInfo> outs = new ArrayList<>();
    }

    private UsbDeviceConnection conn;
    private final List<UsbInterface> claimed = new ArrayList<>();

    /** The first device with an audio streaming interface. */
    static UsbDevice find(UsbManager um) {
        for (UsbDevice dev : um.getDeviceList().values()) {
            for (int i = 0; i < dev.getInterfaceCount(); i++) {
                UsbInterface it = dev.getInterface(i);
                if (it.getInterfaceClass() == 1 && it.getInterfaceSubclass() == 2) return dev;
            }
        }
        return null;
    }

    /** How long a plugged-in interface waits for Android's own "open StageBoard?" dialog to grant the
     * permission (the default-app filter in the manifest) before the app asks itself - asking at
     * once put two dialogs on screen (2026-11-13). */
    private static final long ATTACH_GRANT_WAIT_MS = 10_000;

    static void requestPermission(Context ctx, UsbManager um, UsbDevice dev, Permission done) {
        if (um.hasPermission(dev)) {
            done.result(true);
            return;
        }
        final android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());
        final long until = android.os.SystemClock.elapsedRealtime() + ATTACH_GRANT_WAIT_MS;
        handler.post(new Runnable() {
            @Override
            public void run() {
                if (um.hasPermission(dev)) {
                    done.result(true);
                } else if (android.os.SystemClock.elapsedRealtime() < until) {
                    handler.postDelayed(this, 250);
                } else {
                    ask(ctx, um, dev, done);
                }
            }
        });
    }

    private static void ask(Context ctx, UsbManager um, UsbDevice dev, Permission done) {
        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent intent) {
                c.unregisterReceiver(this);
                done.result(intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false));
            }
        };
        IntentFilter filter = new IntentFilter(PERMISSION);
        if (android.os.Build.VERSION.SDK_INT >= 33) ctx.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
        else ctx.registerReceiver(receiver, filter);
        int flags = android.os.Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
        Intent intent = new Intent(PERMISSION).setPackage(ctx.getPackageName());
        um.requestPermission(dev, PendingIntent.getBroadcast(ctx, 0, intent, flags));
    }

    /** Opens `dev` for stereo-or-more output at `rate`. On failure everything is given back. */
    Opened open(UsbManager um, UsbDevice dev, int rate) {
        close();
        Opened r = new Opened();
        r.device = dev.getProductName();
        UsbDeviceConnection c = um.openDevice(dev);
        if (c == null) {
            r.error = "openDevice failed";
            return r;
        }
        Descriptors desc = parse(c.getRawDescriptors());
        AltInfo pick = null;
        for (AltInfo a : desc.outs) {
            if (a.channels < 2 || a.subslot < 2) continue;
            // The most channels (in-ear and FOH on separate pairs, #743), then the most bits.
            if (pick == null || a.channels > pick.channels || (a.channels == pick.channels && a.bits > pick.bits)) pick = a;
        }
        if (pick == null || desc.acIf < 0) {
            c.close();
            r.error = "no output alt setting";
            return r;
        }
        UsbInterface ac = findInterface(dev, desc.acIf, 0), as0 = findInterface(dev, pick.ifno, 0), asAlt = findInterface(dev, pick.ifno, pick.alt);
        conn = c;
        if (ac != null && c.claimInterface(ac, true)) claimed.add(ac);
        if (as0 == null || asAlt == null || !c.claimInterface(as0, true)) {
            close();
            r.error = "claimInterface failed";
            return r;
        }
        claimed.add(as0);
        c.setInterface(as0);
        if (desc.protocol == 0x20 && desc.clockId >= 0) {
            byte[] le = {(byte) rate, (byte) (rate >> 8), (byte) (rate >> 16), (byte) (rate >> 24)};
            c.controlTransfer(0x21, 0x01, 0x0100, (desc.clockId << 8) | desc.acIf, le, 4, 1000);
        }
        if (!c.setInterface(asAlt)) {
            close();
            r.error = "setInterface failed";
            return r;
        }
        r.fd = c.getFileDescriptor();
        r.epOut = pick.epOut;
        r.maxPacket = pick.maxPacket;
        r.epFb = pick.epFb;
        r.fbMaxPacket = pick.fbMaxPacket;
        r.channels = pick.channels;
        r.subslot = pick.subslot;
        r.highSpeed = desc.protocol == 0x20;
        return r;
    }

    /** Gives the interfaces back - Android's own driver can take the device again. */
    void close() {
        if (conn == null) return;
        int fd = conn.getFileDescriptor();
        for (UsbInterface it : claimed) {
            conn.releaseInterface(it);
            // usbfs leaves the interface without a driver - Android's audio driver binds it again.
            NativeOutputPlugin.usbReattach(fd, it.getId());
        }
        claimed.clear();
        conn.close();
        conn = null;
    }

    private static UsbInterface findInterface(UsbDevice dev, int id, int alt) {
        for (int i = 0; i < dev.getInterfaceCount(); i++) {
            UsbInterface it = dev.getInterface(i);
            if (it.getId() == id && it.getAlternateSetting() == alt) return it;
        }
        return null;
    }

    /** UAC1/UAC2 class-specific descriptors: channels, format, endpoints per alt setting. */
    private static Descriptors parse(byte[] d) {
        Descriptors r = new Descriptors();
        int curClass = -1, curSub = -1, curProto = 0;
        AltInfo cur = null;
        for (int i = 0; i + 1 < d.length; ) {
            int len = d[i] & 0xff, type = d[i + 1] & 0xff;
            if (len < 2 || i + len > d.length) break;
            if (type == 4 && len >= 9) {  // interface
                int ifno = d[i + 2] & 0xff, alt = d[i + 3] & 0xff;
                curClass = d[i + 5] & 0xff;
                curSub = d[i + 6] & 0xff;
                curProto = d[i + 7] & 0xff;
                cur = null;
                if (curClass == 1 && curSub == 1 && r.acIf < 0) {
                    r.acIf = ifno;
                    r.protocol = curProto;
                }
                if (curClass == 1 && curSub == 2 && alt > 0) {
                    cur = new AltInfo();
                    cur.ifno = ifno;
                    cur.alt = alt;
                }
            } else if (type == 0x24 && len >= 3) {  // class-specific interface
                int sub = d[i + 2] & 0xff;
                if (curClass == 1 && curSub == 1 && sub == 0x0A && r.clockId < 0 && len >= 4) r.clockId = d[i + 3] & 0xff;
                if (cur != null && curProto == 0x20) {  // UAC2
                    if (sub == 0x01 && len >= 11) cur.channels = d[i + 10] & 0xff;
                    if (sub == 0x02 && len >= 6) {
                        cur.subslot = d[i + 4] & 0xff;
                        cur.bits = d[i + 5] & 0xff;
                    }
                } else if (cur != null && sub == 0x02 && len >= 7) {  // UAC1 format type I
                    cur.channels = d[i + 4] & 0xff;
                    cur.subslot = d[i + 5] & 0xff;
                    cur.bits = d[i + 6] & 0xff;
                }
            } else if (type == 5 && len >= 7 && cur != null) {  // endpoint
                int addr = d[i + 2] & 0xff, attr = d[i + 3] & 0xff;
                int raw = (d[i + 4] & 0xff) | ((d[i + 5] & 0xff) << 8);
                int mp = (raw & 0x7ff) * (((raw >> 11) & 3) + 1);
                if ((attr & 3) == 1) {
                    if ((addr & 0x80) == 0) {
                        cur.epOut = addr;
                        cur.maxPacket = mp;
                        if (!r.outs.contains(cur)) r.outs.add(cur);
                    } else if (((attr >> 4) & 3) == 1) {
                        cur.epFb = addr;
                        cur.fbMaxPacket = mp;
                    }
                }
            }
            i += len;
        }
        return r;
    }
}
