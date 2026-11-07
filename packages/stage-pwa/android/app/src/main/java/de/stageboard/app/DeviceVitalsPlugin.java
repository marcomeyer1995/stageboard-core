package de.stageboard.app;

import android.app.ActivityManager;
import android.content.Context;
import android.os.Debug;
import android.os.Process;
import android.os.SystemClock;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * What the Diagnose tab shows about the device itself (Marco, 2026-11-06, after the phone's audio
 * fell apart after 17 h with 250 MB free): free memory and Android's own "low" flag, this app
 * process's memory and CPU time (Java plus the native audio output - the WebView renders in its own
 * sandboxed process, which no app may look into), and how long the process runs. Device-wide CPU is
 * closed to apps since Android 8 (/proc/stat reads empty).
 */
@CapacitorPlugin(name = "DeviceVitals")
public class DeviceVitalsPlugin extends Plugin {
    @PluginMethod
    public void read(PluginCall call) {
        ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
        ActivityManager.MemoryInfo mem = new ActivityManager.MemoryInfo();
        am.getMemoryInfo(mem);
        JSObject ret = new JSObject();
        ret.put("availMb", mem.availMem / (1024 * 1024));
        ret.put("totalMb", mem.totalMem / (1024 * 1024));
        ret.put("thresholdMb", mem.threshold / (1024 * 1024));
        ret.put("lowMemory", mem.lowMemory);
        // Debug.getMemoryInfo, not ActivityManager.getProcessMemoryInfo: the latter is throttled to
        // one fresh value per 5 minutes since Android 10.
        Debug.MemoryInfo own = new Debug.MemoryInfo();
        Debug.getMemoryInfo(own);
        ret.put("appMb", own.getTotalPss() / 1024);
        ret.put("cpuMs", Process.getElapsedCpuTime());
        ret.put("uptimeMs", SystemClock.elapsedRealtime() - Process.getStartElapsedRealtime());
        ret.put("cores", Runtime.getRuntime().availableProcessors());
        call.resolve(ret);
    }
}
