package de.stageboard.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

/**
 * Native Engine N1 (docs/30 §8): foreground service that keeps the native audio engine alive when
 * the screen is locked. Shows a notification "StageBoard spielt" with a stop button.
 *
 * Why: Android kills background processes to save battery. A foreground service with a notification
 * tells the OS "this is important, don't kill it". The notification also gives the user a way to
 * stop playback if needed.
 *
 * Lifecycle:
 * - startForegroundService() is called from the WebView when playback starts.
 * - The service shows a notification and calls startForeground().
 * - stopSelf() is called when playback stops or the user taps the stop button.
 */
public class PlaybackService extends Service {
    private static final String TAG = "PlaybackService";
    private static final String CHANNEL_ID = "StageBoardPlayback";
    private static final int NOTIFICATION_ID = 1;

    public static final String ACTION_STOP = "de.stageboard.app.action.STOP_PLAYBACK";

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            // User tapped the stop button in the notification
            stopSelf();
            return START_NOT_STICKY;
        }

        // Start foreground service with notification
        Notification notification = buildNotification();
        startForeground(NOTIFICATION_ID, notification);

        // If the service is killed, don't restart automatically
        return START_NOT_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        // Not a bound service - only started/stopped
        return null;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        // Service is being destroyed - cleanup if needed
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "StageBoard Wiedergabe",
                    NotificationManager.IMPORTANCE_LOW // Low: no sound/vibration
            );
            channel.setDescription("Bleibt aktiv, während die App im Hintergrund läuft");

            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private Notification buildNotification() {
        // Intent to open the app when tapping the notification
        Intent openIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent openPendingIntent = PendingIntent.getActivity(
                this,
                0,
                openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Intent to stop playback when tapping the stop button
        Intent stopIntent = new Intent(this, PlaybackService.class);
        stopIntent.setAction(ACTION_STOP);
        PendingIntent stopPendingIntent = PendingIntent.getService(
                this,
                0,
                stopIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Build the notification
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_media_play) // TODO: use app icon
                .setContentTitle("StageBoard spielt")
                .setContentText("Klick und Ansagen laufen weiter")
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setOngoing(true) // User can't swipe it away
                .setContentIntent(openPendingIntent)
                .addAction(android.R.drawable.ic_media_pause, "Stopp", stopPendingIntent);

        return builder.build();
    }
}
