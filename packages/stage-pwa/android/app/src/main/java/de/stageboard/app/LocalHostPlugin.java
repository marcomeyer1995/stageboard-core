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
 * Plain HTTP/1.1, one thread per connection, Connection: close - enough to measure sync and clock
 * over Wi-Fi. Access: Basic auth with the spike's own token.
 */
@CapacitorPlugin(name = "LocalHost")
public class LocalHostPlugin extends Plugin {
    private ServerSocket server;
    private String expectedAuth;
    private final AtomicLong nextId = new AtomicLong();
    private final Map<Long, Pending> pending = new ConcurrentHashMap<>();

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
            String b64 = call.getString("body", "");
            p.body = Base64.decode(b64, Base64.DEFAULT);
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

    private void handle(Socket socket) {
        try (Socket sock = socket) {
            sock.setTcpNoDelay(true);
            InputStream in = new BufferedInputStream(sock.getInputStream());
            String requestLine = readLine(in);
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) return;
            String method = parts[0];
            String target = parts[1];
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
            OutputStream out = sock.getOutputStream();
            String path = target.contains("?") ? target.substring(0, target.indexOf('?')) : target;
            String query = target.contains("?") ? target.substring(target.indexOf('?') + 1) : "";

            // The clock, natively - the cleanest time this device has.
            if (path.equals("/time")) {
                write(out, 200, "application/json", ("{\"serverTime\":" + System.currentTimeMillis() + "}").getBytes(StandardCharsets.UTF_8));
                return;
            }
            if (!expectedAuth.equals(headers.get("authorization"))) {
                write(out, 401, "application/json", "{\"error\":\"unauthorized\"}".getBytes(StandardCharsets.UTF_8));
                return;
            }
            long id = nextId.incrementAndGet();
            Pending p = new Pending();
            pending.put(id, p);
            JSObject req = new JSObject();
            req.put("id", String.valueOf(id));
            req.put("method", method);
            req.put("path", path);
            req.put("query", query);
            req.put("contentType", headers.getOrDefault("content-type", ""));
            req.put("body", Base64.encodeToString(body, Base64.NO_WRAP));
            notifyListeners("request", req);
            p.done.await(75, TimeUnit.SECONDS);
            pending.remove(id);
            write(out, p.status, p.contentType, p.body);
        } catch (Exception ignored) {
        }
    }

    private static void write(OutputStream out, int status, String contentType, byte[] body) throws IOException {
        String head = "HTTP/1.1 " + status + " " + (status < 400 ? "OK" : "Error") + "\r\n"
                + "Content-Type: " + contentType + "\r\n"
                + "Content-Length: " + body.length + "\r\n"
                + "Connection: close\r\n\r\n";
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
