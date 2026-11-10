package de.stageboard.app;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.pm.Signature;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Message;
import android.os.Messenger;
import android.os.ParcelFileDescriptor;
import android.os.RemoteException;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.security.MessageDigest;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Native helpers of add-ons (docs/32 §8): separate app packages - never code loaded into
 * StageBoard - found by the common action `de.stageboard.helper` and their add-on id
 * (meta-data `de.stageboard.addon`), used through a Messenger: REQUEST → PROGRESS* → RESULT |
 * ERROR. StageBoard binds only to a helper signed with the certificate the add-on's manifest
 * names; the helper checks StageBoard's signature in turn.
 */
@CapacitorPlugin(name = "NativeHelper")
public class NativeHelperPlugin extends Plugin {
    private static final String ACTION_ANY = "de.stageboard.helper";
    private static final String META_ADDON = "de.stageboard.addon";
    private static final String META_API = "de.stageboard.apiVersion";
    /** The protocol version StageBoard speaks (the helper's Protocol.API_VERSION). */
    private static final int API_VERSION = 1;
    private static final int MSG_REQUEST = 1;
    private static final int MSG_PROGRESS = 2;
    private static final int MSG_RESULT = 3;
    private static final int MSG_ERROR = 4;
    private static final int MSG_CANCEL = 5;

    private HandlerThread thread;
    private Handler handler;
    private final Map<String, Running> running = new ConcurrentHashMap<>();

    /** One request: its connection, call, and output file. */
    private static final class Running {
        PluginCall call;
        ServiceConnection connection;
        Messenger service;
        File output;
    }

    @Override
    public void load() {
        thread = new HandlerThread("NativeHelper");
        thread.start();
        handler = new Handler(thread.getLooper(), this::onReply);
    }

    @Override
    protected void handleOnDestroy() {
        for (String id : running.keySet()) finish(id);
        if (thread != null) thread.quitSafely();
        super.handleOnDestroy();
    }

    /** The helper serving `addonId` on this device, or null. */
    private ResolveInfo resolve(String addonId) {
        PackageManager pm = getContext().getPackageManager();
        List<ResolveInfo> found = pm.queryIntentServices(new Intent(ACTION_ANY), PackageManager.GET_META_DATA);
        for (ResolveInfo r : found) {
            Bundle meta = r.serviceInfo.metaData;
            if (meta != null && addonId.equals(meta.getString(META_ADDON))) return r;
        }
        return null;
    }

