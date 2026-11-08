package de.stageboard.app;

import android.content.Context;
import android.net.wifi.WifiManager;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Wi-Fi without power saving while a Gig is open (Marco, 2026-11-08): measured on the Redmi, the
 * Wi-Fi's power saving delayed a pushed Play by up to 125 ms after a pause - on every device that
 * receives it. An app lock in low-latency mode (Android 10+; high-performance before), no setting
 * changed; released when the Gig closes. Costs some battery during the gig only.
 */
@CapacitorPlugin(name = "WifiLock")
public class WifiLockPlugin extends Plugin {
    private WifiManager.WifiLock lock;

    @PluginMethod
    public void acquire(PluginCall call) {
        if (lock == null) {
            WifiManager wm = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm == null) {
                call.reject("no wifi");
                return;
            }
            int mode = Build.VERSION.SDK_INT >= 29 ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
            lock = wm.createWifiLock(mode, "stageboard-gig");
            lock.setReferenceCounted(false);
        }
        if (!lock.isHeld()) lock.acquire();
        JSObject ret = new JSObject();
        ret.put("held", lock.isHeld());
        ret.put("lowLatency", Build.VERSION.SDK_INT >= 29);
        call.resolve(ret);
    }

    @PluginMethod
    public void release(PluginCall call) {
        if (lock != null && lock.isHeld()) lock.release();
        call.resolve();
    }
}
