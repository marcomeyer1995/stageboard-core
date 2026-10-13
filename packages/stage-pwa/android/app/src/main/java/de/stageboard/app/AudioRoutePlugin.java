package de.stageboard.app;

import android.content.Context;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Which output the app's audio goes to right now - speaker, wired headphones, Bluetooth or a USB
 * interface (#491, docs/21 §3). The latency of click and backing track differs a lot between them
 * (measured 2026-10-13: speaker ~70 ms on the Xiaomis, ~430 ms on the Fire; Bluetooth adds more),
 * so a calibrated value only holds for the route it was measured on. A browser can't tell the
 * route; the web build reports "unknown" there.
 *
 * Android routes media to the most recently connected output, roughly Bluetooth > USB > wired >
 * speaker - this follows that order over the connected outputs and reports changes as they happen.
 */
@CapacitorPlugin(name = "AudioRoute")
public class AudioRoutePlugin extends Plugin {
    private AudioManager audioManager;
    private AudioDeviceCallback callback;

    @Override
    public void load() {
        audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (audioManager == null) return;
        callback = new AudioDeviceCallback() {
            @Override
            public void onAudioDevicesAdded(AudioDeviceInfo[] added) {
                notifyListeners("change", currentRoute());
            }

            @Override
            public void onAudioDevicesRemoved(AudioDeviceInfo[] removed) {
                notifyListeners("change", currentRoute());
            }
        };
        audioManager.registerAudioDeviceCallback(callback, new Handler(Looper.getMainLooper()));
    }

    @PluginMethod
    public void getRoute(PluginCall call) {
        call.resolve(currentRoute());
    }

    private JSObject currentRoute() {
        JSObject result = new JSObject();
        result.put("route", detect());
        return result;
    }

    private String detect() {
        if (audioManager == null) return "unknown";
        boolean bluetooth = false, usb = false, wired = false;
        for (AudioDeviceInfo device : audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
            switch (device.getType()) {
                case AudioDeviceInfo.TYPE_BLUETOOTH_A2DP:
                case AudioDeviceInfo.TYPE_BLE_HEADSET:
                case AudioDeviceInfo.TYPE_BLE_SPEAKER:
                    bluetooth = true;
                    break;
                case AudioDeviceInfo.TYPE_USB_DEVICE:
                case AudioDeviceInfo.TYPE_USB_HEADSET:
                case AudioDeviceInfo.TYPE_USB_ACCESSORY:
                    usb = true;
                    break;
                case AudioDeviceInfo.TYPE_WIRED_HEADSET:
                case AudioDeviceInfo.TYPE_WIRED_HEADPHONES:
                case AudioDeviceInfo.TYPE_LINE_ANALOG:
                    wired = true;
                    break;
                default:
                    break;
            }
        }
        if (bluetooth) return "bluetooth";
        if (usb) return "usb";
        if (wired) return "wired";
        return "speaker";
    }

    @Override
    protected void handleOnDestroy() {
        if (audioManager != null && callback != null) audioManager.unregisterAudioDeviceCallback(callback);
    }
}
