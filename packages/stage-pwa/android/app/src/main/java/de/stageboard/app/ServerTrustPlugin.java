package de.stageboard.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.security.MessageDigest;
import java.security.cert.Certificate;
import java.security.cert.X509Certificate;

import javax.net.ssl.HttpsURLConnection;
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

    /** Downloads an app update from the paired Stage-Server - over the pinned certificate, as the
     * WebView would - and hands it to Android's installer (the user confirms there; the first
     * time Android also asks to allow installs from StageBoard). */
    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("url is required");
            return;
        }
        try {
            URL target = new URL(url);
            String host = target.getHost();
            String pinned = pinnedFingerprint(getContext(), host);
            if (!"https".equals(target.getProtocol()) || pinned == null) {
                call.reject("Only the paired Stage-Server can provide updates");
                return;
            }
            TrustManager[] pinnedOnly = { new X509TrustManager() {
                public void checkClientTrusted(X509Certificate[] chain, String authType) throws java.security.cert.CertificateException {
                    throw new java.security.cert.CertificateException("not used");
                }
                public void checkServerTrusted(X509Certificate[] chain, String authType) throws java.security.cert.CertificateException {
                    try {
                        if (chain.length == 0 || !pinned.equals(fingerprint(chain[0]))) throw new java.security.cert.CertificateException("certificate is not the paired one");
                    } catch (java.security.cert.CertificateException e) {
                        throw e;
                    } catch (Exception e) {
                        throw new java.security.cert.CertificateException(e);
                    }
                }
                public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
            } };
            SSLContext context = SSLContext.getInstance("TLS");
            context.init(null, pinnedOnly, null);
            HttpsURLConnection connection = (HttpsURLConnection) target.openConnection();
            connection.setSSLSocketFactory(context.getSocketFactory());
            // The certificate itself is pinned above - the name check adds nothing for an IP address.
            connection.setHostnameVerifier((name, session) -> name.equals(host));
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(30000);
            if (connection.getResponseCode() != 200) {
                call.reject("Download failed: HTTP " + connection.getResponseCode());
                return;
            }
            File dir = new File(getContext().getCacheDir(), "updates");
            if (!dir.exists() && !dir.mkdirs()) throw new Exception("cannot create " + dir);
            File apk = new File(dir, "stageboard.apk");
            try (InputStream in = connection.getInputStream(); FileOutputStream out = new FileOutputStream(apk)) {
                byte[] buffer = new byte[64 * 1024];
                int n;
                while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
            Intent install = new Intent(Intent.ACTION_VIEW);
            install.setDataAndType(uri, "application/vnd.android.package-archive");
            install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(install);
            call.resolve();
        } catch (Exception e) {
            call.reject("Update failed: " + e.getMessage());
        }
    }
}
