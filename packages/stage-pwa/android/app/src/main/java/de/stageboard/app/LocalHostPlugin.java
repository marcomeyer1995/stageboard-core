package de.stageboard.app;

import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Spike "Android as host" (docs/25, Marco 2026-11-07): a small web server in the app. The clock
 * (`/time`) is answered here, natively; every other request goes to sync-host in the WebView,
 * over the band database the app already holds, and its answer comes back through respond().
 * Plain HTTP/1.1, one thread per connection, kept alive for the next request - enough to measure
 * sync and clock over Wi-Fi. Access: Basic auth with the spike's own token.
 */
@CapacitorPlugin(name = "LocalHost")
public class LocalHostPlugin extends Plugin {
    private ServerSocket server;
    /** Wi-Fi power saving delayed a push after a pause by up to 125 ms (spike, 2026-11-07) - while
     * this device is the host, its Wi-Fi stays in low-latency mode (an app lock, no setting). */
    private android.net.wifi.WifiManager.WifiLock wifiLock;
    private String expectedAuth;
    private final AtomicLong nextId = new AtomicLong();
    private final Map<Long, Pending> pending = new ConcurrentHashMap<>();
    /** Live channels (Play, switches): per "<band>/<topic>" the open streams - relayed natively,
     * without the WebView, like the Stage-Server's push hubs (show-state, switch-state). */
    private final Map<String, java.util.Set<OutputStream>> streams = new ConcurrentHashMap<>();
    private static final java.util.regex.Pattern LIVE = java.util.regex.Pattern.compile("^/workspaces/([^/]+)/(show-state|switch-state)/(stream|push)$");

    private static class Pending {
        final CountDownLatch done = new CountDownLatch(1);
        int status = 504;
        String contentType = "application/json";
        byte[] body = "{\"error\":\"timeout\"}".getBytes(StandardCharsets.UTF_8);
    }

    @PluginMethod
    public void start(PluginCall call) {
        int port = call.getInt("port", 5985);
        String user = call.getString("user", "host");
        String password = call.getString("password", "");
        expectedAuth = "Basic " + Base64.encodeToString((user + ":" + password).getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
        try {
            if (server != null) server.close();
            server = new ServerSocket(port, 64);
        } catch (IOException e) {
            call.reject("listen failed: " + e.getMessage());
            return;
        }
        android.net.wifi.WifiManager wm = (android.net.wifi.WifiManager) getContext().getApplicationContext().getSystemService(android.content.Context.WIFI_SERVICE);
        if (wm != null && wifiLock == null) {
            int mode = android.os.Build.VERSION.SDK_INT >= 29 ? android.net.wifi.WifiManager.WIFI_MODE_FULL_LOW_LATENCY : android.net.wifi.WifiManager.WIFI_MODE_FULL_HIGH_PERF;
            wifiLock = wm.createWifiLock(mode, "stageboard-host");
            wifiLock.acquire();
        }
        Thread accept = new Thread(this::acceptLoop, "localhost-accept");
        accept.setDaemon(true);
        accept.start();
        JSObject ret = new JSObject();
        ret.put("port", port);
        ret.put("address", lanAddress());
        call.resolve(ret);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            if (server != null) server.close();
        } catch (IOException ignored) {
        }
        server = null;
        if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        wifiLock = null;
        call.resolve();
    }

    /** The WebView's answer to request `id`. */
    @PluginMethod
    public void respond(PluginCall call) {
        Long id = Long.valueOf(call.getString("id", "-1"));
        Pending p = pending.get(id);
        if (p != null) {
            p.status = call.getInt("status", 200);
            p.contentType = call.getString("contentType", "application/json");
            String text = call.getString("text");
            p.body = text != null ? text.getBytes(StandardCharsets.UTF_8) : Base64.decode(call.getString("body", ""), Base64.DEFAULT);
            p.done.countDown();
        }
        call.resolve();
    }

