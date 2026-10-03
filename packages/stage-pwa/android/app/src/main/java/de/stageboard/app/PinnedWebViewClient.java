package de.stageboard.app;

import android.net.Uri;
import android.net.http.SslCertificate;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.webkit.SslErrorHandler;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

import java.io.ByteArrayInputStream;
import java.security.cert.Certificate;
import java.security.cert.CertificateFactory;

/**
 * Accepts the Stage-Server's self-signed certificate only when it is exactly the pinned one for
 * that host (ServerTrustPlugin) - for every request the web app makes: API, CouchDB sync, event
 * streams, audio. Any other certificate error cancels the request, as in a normal browser.
 */
public class PinnedWebViewClient extends BridgeWebViewClient {
    public PinnedWebViewClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
        try {
            String host = Uri.parse(error.getUrl()).getHost();
            String pinned = host == null ? null : ServerTrustPlugin.pinnedFingerprint(view.getContext(), host);
            Certificate certificate = toX509(error.getCertificate());
            if (pinned != null && certificate != null && pinned.equals(ServerTrustPlugin.fingerprint(certificate))) {
                handler.proceed();
                return;
            }
        } catch (Exception ignored) {
            // Fall through to cancel - never proceed on doubt.
        }
        handler.cancel();
    }

    private static Certificate toX509(SslCertificate certificate) throws Exception {
        if (certificate == null) return null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) return certificate.getX509Certificate();
        // Before Android 10 the DER bytes are only reachable through the saved state.
        Bundle state = SslCertificate.saveState(certificate);
        byte[] der = state.getByteArray("x509-certificate");
        if (der == null) return null;
        return CertificateFactory.getInstance("X.509").generateCertificate(new ByteArrayInputStream(der));
    }
}
