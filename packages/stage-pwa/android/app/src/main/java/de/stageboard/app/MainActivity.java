package de.stageboard.app;

import android.graphics.Rect;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;

import androidx.activity.OnBackPressedCallback;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * The StageBoard Android shell (#348): the bundled web app, fullscreen, screen kept on while the
 * app is in front - a tablet on a music stand must never dim or lock mid-song.
 */
public class MainActivity extends BridgeActivity {
    /** How often the page's height is checked again while the keyboard is up (Android before 11). */
    private static final long KEYBOARD_RECHECK_MS = 300;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ServerTrustPlugin.class);
        registerPlugin(ServerDiscoveryPlugin.class);
        registerPlugin(PrintPlugin.class);
        registerPlugin(AudioRoutePlugin.class);
        super.onCreate(savedInstanceState);
        // The Stage-Server's self-signed certificate is trusted only as pinned at pairing (#348).
        bridge.setWebViewClient(new PinnedWebViewClient(bridge));
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        // Always draw into the camera notch's edge - the page keeps it clear itself with the
        // safe-area padding (env(safe-area-inset-*)). With Android's default the window jumped
        // between "under the notch" and "beside it" depending on whether the system bars were
        // shown, and content was cut in one of the two (Marco's phone, 2026-10-07).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getWindow().getAttributes().layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        hideSystemBars();
        followKeyboard();
        // Android's back gesture (a swipe in from the left or right edge) must never leave the
        // app: dragging a slider that starts near the edge triggered it and sent StageBoard to the
        // home screen mid-song (Xiaomi, 2026-10-15). The app has no back history of its own -
        // leaving it is the home gesture.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                // Deliberately nothing.
            }
        });
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Android shows the bars again after dialogs, the recents screen etc.
        if (hasFocus) hideSystemBars();
    }

    /**
     * The page ends where the on-screen keyboard begins (#606). From Android 11 Capacitor's
     * SystemBars does this from the keyboard's window insets. Older Android (the Fire tablets, API
     * 28) sends none while the system bars are hidden, so the keyboard covered the lower part of the
     * page - text fields, dialog buttons, the ChordPro keys. There the WebView gets shorter by the
     * part of the window the keyboard hides; the page sees it as a smaller viewport, like a browser.
     */
    private void followKeyboard() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) return;
        View decor = getWindow().getDecorView();
        Rect visible = new Rect();
        int[] onScreen = new int[2];
        Runnable[] measure = new Runnable[1];
        measure[0] = () -> {
            decor.getWindowVisibleDisplayFrame(visible);
            View webView = bridge.getWebView();
            View parent = (View) webView.getParent();
            // Measured against where the WebView's container really ends - not the screen height:
            // when Android itself shortens the container too, the keyboard must not count twice.
            parent.getLocationOnScreen(onScreen);
            int covered = Math.max(0, onScreen[1] + parent.getHeight() - visible.bottom);
            // A sliver (a navigation bar showing briefly) is not a keyboard.
            int keyboard = covered > decor.getHeight() * 0.15 ? covered : 0;
            ViewGroup.MarginLayoutParams params = (ViewGroup.MarginLayoutParams) webView.getLayoutParams();
            if (params.bottomMargin != keyboard) {
                params.bottomMargin = keyboard;
                webView.setLayoutParams(params);
            }
            // The keyboard going away lays nothing out on the Fire, so no layout pass reports it -
            // the page stayed short with a grey band below it until the app restarted (Fire,
            // 2026-10-29). While a keyboard is counted, look again a little later.
            decor.removeCallbacks(measure[0]);
            if (keyboard > 0) decor.postDelayed(measure[0], KEYBOARD_RECHECK_MS);
        };
        decor.getViewTreeObserver().addOnGlobalLayoutListener(() -> measure[0].run());
    }

    /** Immersive: status and navigation bar hidden; a swipe from the edge shows them briefly. */
    private void hideSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());
    }
}
