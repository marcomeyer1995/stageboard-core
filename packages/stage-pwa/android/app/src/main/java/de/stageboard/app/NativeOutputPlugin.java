package de.stageboard.app;

import android.content.Intent;
import android.os.Build;
import android.os.Process;
import android.util.Base64;
import android.util.Log;

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

    private static native String nativeStart(int sampleRate);

    private static native void nativePush(long frame, short[] data, double baseMs);

    private static native String nativeStatus();

    private static native void nativeStop();

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

    @PluginMethod
    public void start(PluginCall call) {
        if (!available()) {
            call.reject("unavailable");
            return;
        }
        String result = nativeStart((int) num(call, "sampleRate"));
        try {
            JSObject out = new JSObject(result);
            startServer();
            out.put("port", server.getLocalPort());
            out.put("token", token);
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
    public void status(PluginCall call) {
        if (!available()) {
            call.reject("unavailable");
            return;
        }
        resolveJson(call, nativeStatus());
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (available()) nativeStop();
        synchronized (this) {
            try {
                if (server != null) server.close();
            } catch (IOException ignored) {
                // closing anyway
            }
            server = null;
        }
        // Stop the foreground service
        stopPlaybackService();
        call.resolve();
    }

    /** Starts the foreground service to keep the native engine alive when the screen is locked. */
    @PluginMethod
    public void startForegroundService(PluginCall call) {
        Intent intent = new Intent(getContext(), PlaybackService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }
        call.resolve();
    }

    /** Stops the foreground service. */
    @PluginMethod
    public void stopForegroundService(PluginCall call) {
        stopPlaybackService();
        call.resolve();
    }

    /** Sends playback plans (clicks, announcements) to the native engine for lock-screen playback. */
    @PluginMethod
    public void sendPlaybackPlan(PluginCall call) {
        // TODO: Forward to native C++ engine (playback_plan.cpp)
        // For now, just acknowledge - the native engine integration is in progress
        call.resolve();
    }

    private void stopPlaybackService() {
        Intent intent = new Intent(getContext(), PlaybackService.class);
        getContext().stopService(intent);
    }
}