    @SuppressWarnings("deprecation")
    private String certSha256(String pkg) {
        try {
            PackageManager pm = getContext().getPackageManager();
            Signature[] signatures;
            if (Build.VERSION.SDK_INT >= 28) {
                PackageInfo info = pm.getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES);
                signatures = info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners();
            } else {
                signatures = pm.getPackageInfo(pkg, PackageManager.GET_SIGNATURES).signatures;
            }
            if (signatures == null || signatures.length != 1) return null;  // one signer, or none to trust
            StringBuilder hex = new StringBuilder();
            for (byte b : MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray())) hex.append(String.format("%02x", b));
            return hex.toString();
        } catch (Exception e) {
            return null;
        }
    }

    @PluginMethod
    public void find(PluginCall call) {
        String addonId = call.getString("addonId", "");
        ResolveInfo r = resolve(addonId);
        JSObject out = new JSObject();
        out.put("installed", r != null);
        if (r != null) {
            String pkg = r.serviceInfo.packageName;
            out.put("package", pkg);
            out.put("certSha256", certSha256(pkg));
            out.put("apiVersion", r.serviceInfo.metaData.getInt(META_API, 0));
            try {
                PackageInfo info = getContext().getPackageManager().getPackageInfo(pkg, 0);
                out.put("versionName", info.versionName);
                out.put("versionCode", Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode);
            } catch (PackageManager.NameNotFoundException ignored) {
                // gone meanwhile - reported as installed with no version
            }
        }
        call.resolve(out);
    }

    /**
     * `addonId`, `certSha256` (expected signer, from the add-on's manifest), `requestId`, `op`,
     * `args` (JSON string), `output` (true: the helper writes a file). Progress as the event
     * `helperProgress` {requestId, value}; resolves {json, file} or rejects with the helper's code.
     */
    @PluginMethod
    public void run(PluginCall call) {
        String addonId = call.getString("addonId", "");
        String expected = call.getString("certSha256", "");
        String id = call.getString("requestId", "");
        ResolveInfo r = resolve(addonId);
        if (r == null) {
            call.reject("helper not installed", "helper.missing");
            return;
        }
        String pkg = r.serviceInfo.packageName;
        String cert = certSha256(pkg);
        if (cert == null || !cert.equalsIgnoreCase(expected)) {
            call.reject("helper signed by someone else", "helper.untrusted");
            return;
        }
        int api = r.serviceInfo.metaData.getInt(META_API, 0);
        if (api != API_VERSION) {
            call.reject("helper speaks API " + api, "helper.incompatible");
            return;
        }
        Running run = new Running();
        run.call = call;
        try {
            if (Boolean.TRUE.equals(call.getBoolean("output", false))) {
                File dir = new File(getContext().getCacheDir(), "helpers");
                if (!dir.isDirectory() && !dir.mkdirs()) throw new java.io.IOException("no cache dir");
                run.output = new File(dir, id.replaceAll("[^\\w-]", "_") + ".out");
            }
        } catch (Exception e) {
            call.reject(String.valueOf(e), "helper.failed");
            return;
        }
        running.put(id, run);
        run.connection = new ServiceConnection() {
            @Override
            public void onServiceConnected(ComponentName name, IBinder binder) {
                run.service = new Messenger(binder);
                Message m = Message.obtain(null, MSG_REQUEST);
                Bundle data = new Bundle();
                data.putString("id", id);
                data.putString("op", call.getString("op", ""));
                data.putString("args", call.getString("args", ""));
                data.putInt("apiVersion", API_VERSION);
                ParcelFileDescriptor fd = null;
                try {
                    if (run.output != null) {
                        fd = ParcelFileDescriptor.open(run.output, ParcelFileDescriptor.MODE_WRITE_ONLY | ParcelFileDescriptor.MODE_CREATE | ParcelFileDescriptor.MODE_TRUNCATE);
                        data.putParcelable("output", fd);
                    }
                    m.setData(data);
                    m.replyTo = new Messenger(handler);
                    run.service.send(m);
                    // The helper got its own copy; ours closed, the file ends when the helper closes its.
                    if (fd != null) fd.close();
                } catch (Exception e) {
                    fail(id, "helper.failed", String.valueOf(e));
                }
            }

            @Override
            public void onServiceDisconnected(ComponentName name) {
                fail(id, "helper.gone", "helper stopped");
            }
        };
        Intent intent = new Intent("de.stageboard.helper." + addonId).setComponent(new ComponentName(pkg, r.serviceInfo.name));
        if (!getContext().bindService(intent, run.connection, Context.BIND_AUTO_CREATE)) {
            running.remove(id);
            call.reject("helper refused to start", "helper.failed");
        }
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        Running run = running.get(call.getString("requestId", ""));
        if (run != null && run.service != null) {
            Message m = Message.obtain(null, MSG_CANCEL);
            Bundle data = new Bundle();
            data.putString("id", call.getString("requestId", ""));
            m.setData(data);
            try {
                run.service.send(m);
            } catch (RemoteException ignored) {
                // gone anyway
            }
        }
        call.resolve();
    }

    /** Deletes a request's output file once JS has read it. */
    @PluginMethod
    public void release(PluginCall call) {
        File f = new File(new File(getContext().getCacheDir(), "helpers"), call.getString("requestId", "").replaceAll("[^\\w-]", "_") + ".out");
        if (f.exists() && !f.delete()) f.deleteOnExit();
        call.resolve();
    }

    private boolean onReply(Message msg) {
        Bundle data = msg.getData();
        String id = data.getString("id", "");
        Running run = running.get(id);
        if (run == null) return true;
        switch (msg.what) {
            case MSG_PROGRESS: {
                JSObject e = new JSObject();
                e.put("requestId", id);
                e.put("value", data.getDouble("value", 0));
                notifyListeners("helperProgress", e);
                return true;
            }
            case MSG_RESULT: {
                JSObject out = new JSObject();
                out.put("json", data.getString("json", ""));
                if (run.output != null) out.put("file", run.output.getAbsolutePath());
                run.call.resolve(out);
                finish(id);
                return true;
            }
            case MSG_ERROR:
                fail(id, data.getString("code", "helper.failed"), data.getString("message", ""));
                return true;
            default:
                return false;
        }
    }

    private void fail(String id, String code, String message) {
        Running run = running.get(id);
        if (run == null) return;
        run.call.reject(message == null || message.isEmpty() ? code : message, code);
        finish(id);
    }

    private void finish(String id) {
        Running run = running.remove(id);
        if (run == null || run.connection == null) return;
        try {
            getContext().unbindService(run.connection);
        } catch (IllegalArgumentException ignored) {
            // never bound
        }
    }
}
