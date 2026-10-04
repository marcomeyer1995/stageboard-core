package de.stageboard.app;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Finds Stage-Servers on the local network (#351) - DNS-SD service `_stageboard._tcp`, announced
 * by the server's mDNS responder with its certificate fingerprint in the TXT record. Android's own
 * mDNS stack (NsdManager) does the work, so this works where the browser can't resolve
 * `stageboard.local`. Read-only: finding a server never trusts it - pairing still pins the
 * certificate (ServerTrustPlugin), and only a matching fingerprint is followed automatically.
 */
@CapacitorPlugin(name = "ServerDiscovery")
public class ServerDiscoveryPlugin extends Plugin {
    private static final String SERVICE_TYPE = "_stageboard._tcp.";

    @PluginMethod
    public void discover(PluginCall call) {
        int timeoutMs = call.getInt("timeoutMs", 3000);
        NsdManager nsd = (NsdManager) getContext().getSystemService(Context.NSD_SERVICE);
        Map<String, JSObject> servers = Collections.synchronizedMap(new HashMap<>());
        ArrayDeque<NsdServiceInfo> toResolve = new ArrayDeque<>();
        boolean[] resolving = { false };
        boolean[] finished = { false };

        // NsdManager resolves one service at a time before Android 14 - resolve them in turn.
        Runnable[] resolveNext = new Runnable[1];
        resolveNext[0] = () -> {
            NsdServiceInfo next;
            synchronized (toResolve) {
                if (resolving[0] || toResolve.isEmpty() || finished[0]) return;
                next = toResolve.poll();
                resolving[0] = true;
            }
            nsd.resolveService(next, new NsdManager.ResolveListener() {
                @Override
                public void onResolveFailed(NsdServiceInfo info, int errorCode) {
                    done();
                }

                @Override
                public void onServiceResolved(NsdServiceInfo info) {
                    String address = ipv4(info);
                    if (address != null) {
                        JSObject server = new JSObject();
                        server.put("name", info.getServiceName());
                        server.put("address", address);
                        server.put("port", info.getPort());
                        byte[] fp = info.getAttributes().get("fp");
                        server.put("fingerprint", fp == null ? null : new String(fp, StandardCharsets.UTF_8));
                        servers.put(info.getServiceName(), server);
                    }
                    done();
                }

                private void done() {
                    synchronized (toResolve) {
                        resolving[0] = false;
                    }
                    resolveNext[0].run();
                }
            });
        };

        NsdManager.DiscoveryListener listener = new NsdManager.DiscoveryListener() {
            @Override
            public void onDiscoveryStarted(String serviceType) {}

            @Override
            public void onDiscoveryStopped(String serviceType) {}

            @Override
            public void onStartDiscoveryFailed(String serviceType, int errorCode) {}

            @Override
            public void onStopDiscoveryFailed(String serviceType, int errorCode) {}

            @Override
            public void onServiceFound(NsdServiceInfo info) {
                synchronized (toResolve) {
                    toResolve.add(info);
                }
                resolveNext[0].run();
            }

            @Override
            public void onServiceLost(NsdServiceInfo info) {}
        };

        nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener);
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            synchronized (toResolve) {
                finished[0] = true;
            }
            try {
                nsd.stopServiceDiscovery(listener);
            } catch (IllegalArgumentException ignored) {
                // Discovery never started (no network) - nothing to stop.
            }
            JSArray list = new JSArray();
            synchronized (servers) {
                for (JSObject server : servers.values()) list.put(server);
            }
            JSObject result = new JSObject();
            result.put("servers", list);
            call.resolve(result);
        }, timeoutMs);
    }

    /** The service's IPv4 address - the app talks to the server by IPv4 (as in the band QR code). */
    private static String ipv4(NsdServiceInfo info) {
        if (Build.VERSION.SDK_INT >= 34) {
            List<InetAddress> addresses = info.getHostAddresses();
            for (InetAddress address : addresses) if (address instanceof Inet4Address) return address.getHostAddress();
            return null;
        }
        @SuppressWarnings("deprecation")
        InetAddress host = info.getHost();
        return host instanceof Inet4Address ? host.getHostAddress() : null;
    }
}
