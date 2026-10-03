package de.stageboard.app;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.security.MessageDigest;
import java.security.cert.Certificate;
import java.security.cert.X509Certificate;

import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

/**
 * Certificate pinning for the Stage-Server (#348). Its certificate is self-signed (no CA can sign
 * one for a LAN address at an offline venue), so instead of a CA the app remembers the exact
 * certificate - by SHA-256 fingerprint, per host - learned when pairing (from the band's invite QR
 * code, or confirmed by the user for a typed-in address). PinnedWebViewClient accepts a server
 * only if its certificate matches; nothing else is ever trusted.
 */
@CapacitorPlugin(name = "ServerTrust")
public class ServerTrustPlugin extends Plugin {
    private static final String PREFS = "stageboard_server_trust";

    /** The pinned fingerprint for `host` (without port), or null. */
    static String pinnedFingerprint(Context context, String host) {
        return prefs(context).getString(bareHost(host), null);
    }

    /** SHA-256 of a certificate's DER encoding: lowercase hex, no separators (as the server reports it). */
    static String fingerprint(Certificate certificate) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded());
        StringBuilder hex = new StringBuilder();
        for (byte b : digest) hex.append(String.format("%02x", b));
        return hex.toString();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static String bareHost(String host) {
        int colon = host.lastIndexOf(':');
        return colon > 0 && host.indexOf(':') == colon ? host.substring(0, colon) : host;
    }

    @PluginMethod
    public void pin(PluginCall call) {
        String host = call.getString("host");
        String fingerprint = call.getString("fingerprint");
        if (host == null || fingerprint == null || !fingerprint.matches("[0-9a-f]{64}")) {
            call.reject("host and a 64-character lowercase hex fingerprint are required");
            return;
        }
        prefs(getContext()).edit().putString(bareHost(host), fingerprint).apply();
        call.resolve();
    }

    /** Connects once and reads the certificate the server presents - without trusting it, and
     * without sending anything over the connection. Only used to show it to the user. */
    @PluginMethod
    public void fingerprintOf(PluginCall call) {
        String host = call.getString("host");
        if (host == null) {
            call.reject("host is required");
            return;
        }
        String name = bareHost(host);
        int port = name.equals(host) ? 443 : Integer.parseInt(host.substring(host.lastIndexOf(':') + 1));
        try {
            TrustManager[] readOnly = { new X509TrustManager() {
                public void checkClientTrusted(X509Certificate[] chain, String authType) {}
                public void checkServerTrusted(X509Certificate[] chain, String authType) {}
                public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
            } };
            SSLContext context = SSLContext.getInstance("TLS");
            context.init(null, readOnly, null);
            try (SSLSocket socket = (SSLSocket) context.getSocketFactory().createSocket()) {
                socket.connect(new java.net.InetSocketAddress(name, port), 5000);
                socket.setSoTimeout(5000);
                socket.startHandshake();
                Certificate[] chain = socket.getSession().getPeerCertificates();
                JSObject result = new JSObject();
                result.put("fingerprint", fingerprint(chain[0]));
                call.resolve(result);
            }
        } catch (Exception e) {
            call.reject("Could not reach " + host + ": " + e.getMessage());
        }
    }
}
