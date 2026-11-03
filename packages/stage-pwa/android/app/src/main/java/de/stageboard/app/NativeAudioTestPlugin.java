package de.stageboard.app;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioAttributes;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRouting;
import android.media.AudioTimestamp;
import android.media.AudioTrack;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

import java.util.ArrayList;
import java.util.List;

/**
 * Spike for #481 step 2 (not for production): can the app drive more than the WebView's 2 output
 * channels natively? Lists the outputs with the channel counts Android reports, plays a test tone
 * through an AudioTrack with a discrete channel index mask on chosen channels of a USB interface,
 * and logs routing changes / unplug events with timestamps (basis for the "safe stop").
 */
@CapacitorPlugin(name = "NativeAudioTest")
public class NativeAudioTestPlugin extends Plugin {
    private static final int RATE = 48000;
    private AudioManager audioManager;
    private AudioDeviceCallback callback;
    private final List<JSObject> events = new ArrayList<>();
    private volatile AudioTrack track;
    private volatile boolean stopRequested;

    @Override
    public void load() {
        audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        callback = new AudioDeviceCallback() {
            @Override
            public void onAudioDevicesAdded(AudioDeviceInfo[] added) {
                for (AudioDeviceInfo d : added) event("added", d);
            }

            @Override
            public void onAudioDevicesRemoved(AudioDeviceInfo[] removed) {
                for (AudioDeviceInfo d : removed) event("removed", d);
            }
        };
        audioManager.registerAudioDeviceCallback(callback, new Handler(Looper.getMainLooper()));
    }

    private synchronized void event(String kind, AudioDeviceInfo d) {
        JSObject e = new JSObject();
        e.put("t", SystemClock.elapsedRealtime());
        e.put("kind", kind);
        if (d != null) {
            e.put("type", d.getType());
            e.put("name", String.valueOf(d.getProductName()));
            e.put("sink", d.isSink());
        }
        events.add(e);
    }

    @PluginMethod
    public void listOutputs(PluginCall call) {
        JSArray list = new JSArray();
        for (AudioDeviceInfo d : audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
            JSObject o = new JSObject();
            o.put("id", d.getId());
            o.put("type", d.getType());
            o.put("name", String.valueOf(d.getProductName()));
            o.put("channelCounts", toJson(d.getChannelCounts()));
            o.put("channelIndexMasks", toJson(d.getChannelIndexMasks()));
            o.put("channelMasks", toJson(d.getChannelMasks()));
            o.put("sampleRates", toJson(d.getSampleRates()));
            o.put("encodings", toJson(d.getEncodings()));
            list.put(o);
        }
        JSObject r = new JSObject();
        r.put("outputs", list);
        call.resolve(r);
    }

    @PluginMethod
    public synchronized void events(PluginCall call) {
        JSArray list = new JSArray();
        for (JSObject e : events) list.put(e);
        events.clear();
        JSObject r = new JSObject();
        r.put("now", SystemClock.elapsedRealtime());
        r.put("events", list);
        call.resolve(r);
    }

