package de.stageboard.app;

import android.os.Build;
import android.os.Process;
import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;

/**
 * Native audio output (docs/30): plays the WebView's mix through AAudio, each frame at the
 * wall-clock time the app asks for (see native_output.cpp). On the Fire the WebView's own output
 * reports its latency up to 180 ms wrong, different at every app start; AAudio's timestamp is
 * truthful there and on every other device measured (2026-11-05). Needs Android 8 (AAudio).
 *
 * The frames come over a WebSocket on the loopback interface, sent by a Web Worker: the page's main
 * thread is busy for 200-350 ms at Play and Stop on the Fire, and frames handed over the Capacitor
 * bridge from there arrived too late (dropouts). A token in the URL keeps other apps out.
 */
@CapacitorPlugin(name = "NativeOutput")
public class NativeOutputPlugin extends Plugin {
    /** An output device came or went (#837): the page opens the stream again once it settled - one
     * opened while the device wasn't ready can run without a sound. Android reports every present
     * device right at registering - those first seconds are not a change. */
    private final android.media.AudioDeviceCallback deviceCallback = new android.media.AudioDeviceCallback() {
        @Override
        public void onAudioDevicesAdded(android.media.AudioDeviceInfo[] added) {
            if (hasOutput(added) && android.os.SystemClock.elapsedRealtime() - registeredAt > 3000) notifyListeners("outputDevicesChanged", new JSObject());
        }

        @Override
        public void onAudioDevicesRemoved(android.media.AudioDeviceInfo[] removed) {
            if (hasOutput(removed) && android.os.SystemClock.elapsedRealtime() - registeredAt > 3000) notifyListeners("outputDevicesChanged", new JSObject());
        }
    };

    private long registeredAt = 0;

    /** A USB audio interface plugged in: told at once, not after Android's audio side has taken it
     * up (the device callback, seconds later) - the own driver opens it right away (docs/28 §4). */
    private final android.content.BroadcastReceiver usbAttached = new android.content.BroadcastReceiver() {
        @Override
        public void onReceive(android.content.Context c, android.content.Intent intent) {
            android.hardware.usb.UsbDevice dev = intent.getParcelableExtra(android.hardware.usb.UsbManager.EXTRA_DEVICE);
            if (dev == null || !UsbAudioOut.isAudio(dev)) return;
            Log.i(TAG, "usb attached: " + dev.getProductName() + (usbRate > 0 ? " - resuming the own driver" : ""));
            if (usbRate > 0) resumeUsb(dev);
            else notifyListeners("usbAttached", new JSObject());
        }
    };

    /** The rate the own driver plays at, 0 while it doesn't: pulled and plugged in again, it goes on
     * by itself (nativeUsbResume) - silent meanwhile, never through Android's output. */
    private volatile int usbRate = 0;

    private void resumeUsb(android.hardware.usb.UsbDevice dev) {
        android.hardware.usb.UsbManager um = (android.hardware.usb.UsbManager) getContext().getSystemService(android.content.Context.USB_SERVICE);
        if (um == null) return;
        final long t0 = android.os.SystemClock.elapsedRealtime();
        UsbAudioOut.requestPermission(getContext(), um, dev, (granted) -> {
            String result;
            long tPermission = android.os.SystemClock.elapsedRealtime(), tOpen = tPermission;
            synchronized (this) {
                int rate = usbRate;
                if (rate == 0) return;
                if (!granted) result = "permission denied";
                else {
                    nativeUsbStop();  // before the old connection closes - see native_output.cpp
                    UsbAudioOut.Opened o = usb.open(um, dev, rate);
                    tOpen = android.os.SystemClock.elapsedRealtime();
                    if (o.error != null) result = o.error;
                    else {
                        result = nativeUsbResume(o.fd, o.epOut, o.maxPacket, o.epFb, o.fbMaxPacket, o.channels, o.subslot, rate, o.highSpeed);
                        if (result.contains("\"error\"")) usb.close();
                    }
                }
            }
            long tEnd = android.os.SystemClock.elapsedRealtime();
            Log.i(TAG, "usb resume: " + result + " - permission " + (tPermission - t0) + " ms, open " + (tOpen - tPermission) + " ms, start " + (tEnd - tOpen) + " ms");
            JSObject event = new JSObject();
            event.put("resumed", !result.contains("error") && !result.equals("permission denied"));
            notifyListeners("usbAttached", event);
        });
    }