    private void acceptLoop() {
        ServerSocket s = server;
        while (s != null && !s.isClosed()) {
            try {
                Socket socket = s.accept();
                Thread t = new Thread(() -> handle(socket), "localhost-conn");
                t.setDaemon(true);
                t.start();
            } catch (IOException e) {
                return;
            }
        }
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream line = new ByteArrayOutputStream();
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') break;
            if (c != '\r') line.write(c);
        }
        return line.toString("UTF-8");
    }

    /** One connection, several requests in a row (keep-alive) - a new TCP connection per request
     * made the first full sync 12x slower than from the laptop (spike, 2026-11-07). */
    private void handle(Socket socket) {
        try (Socket sock = socket) {
            sock.setTcpNoDelay(true);
            sock.setSoTimeout(90_000);
            InputStream in = new BufferedInputStream(sock.getInputStream(), 65536);
            OutputStream out = new java.io.BufferedOutputStream(sock.getOutputStream(), 65536);
            while (true) {
                String requestLine = readLine(in);
                if (requestLine.isEmpty()) return;
                String[] parts = requestLine.split(" ");
                if (parts.length < 2) return;
                boolean keepAlive = serve(parts[0], parts[1], in, out);
                out.flush();
                if (!keepAlive) return;
            }
        } catch (Exception ignored) {
        }
    }

    /** Answers one request; true when the connection stays open for the next. */
    private boolean serve(String method, String target, InputStream in, OutputStream out) throws IOException, InterruptedException {
        Map<String, String> headers = new HashMap<>();
        String line;
        while (!(line = readLine(in)).isEmpty()) {
            int colon = line.indexOf(':');
            if (colon > 0) headers.put(line.substring(0, colon).trim().toLowerCase(Locale.ROOT), line.substring(colon + 1).trim());
        }
        int length = Integer.parseInt(headers.getOrDefault("content-length", "0"));
        byte[] body = new byte[length];
        int read = 0;
        while (read < length) {
            int n = in.read(body, read, length - read);
            if (n < 0) break;
            read += n;
        }
        boolean keepAlive = !"close".equalsIgnoreCase(headers.get("connection"));
        String path = target.contains("?") ? target.substring(0, target.indexOf('?')) : target;
        String query = target.contains("?") ? target.substring(target.indexOf('?') + 1) : "";

        // The clock, natively - the cleanest time this device has.
        if (path.equals("/time")) {
            write(out, 200, "application/json", ("{\"serverTime\":" + System.currentTimeMillis() + "}").getBytes(StandardCharsets.UTF_8), keepAlive);
            return keepAlive;
        }
        if (!expectedAuth.equals(headers.get("authorization"))) {
            write(out, 401, "application/json", "{\"error\":\"unauthorized\"}".getBytes(StandardCharsets.UTF_8), keepAlive);
            return keepAlive;
        }
        java.util.regex.Matcher live = LIVE.matcher(path);
        if (live.matches()) return relay(live.group(1) + "/" + live.group(2), live.group(3), method, body, out, keepAlive);

        long id = nextId.incrementAndGet();
        Pending p = new Pending();
        pending.put(id, p);
        String contentType = headers.getOrDefault("content-type", "");
        JSObject req = new JSObject();
        req.put("id", String.valueOf(id));
        req.put("method", method);
        req.put("path", path);
        req.put("query", query);
        req.put("contentType", contentType);
        // JSON as text through the bridge, only binary as Base64.
        if (contentType.isEmpty() || contentType.contains("json")) req.put("text", new String(body, StandardCharsets.UTF_8));
        else req.put("body", Base64.encodeToString(body, Base64.NO_WRAP));
        notifyListeners("request", req);
        p.done.await(75, TimeUnit.SECONDS);
        pending.remove(id);
        write(out, p.status, p.contentType, p.body, keepAlive);
        return keepAlive;
    }

    /** A live channel: GET …/stream stays open and gets every push as an SSE event; POST …/push
     * goes to all of them at once. */
    private boolean relay(String channel, String kind, String method, byte[] body, OutputStream out, boolean keepAlive) throws IOException, InterruptedException {
        if (kind.equals("push") && method.equals("POST")) {
            byte[] event = ("data: " + new String(body, StandardCharsets.UTF_8) + "\n\n").getBytes(StandardCharsets.UTF_8);
            int sent = 0;
            for (OutputStream sub : streams.getOrDefault(channel, java.util.Collections.emptySet())) {
                try {
                    synchronized (sub) {
                        sub.write(event);
                        sub.flush();
                    }
                    sent++;
                } catch (IOException e) {
                    streams.get(channel).remove(sub);
                }
            }
            write(out, 204, "application/json", new byte[0], keepAlive);
            return keepAlive;
        }
        if (kind.equals("stream") && method.equals("GET")) {
            out.write(("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\n\r\n: open\n\n").getBytes(StandardCharsets.UTF_8));
            out.flush();
            streams.computeIfAbsent(channel, k -> ConcurrentHashMap.newKeySet()).add(out);
            // Hold the connection; a comment every 15 s keeps it alive and notices when it is gone.
            try {
                while (true) {
                    Thread.sleep(15_000);
                    synchronized (out) {
                        out.write(": ping\n\n".getBytes(StandardCharsets.UTF_8));
                        out.flush();
                    }
                }
            } catch (IOException e) {
                streams.get(channel).remove(out);
            }
            return false;
        }
        write(out, 405, "application/json", "{\"error\":\"method\"}".getBytes(StandardCharsets.UTF_8), keepAlive);
        return keepAlive;
    }

    private static void write(OutputStream out, int status, String contentType, byte[] body, boolean keepAlive) throws IOException {
        String head = "HTTP/1.1 " + status + " " + (status < 400 ? "OK" : "Error") + "\r\n"
                + "Content-Type: " + contentType + "\r\n"
                + "Content-Length: " + body.length + "\r\n"
                + "Connection: " + (keepAlive ? "keep-alive" : "close") + "\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.UTF_8));
        out.write(body);
        out.flush();
    }

    /** This device's Wi-Fi address, for the spike's measurements from the laptop. */
    private static String lanAddress() {
        try {
            for (NetworkInterface nif : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!nif.isUp() || nif.isLoopback()) continue;
                for (InetAddress a : Collections.list(nif.getInetAddresses())) {
                    if (a.getAddress().length == 4 && !a.isLoopbackAddress()) return a.getHostAddress();
                }
            }
        } catch (Exception ignored) {
        }
        return null;
    }
}
