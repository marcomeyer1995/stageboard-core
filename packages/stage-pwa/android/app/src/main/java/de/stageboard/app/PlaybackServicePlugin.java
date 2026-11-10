package de.stageboard.app;

import android.content.Intent;
import android.os.Build;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Starts and stops PlaybackService (N1). Starting is only allowed while the app is in front
 * (Android 12+) - the app starts it when playing begins, which is always a tap or a pushed Play
 * with the app open; a refused start is reported, not retried.
 */
@CapacitorPlugin(name = "PlaybackService")
public class PlaybackServicePlugin extends Plugin {
    private boolean running;

    @PluginMethod
    public void start(PluginCall call) {
        try {
            Intent intent = new Intent(getContext(), PlaybackService.class);
            if (Build.VERSION.SDK_INT >= 26) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
            running = true;
            call.resolve();
        } catch (RuntimeException e) {
            call.reject("not started: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), PlaybackService.class));
        running = false;
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        // The app closes: no notification left behind.
        if (running) getContext().stopService(new Intent(getContext(), PlaybackService.class));
    }
}