    /**
     * Plays a sine on the given channels (0-based) of a track with `channels` discrete channels,
     * routed to the first USB output. Options: channels (default 4), play (array, default [2,3]),
     * seconds (default 2), freq (default 440, +220 Hz per further channel), gainDb (default -30).
     */
    @PluginMethod
    public void playTone(PluginCall call) {
        int channels = call.getInt("channels", 4);
        JSONArray play = call.getArray("play", new JSArray());
        List<Integer> on = new ArrayList<>();
        for (int i = 0; i < play.length(); i++) on.add(play.optInt(i));
        if (on.isEmpty()) { on.add(2); on.add(3); }
        double seconds = call.getDouble("seconds", 2.0);
        double freq = call.getDouble("freq", 440.0);
        double gain = Math.pow(10, call.getDouble("gainDb", -30.0) / 20);

        AudioDeviceInfo usb = null;
        for (AudioDeviceInfo d : audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
            int t = d.getType();
            if (t == AudioDeviceInfo.TYPE_USB_DEVICE || t == AudioDeviceInfo.TYPE_USB_HEADSET) { usb = d; break; }
        }
        if (usb == null) { call.reject("no USB output"); return; }

        AudioTrack t;
        try {
            AudioFormat format = new AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
                    .setSampleRate(RATE)
                    .setChannelIndexMask((1 << channels) - 1)
                    .build();
            int min = AudioTrack.getMinBufferSize(RATE, format.getChannelMask() != 0 ? format.getChannelMask() : AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_FLOAT);
            t = new AudioTrack.Builder()
                    .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                    .setAudioFormat(format)
                    .setBufferSizeInBytes(Math.max(min, RATE / 50 * channels * 4) * 2)
                    .setTransferMode(AudioTrack.MODE_STREAM)
                    .setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY)
                    .build();
        } catch (Exception e) {
            call.reject("AudioTrack failed: " + e);
            return;
        }
        t.setPreferredDevice(usb);
        t.addOnRoutingChangedListener((AudioRouting router) -> event("routed", router.getRoutedDevice()), new Handler(Looper.getMainLooper()));
        track = t;
        stopRequested = false;

