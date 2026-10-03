package de.stageboard.app;

import android.os.Bundle;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * The StageBoard Android shell (#348): the bundled web app, fullscreen, screen kept on while the
 * app is in front - a tablet on a music stand must never dim or lock mid-song.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ServerTrustPlugin.class);
        super.onCreate(savedInstanceState);
        // The Stage-Server's self-signed certificate is trusted only as pinned at pairing (#348).
        bridge.setWebViewClient(new PinnedWebViewClient(bridge));
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Android shows the bars again after dialogs, the recents screen etc.
        if (hasFocus) hideSystemBars();
    }

    /** Immersive: status and navigation bar hidden; a swipe from the edge shows them briefly. */
    private void hideSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());
    }
}