    private static boolean hasOutput(android.media.AudioDeviceInfo[] devices) {
        for (android.media.AudioDeviceInfo d : devices) if (d.isSink()) return true;
        return false;
    }

    @Override
    public void load() {
        android.media.AudioManager audio = (android.media.AudioManager) getContext().getSystemService(android.content.Context.AUDIO_SERVICE);
        registeredAt = android.os.SystemClock.elapsedRealtime();
        if (audio != null) audio.registerAudioDeviceCallback(deviceCallback, new android.os.Handler(android.os.Looper.getMainLooper()));
        android.content.IntentFilter filter = new android.content.IntentFilter(android.hardware.usb.UsbManager.ACTION_USB_DEVICE_ATTACHED);
        if (android.os.Build.VERSION.SDK_INT >= 33) getContext().registerReceiver(usbAttached, filter, android.content.Context.RECEIVER_NOT_EXPORTED);
        else getContext().registerReceiver(usbAttached, filter);
    }

    private static final String TAG = "NativeOutput";
    private static final String WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    private static boolean loaded;
    private ServerSocket server;
    private String token;

    private static boolean available() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false;
        if (!loaded) {
            System.loadLibrary("native_output");
            loaded = true;
        }
        return true;
    }

    private static native String nativeStart(int sampleRate, boolean lowLatency);

    // The own USB driver (docs/28 §4, #837): the stream on the interface's file descriptor.
    private static native String nativeUsbStart(int fd, int epOut, int maxPacket, int epFb, int fbMaxPacket, int channels, int subslot, int sampleRate, boolean highSpeed);

    private static native int nativeUsbReattach(int fd, int ifno);

    private static native void nativeUsbStop();

    private static native String nativeUsbResume(int fd, int epOut, int maxPacket, int epFb, int fbMaxPacket, int channels, int subslot, int sampleRate, boolean highSpeed);

    static void usbReattach(int fd, int ifno) {
        if (available()) nativeUsbReattach(fd, ifno);
    }

    private final UsbAudioOut usb = new UsbAudioOut();

    private static native void nativePush(long frame, short[] data, double baseMs);

    private static native String nativeStatus();

    private static native void nativeStop();

    // The engine core in the callback (docs/30 §8h stage 3, native_output.cpp).
    private static native void nativeEngineEnable(boolean on);

    private static native void nativeEngineTransport(int status, double startedAt, double accumulatedMs, double rate, boolean hasJump, double jumpAt, double jumpToMs, double jumpRate);

    private static native void nativeEngineBeats(double[] songMs, boolean[] accent);

    private static native void nativeEngineOffset(double offsetMs);

    private static native void nativeEngineGain(int bus, float gain);

    private static native void nativeEngineFeeds(int bus, int left, int right);

    // Streamed Opus clips (docs/30 §8h stage 4): the file in pieces, then placed.
    private static native void nativeClipBegin(int id, int size);

    private static native boolean nativeClipChunk(int id, int offset, byte[] data);

    private static native String nativeClipCommit(int id, double songStartMs, int bus, float gain);

    private static native void nativeClipRemove(int id);

    private static native void nativeClipGain(int id, float gain);

    private static native String nativeAnnounceCommit(int id, double rate, double songStartMs, int bus, float gain, byte[] pcm, int[] wordFrames, double[] starts, int[] wordOf);

    /** A JS number of any size: a large one without decimals arrives as a Long, which
     * getDouble() doesn't handle - it falls back to its default then. */
    private static double num(PluginCall call, String key) {
        return call.getData().optDouble(key, 0.0);
    }

    private void resolveJson(PluginCall call, String json) {
        try {
            call.resolve(new JSObject(json));
        } catch (JSONException e) {
            call.reject(json);
        }
    }

    /**
     * {sampleRate, lowLatency, usb}: with `usb` and a USB audio interface plugged in, the own driver
     * (asks for the permission first - Android's dialog); anything failing there, or no interface:
     * AAudio, with `usbError` saying why.
     */
    @PluginMethod
    public void start(PluginCall call) {
        if (!available()) {
            call.reject("unavailable");
            return;
        }
        int rate = (int) num(call, "sampleRate");
        android.hardware.usb.UsbManager um = (android.hardware.usb.UsbManager) getContext().getSystemService(android.content.Context.USB_SERVICE);
        android.hardware.usb.UsbDevice dev = call.getBoolean("usb", false) && um != null ? UsbAudioOut.find(um) : null;
        usbRate = 0;
        if (dev == null) {
            finishStart(call, nativeStart(rate, call.getBoolean("lowLatency", true)), null);
            return;
        }
        UsbAudioOut.requestPermission(getContext(), um, dev, (granted) -> {
            String usbError;
            if (!granted) usbError = "permission denied";
            else {
                synchronized (this) {
                    nativeUsbStop();  // before the old connection closes - see native_output.cpp
                    UsbAudioOut.Opened o = usb.open(um, dev, rate);
                    if (o.error == null) {
                        String result = nativeUsbStart(o.fd, o.epOut, o.maxPacket, o.epFb, o.fbMaxPacket, o.channels, o.subslot, rate, o.highSpeed);
                        if (!result.contains("\"error\"")) {
                            usbRate = rate;
                            finishStart(call, result, null);
                            return;
                        }
                        usb.close();
                        usbError = result;
                    } else usbError = o.error;
                }
            }
            finishStart(call, nativeStart(rate, call.getBoolean("lowLatency", true)), usbError);
        });
    }

    private void finishStart(PluginCall call, String result, String usbError) {
        try {
            JSObject out = new JSObject(result);
            startServer();
            out.put("port", server.getLocalPort());
            out.put("token", token);
            if (usbError != null) out.put("usbError", usbError);
            call.resolve(out);
        } catch (JSONException | IOException e) {
            call.reject(e.getMessage() != null ? e.getMessage() : result);
        }
    }

    private synchronized void startServer() throws IOException {
        if (server != null && !server.isClosed()) return;
        byte[] random = new byte[16];
        new SecureRandom().nextBytes(random);
        token = Base64.encodeToString(random, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        server = new ServerSocket(0, 2, InetAddress.getByName("127.0.0.1"));
        final ServerSocket listening = server;
        Thread accept = new Thread(() -> {
            while (!listening.isClosed()) {
                try {
                    Socket socket = listening.accept();
                    Thread reader = new Thread(() -> serve(socket), "NativeOutputWs");
                    reader.start();
                } catch (IOException e) {
                    return;
                }
            }
        }, "NativeOutputAccept");
        accept.setDaemon(true);
        accept.start();
    }

    /** One WebSocket client: the handshake, then binary messages - [first frame f64, baseMs f64,
     * interleaved stereo int16...], little-endian. */
    private void serve(Socket socket) {
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO);
        try (Socket s = socket) {
            s.setTcpNoDelay(true);
            InputStream in = s.getInputStream();
            OutputStream out = s.getOutputStream();
            String request = readHeaders(in);
            String key = header(request, "sec-websocket-key");
            if (key == null || !request.startsWith("GET /" + token + " ")) return;
            String accept = Base64.encodeToString(MessageDigest.getInstance("SHA-1").digest((key + WS_GUID).getBytes(StandardCharsets.US_ASCII)), Base64.NO_WRAP);
            out.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
            out.flush();
            DataInputStream data = new DataInputStream(in);
            byte[] mask = new byte[4];
            while (true) {
                int b0 = data.readUnsignedByte();
                int b1 = data.readUnsignedByte();
                long len = b1 & 0x7f;
                if (len == 126) len = data.readUnsignedShort();
                else if (len == 127) len = data.readLong();
                boolean masked = (b1 & 0x80) != 0;
                if (masked) data.readFully(mask);
                byte[] payload = new byte[(int) len];
                data.readFully(payload);
                if (masked) for (int i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
                int opcode = b0 & 0x0f;
                if (opcode == 8) return;
                if (opcode != 2 || payload.length < 16) continue;
                ByteBuffer buf = ByteBuffer.wrap(payload).order(ByteOrder.LITTLE_ENDIAN);
                long frame = (long) buf.getDouble(0);
                double baseMs = buf.getDouble(8);
                short[] pcm = new short[(payload.length - 16) / 2];
                buf.position(16);
                buf.asShortBuffer().get(pcm);
                nativePush(frame, pcm, baseMs);
            }
        } catch (Exception e) {
            Log.i(TAG, "connection ended: " + e);
        }
    }

    private static String readHeaders(InputStream in) throws IOException {
        ByteArrayOutputStream head = new ByteArrayOutputStream();
        int matched = 0;
        while (matched < 4 && head.size() < 8192) {
            int c = in.read();
            if (c < 0) throw new IOException("closed");
            head.write(c);
            matched = (c == (matched % 2 == 0 ? '\r' : '\n')) ? matched + 1 : (c == '\r' ? 1 : 0);
        }
        return head.toString("US-ASCII");
    }

    private static String header(String request, String name) {
        for (String line : request.split("\r\n")) {
            int colon = line.indexOf(':');
            if (colon > 0 && line.substring(0, colon).trim().equalsIgnoreCase(name)) return line.substring(colon + 1).trim();
        }
        return null;
    }

    @PluginMethod
    public void usbPresent(PluginCall call) {
        android.hardware.usb.UsbManager um = (android.hardware.usb.UsbManager) getContext().getSystemService(android.content.Context.USB_SERVICE);
        JSObject out = new JSObject();
        out.put("present", um != null && UsbAudioOut.find(um) != null);
        call.resolve(out);
    }

    @PluginMethod
    public void status(PluginCall call) {
        if (!available()) {
            call.reject("unavailable");
            return;
        }
        resolveJson(call, nativeStatus());
    }

    @PluginMethod
    public void stop(PluginCall call) {
        usbRate = 0;
        if (available()) nativeStop();
        synchronized (this) {
            usb.close();
        }
        synchronized (this) {
            try {
                if (server != null) server.close();
            } catch (IOException ignored) {
                // closing anyway
            }
            server = null;
        }
        call.resolve();
    }

    /** The engine core's plan (docs/30 §8h stage 3). Each resolves at once - JS doesn't wait for the
     * answer: on a locked screen answers can be held back for minutes (Fire, 2026-11-10), the calls
     * themselves arrive. One at a time (synchronized): the engine's queue has one writer. */
    @PluginMethod
    public synchronized void engineEnable(PluginCall call) {
        if (available()) nativeEngineEnable(Boolean.TRUE.equals(call.getBoolean("on", false)));
        call.resolve();
    }

    @PluginMethod
    public synchronized void engineTransport(PluginCall call) {
        if (available()) {
            nativeEngineTransport((int) num(call, "status"), num(call, "startedAt"), num(call, "accumulatedMs"), call.getData().optDouble("rate", 1.0),
                    Boolean.TRUE.equals(call.getBoolean("hasJump", false)), num(call, "jumpAt"), num(call, "jumpToMs"), call.getData().optDouble("jumpRate", 1.0));
        }
        call.resolve();
    }

    @PluginMethod
    public synchronized void engineBeats(PluginCall call) {
        JSArray times = call.getArray("songMs", new JSArray());
        JSArray accents = call.getArray("accent", new JSArray());
        int n = Math.min(times.length(), accents.length());
        double[] songMs = new double[n];
        boolean[] accent = new boolean[n];
        for (int i = 0; i < n; i++) {
            songMs[i] = times.optDouble(i, 0.0);
            accent[i] = accents.optInt(i, 0) != 0;
        }
        if (available()) nativeEngineBeats(songMs, accent);
        call.resolve();
    }

    @PluginMethod
    public synchronized void engineOffset(PluginCall call) {
        if (available()) nativeEngineOffset(num(call, "offsetMs"));
        call.resolve();
    }

    /** {bus, left, right}: where a source goes on the output - engine.h Feed (0 L, 1 R, 2 both, 3 none). */
    @PluginMethod
    public synchronized void engineFeeds(PluginCall call) {
        if (available()) nativeEngineFeeds((int) num(call, "bus"), (int) num(call, "left"), (int) num(call, "right"));
        call.resolve();
    }

    @PluginMethod
    public synchronized void clipBegin(PluginCall call) {
        if (available()) nativeClipBegin((int) num(call, "id"), (int) num(call, "size"));
        call.resolve();
    }

    /** {id, offset, data}: `data` base64 - the bridge carries strings. */
    @PluginMethod
    public synchronized void clipChunk(PluginCall call) {
        String data = call.getString("data", "");
        boolean ok = available() && nativeClipChunk((int) num(call, "id"), (int) num(call, "offset"), android.util.Base64.decode(data, android.util.Base64.DEFAULT));
        com.getcapacitor.JSObject r = new com.getcapacitor.JSObject();
        r.put("ok", ok);
        call.resolve(r);
    }

    /** {id, songStartMs, bus, gain} → {error}: "" when the clip plays. */
    @PluginMethod
    public synchronized void clipCommit(PluginCall call) {
        String error = available() ? nativeClipCommit((int) num(call, "id"), num(call, "songStartMs"), (int) num(call, "bus"), (float) call.getData().optDouble("gain", 1.0)) : "native output not available";
        com.getcapacitor.JSObject r = new com.getcapacitor.JSObject();
        r.put("error", error);
        call.resolve(r);
    }

    /**
     * {id, rate, songStartMs, bus, gain, words, starts, wordOf} → {error}: the spoken announcements
     * of a song as one clip (#835). `words`: each word once, mono int16 little-endian, base64;
     * `starts`: where each one is said, in frames of `rate` from `songStartMs`; `wordOf`: which word.
     */
    @PluginMethod
    public synchronized void announceCommit(PluginCall call) {
        String error;
        try {
            org.json.JSONArray words = call.getData().getJSONArray("words");
            org.json.JSONArray starts = call.getData().getJSONArray("starts");
            org.json.JSONArray wordOf = call.getData().getJSONArray("wordOf");
            java.io.ByteArrayOutputStream pcm = new java.io.ByteArrayOutputStream();
            int[] frames = new int[words.length()];
            for (int i = 0; i < words.length(); i++) {
                byte[] w = android.util.Base64.decode(words.getString(i), android.util.Base64.DEFAULT);
                frames[i] = w.length / 2;
                pcm.write(w, 0, frames[i] * 2);
            }
            double[] at = new double[starts.length()];
            int[] which = new int[starts.length()];
            for (int i = 0; i < at.length && i < wordOf.length(); i++) {
                at[i] = starts.getDouble(i);
                which[i] = wordOf.getInt(i);
            }
            error = available()
                ? nativeAnnounceCommit((int) num(call, "id"), num(call, "rate"), num(call, "songStartMs"), (int) num(call, "bus"), (float) call.getData().optDouble("gain", 1.0), pcm.toByteArray(), frames, at, which)
                : "native output not available";
        } catch (JSONException e) {
            error = "bad announcements: " + e.getMessage();
        }
        com.getcapacitor.JSObject r = new com.getcapacitor.JSObject();
        r.put("error", error);
        call.resolve(r);
    }

    @PluginMethod
    public synchronized void clipRemove(PluginCall call) {
        if (available()) nativeClipRemove((int) num(call, "id"));
        call.resolve();
    }

    @PluginMethod
    public synchronized void clipGain(PluginCall call) {
        if (available()) nativeClipGain((int) num(call, "id"), (float) call.getData().optDouble("gain", 1.0));
        call.resolve();
    }

    @PluginMethod
    public synchronized void engineGain(PluginCall call) {
        if (available()) nativeEngineGain((int) num(call, "bus"), (float) call.getData().optDouble("gain", 1.0));
        call.resolve();
    }
}