        final AudioTrack ft = t;
        final List<Integer> fon = on;
        final int fch = channels;
        final AudioDeviceInfo fusb = usb;
        new Thread(() -> {
            int frames = (int) (seconds * RATE), block = RATE / 100;
            float[] buf = new float[block * fch];
            long t0 = SystemClock.elapsedRealtime();
            ft.play();
            int written = 0;
            long writeErrors = 0;
            while (written < frames && !stopRequested) {
                for (int i = 0; i < block; i++) {
                    int n = written + i;
                    for (int c = 0; c < fch; c++) buf[i * fch + c] = 0f;
                    for (int k = 0; k < fon.size(); k++) {
                        int c = fon.get(k);
                        if (c < fch) buf[i * fch + c] = (float) (gain * Math.sin(2 * Math.PI * (freq + 220 * k) * n / RATE));
                    }
                }
                int w = ft.write(buf, 0, buf.length, AudioTrack.WRITE_BLOCKING);
                if (w < 0) { writeErrors++; break; }
                written += block;
            }
            AudioTimestamp ts = new AudioTimestamp();
            boolean hasTs = ft.getTimestamp(ts);
            JSObject r = new JSObject();
            r.put("trackChannels", ft.getChannelCount());
            r.put("indexMask", ft.getFormat().getChannelIndexMask());
            r.put("sampleRate", ft.getSampleRate());
            AudioDeviceInfo routed = ft.getRoutedDevice();
            r.put("routedTo", routed == null ? "null" : routed.getProductName() + " (type " + routed.getType() + ")");
            r.put("preferred", fusb.getProductName() + " (type " + fusb.getType() + ")");
            r.put("bufferFrames", ft.getBufferSizeInFrames());
            r.put("underruns", ft.getUnderrunCount());
            r.put("performanceMode", ft.getPerformanceMode());
            r.put("framesWritten", written);
            r.put("writeErrors", writeErrors);
            r.put("stoppedEarly", stopRequested);
            r.put("ms", SystemClock.elapsedRealtime() - t0);
            if (hasTs) {
                // Output latency estimate: frames written vs. frames presented at the timestamp.
                long nowNs = System.nanoTime();
                long presentedNow = ts.framePosition + (nowNs - ts.nanoTime) * RATE / 1_000_000_000L;
                r.put("latencyMsEstimate", (written - presentedNow) * 1000.0 / RATE);
            }
            ft.stop();
            ft.release();
            track = null;
            call.resolve(r);
        }).start();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopRequested = true;
        call.resolve();
    }

    // --- AAudio variant (native, src/main/cpp): stream on one fixed device, disconnects instead of rerouting.

    private static boolean nativeLoaded;

    private static synchronized boolean loadNative() {
        if (nativeLoaded) return true;
        if (android.os.Build.VERSION.SDK_INT < 26) return false;  // AAudio from Android 8
        try {
            System.loadLibrary("native_audio_test");
            nativeLoaded = true;
        } catch (Throwable t) {
            nativeLoaded = false;
        }
        return nativeLoaded;
    }

    private static native String aaudioStart(int deviceId, int channels, int playMask, double freq, double gainDb, boolean exclusive);

    private static native String aaudioStatus();

    private static native void aaudioStop();

    /** Options: channels (default 4), play (0-based, default [2,3]), freq, gainDb (default -30), exclusive (default true). */
    @PluginMethod
    public void aaudioStart(PluginCall call) {
        if (!loadNative()) { call.reject("AAudio not available"); return; }
        AudioDeviceInfo usb = null;
        for (AudioDeviceInfo d : audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
            int t = d.getType();
            if (t == AudioDeviceInfo.TYPE_USB_DEVICE || t == AudioDeviceInfo.TYPE_USB_HEADSET) { usb = d; break; }
        }
        if (usb == null) { call.reject("no USB output"); return; }
        JSONArray play = call.getArray("play", new JSArray());
        int mask = 0;
        for (int i = 0; i < play.length(); i++) mask |= 1 << play.optInt(i);
        if (mask == 0) mask = (1 << 2) | (1 << 3);
        String r = aaudioStart(usb.getId(), call.getInt("channels", 4), mask, call.getDouble("freq", 440.0),
                call.getDouble("gainDb", -30.0), call.getBoolean("exclusive", true));
        resolveJson(call, r);
    }

    @PluginMethod
    public void aaudioStatus(PluginCall call) {
        if (!loadNative()) { call.reject("AAudio not available"); return; }
        resolveJson(call, aaudioStatus());
    }

    @PluginMethod
    public void aaudioStop(PluginCall call) {
        if (loadNative()) aaudioStop();
        call.resolve();
    }

    // --- Own USB driver (native, src/main/cpp/usb_audio_test.cpp): for devices whose Android USB
    // audio path is broken (Redmi Pad SE: detected, but the HAL never gets an isochronous stream
    // through). The app talks to the interface directly over a UsbDeviceConnection.

    private static native String usbStart(int fd, int epOut, int maxPacket, int epFb, int fbMaxPacket, int channels,
                                          int subslot, int rate, int playMask, int clickMask, int epIn, int inMaxPacket,
                                          int inChannels, int inSubslot, int inPackets, int inUrbs, double freq, double gainDb, double clickGainDb,
                                          boolean highSpeed);

    private static native String usbStatus();

    private static native void usbStop();

    private static native int usbReattachKernelDriver(int fd, int ifno);

    private static native int usbResetDevice(int fd);

    private static final String USB_PERMISSION = "de.stageboard.app.USB_AUDIO_PERMISSION";
    private UsbDeviceConnection usbConn;
    private UsbInterface usbAc, usbAs, usbAsIn;
    private boolean usbReattach = true;  // hand the interfaces back to Android's driver on close

    /** One alt setting of an audio streaming interface, from the class-specific descriptors. */
    private static final class AltInfo {
        int ifno, alt, channels, subslot, bits, epOut, maxPacket, epFb, fbMaxPacket, epIn, inMaxPacket;

        JSObject toJson() {
            JSObject o = new JSObject();
            o.put("ifno", ifno); o.put("alt", alt); o.put("channels", channels); o.put("subslot", subslot);
            o.put("bits", bits); o.put("epOut", epOut); o.put("maxPacket", maxPacket); o.put("epFb", epFb);
            o.put("fbMaxPacket", fbMaxPacket); o.put("epIn", epIn); o.put("inMaxPacket", inMaxPacket);
            return o;
        }
    }

    private static final class Descriptors {
        int acIf = -1, clockId = -1, protocol;
        final List<AltInfo> outs = new ArrayList<>();
        final List<AltInfo> ins = new ArrayList<>();
    }

    private static Descriptors parseDescriptors(byte[] d) {
        Descriptors r = new Descriptors();
        int curClass = -1, curSub = -1, curProto = 0;
        AltInfo cur = null;
        for (int i = 0; i + 1 < d.length; ) {
            int len = d[i] & 0xff, type = d[i + 1] & 0xff;
            if (len < 2 || i + len > d.length) break;
            if (type == 4 && len >= 9) {  // interface
                int ifno = d[i + 2] & 0xff, alt = d[i + 3] & 0xff;
                curClass = d[i + 5] & 0xff; curSub = d[i + 6] & 0xff; curProto = d[i + 7] & 0xff;
                cur = null;
                if (curClass == 1 && curSub == 1 && r.acIf < 0) { r.acIf = ifno; r.protocol = curProto; }
                if (curClass == 1 && curSub == 2 && alt > 0) { cur = new AltInfo(); cur.ifno = ifno; cur.alt = alt; }
            } else if (type == 0x24 && len >= 3) {  // class-specific interface
                int sub = d[i + 2] & 0xff;
                if (curClass == 1 && curSub == 1 && sub == 0x0A && r.clockId < 0 && len >= 4) r.clockId = d[i + 3] & 0xff;
                if (cur != null && curProto == 0x20) {  // UAC2
                    if (sub == 0x01 && len >= 11) cur.channels = d[i + 10] & 0xff;
                    if (sub == 0x02 && len >= 6) { cur.subslot = d[i + 4] & 0xff; cur.bits = d[i + 5] & 0xff; }
                } else if (cur != null && sub == 0x02 && len >= 7) {  // UAC1 format type I
                    cur.channels = d[i + 4] & 0xff; cur.subslot = d[i + 5] & 0xff; cur.bits = d[i + 6] & 0xff;
                }
            } else if (type == 5 && len >= 7 && cur != null) {  // endpoint
                int addr = d[i + 2] & 0xff, attr = d[i + 3] & 0xff;
                int raw = (d[i + 4] & 0xff) | ((d[i + 5] & 0xff) << 8);
                int mp = (raw & 0x7ff) * (((raw >> 11) & 3) + 1);
                if ((attr & 3) == 1) {
                    if ((addr & 0x80) == 0) { cur.epOut = addr; cur.maxPacket = mp; if (!r.outs.contains(cur)) r.outs.add(cur); }
                    else if (((attr >> 4) & 3) == 1) { cur.epFb = addr; cur.fbMaxPacket = mp; }
                    else if (cur.epOut == 0) { cur.epIn = addr; cur.inMaxPacket = mp; if (!r.ins.contains(cur)) r.ins.add(cur); }
                }
            }
            i += len;
        }
        return r;
    }

    private UsbDevice findUsbAudio(UsbManager um) {
        for (UsbDevice dev : um.getDeviceList().values()) {
            for (int i = 0; i < dev.getInterfaceCount(); i++) {
                UsbInterface it = dev.getInterface(i);
                if (it.getInterfaceClass() == 1 && it.getInterfaceSubclass() == 2) return dev;
            }
        }
        return null;
    }

    private static UsbInterface findInterface(UsbDevice dev, int id, int alt) {
        for (int i = 0; i < dev.getInterfaceCount(); i++) {
            UsbInterface it = dev.getInterface(i);
            if (it.getId() == id && it.getAlternateSetting() == alt) return it;
        }
        return null;
    }

    /**
     * Options: channels (default 4), play (0-based sine channels, default [0,1]), click (0-based channels for a burst
     * every 500 ms, for a loopback round trip), freq, gainDb (default -30), clickGainDb (default -20),
     * rate (default 48000), input (default true: also record and analyse the interface's input).
     * Asks for the USB permission first (dialog on the device) if the app does not have it yet.
     */
    @PluginMethod
    public void usbStart(PluginCall call) {
        if (!loadNative()) { call.reject("native library not available"); return; }
        UsbManager um = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
        UsbDevice dev = findUsbAudio(um);
        if (dev == null) { call.reject("no USB audio device"); return; }
        if (um.hasPermission(dev)) { usbOpenAndPlay(call, um, dev); return; }
        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent intent) {
                ctx.unregisterReceiver(this);
                if (intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)) usbOpenAndPlay(call, um, dev);
                else call.reject("USB permission denied");
            }
        };
        IntentFilter filter = new IntentFilter(USB_PERMISSION);
        if (android.os.Build.VERSION.SDK_INT >= 33) getContext().registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
        else getContext().registerReceiver(receiver, filter);
        int flags = android.os.Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
        Intent intent = new Intent(USB_PERMISSION).setPackage(getContext().getPackageName());
        um.requestPermission(dev, PendingIntent.getBroadcast(getContext(), 0, intent, flags));
    }

    private void usbOpenAndPlay(PluginCall call, UsbManager um, UsbDevice dev) {
        usbClose();
        usbReattach = call.getBoolean("reattach", true);
        UsbDeviceConnection conn = um.openDevice(dev);
        if (conn == null) { call.reject("openDevice failed"); return; }
        Descriptors desc = parseDescriptors(conn.getRawDescriptors());
        int channels = call.getInt("channels", 4);
        int rate = call.getInt("rate", 48000);
        AltInfo pick = null;
        for (AltInfo a : desc.outs) {
            if (a.channels < channels) continue;
            if (pick == null || a.bits > pick.bits) pick = a;
        }
        JSObject r = new JSObject();
        JSArray alts = new JSArray();
        for (AltInfo a : desc.outs) alts.put(a.toJson());
        JSArray inAlts = new JSArray();
        for (AltInfo a : desc.ins) inAlts.put(a.toJson());
        r.put("inAlts", inAlts);
        AltInfo in = null;
        for (AltInfo a : desc.ins) if (in == null || a.bits > in.bits) in = a;
        r.put("device", dev.getProductName());
        r.put("protocol", desc.protocol == 0x20 ? "UAC2" : "UAC1");
        r.put("acInterface", desc.acIf);
        r.put("clockId", desc.clockId);
        r.put("alts", alts);
        if (pick == null || desc.acIf < 0) { conn.close(); r.put("error", "no matching output alt setting"); call.resolve(r); return; }
        r.put("picked", pick.toJson());

        UsbInterface ac = findInterface(dev, desc.acIf, 0), as0 = findInterface(dev, pick.ifno, 0), asAlt = findInterface(dev, pick.ifno, pick.alt);
        boolean claimedAc = ac != null && conn.claimInterface(ac, true);
        boolean claimedAs = as0 != null && conn.claimInterface(as0, true);
        UsbInterface in0 = null, inAlt = null;
        if (in != null && call.getBoolean("input", true)) {
            in0 = findInterface(dev, in.ifno, 0);
            inAlt = findInterface(dev, in.ifno, in.alt);
            if (in0 == null || !conn.claimInterface(in0, true)) { in0 = null; in = null; }
        } else in = null;
        r.put("claimed", claimedAc && claimedAs);
        r.put("inputClaimed", in != null);
        if (!claimedAs) { conn.close(); r.put("error", "claimInterface failed"); call.resolve(r); return; }
        usbConn = conn; usbAc = claimedAc ? ac : null; usbAs = as0; usbAsIn = in0;

        conn.setInterface(as0);
        if (desc.protocol == 0x20 && desc.clockId >= 0) {
            byte[] le = {(byte) rate, (byte) (rate >> 8), (byte) (rate >> 16), (byte) (rate >> 24)};
            int idx = (desc.clockId << 8) | desc.acIf;
            r.put("setRate", conn.controlTransfer(0x21, 0x01, 0x0100, idx, le, 4, 1000));
            byte[] back = new byte[4];
            int n = conn.controlTransfer(0xA1, 0x01, 0x0100, idx, back, 4, 1000);
            r.put("rateReadBack", n == 4 ? (back[0] & 0xff) | ((back[1] & 0xff) << 8) | ((back[2] & 0xff) << 16) | ((back[3] & 0xff) << 24) : n);
        }
        r.put("setInterface", asAlt != null && conn.setInterface(asAlt));
        if (in != null) { r.put("picked_in", in.toJson()); r.put("setInterfaceIn", inAlt != null && conn.setInterface(inAlt)); }

        JSONArray play = call.getArray("play", new JSArray());
        int mask = 0;
        for (int i = 0; i < play.length(); i++) mask |= 1 << play.optInt(i);
        if (mask == 0 && !call.getData().has("play")) mask = 3;
        JSONArray click = call.getArray("click", new JSArray());
        int clickMask = 0;
        for (int i = 0; i < click.length(); i++) clickMask |= 1 << click.optInt(i);
        String started = usbStart(conn.getFileDescriptor(), pick.epOut, pick.maxPacket, pick.epFb, pick.fbMaxPacket,
                pick.channels, pick.subslot, rate, mask, clickMask, in == null ? 0 : in.epIn, in == null ? 0 : in.inMaxPacket,
                in == null ? 0 : in.channels, in == null ? 0 : in.subslot, call.getInt("inPackets", 8), call.getInt("inUrbs", 8), call.getDouble("freq", 440.0),
                call.getDouble("gainDb", -30.0), call.getDouble("clickGainDb", -20.0), desc.protocol == 0x20);
        r.put("native", started);
        call.resolve(r);
    }

    @PluginMethod
    public void usbStatus(PluginCall call) {
        if (!loadNative()) { call.reject("native library not available"); return; }
        resolveJson(call, usbStatus());
    }

    /** Stops a running stream and resets the USB device (it re-enumerates). */
    @PluginMethod
    public void usbReset(PluginCall call) {
        if (!loadNative()) { call.reject("native library not available"); return; }
        usbClose();
        UsbManager um = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
        UsbDevice dev = findUsbAudio(um);
        if (dev == null || !um.hasPermission(dev)) { call.reject("no USB audio device with permission"); return; }
        UsbDeviceConnection conn = um.openDevice(dev);
        if (conn == null) { call.reject("openDevice failed"); return; }
        int r = usbResetDevice(conn.getFileDescriptor());
        conn.close();
        JSObject o = new JSObject();
        o.put("reset", r);
        call.resolve(o);
    }

    @PluginMethod
    public void usbStop(PluginCall call) {
        usbClose();
        call.resolve();
    }

    /** Stops the stream, hands the interfaces back to Android's driver and closes the connection. */
    private void usbClose() {
        if (usbConn == null) return;
        if (loadNative()) usbStop();
        int fd = usbConn.getFileDescriptor();
        if (usbAs != null) { usbConn.setInterface(usbAs); usbConn.releaseInterface(usbAs); if (usbReattach) usbReattachKernelDriver(fd, usbAs.getId()); }
        if (usbAsIn != null) { usbConn.setInterface(usbAsIn); usbConn.releaseInterface(usbAsIn); if (usbReattach) usbReattachKernelDriver(fd, usbAsIn.getId()); }
        if (usbAc != null) { usbConn.releaseInterface(usbAc); if (usbReattach) usbReattachKernelDriver(fd, usbAc.getId()); }
        usbConn.close();
        usbConn = null; usbAc = null; usbAs = null; usbAsIn = null;
    }

    private static void resolveJson(PluginCall call, String json) {
        try {
            call.resolve(new JSObject(json));
        } catch (org.json.JSONException e) {
            call.reject("bad JSON from native: " + json);
        }
    }

    private static JSONArray toJson(int[] values) {
        JSONArray a = new JSONArray();
        for (int v : values) a.put(v);
        return a;
    }

    @Override
    protected void handleOnDestroy() {
        if (callback != null) audioManager.unregisterAudioDeviceCallback(callback);
        usbClose();
        stopRequested = true;
    }
}
