package de.stageboard.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

/**
 * Keeps the app in the foreground for Android while it plays (N1, Marco 2026-11-09/10): with the
 * screen locked, Android otherwise throttles the app - the click and the track in the WebView
 * stutter or stop, and a pushed Play arrives late. Only a notification "StageBoard spielt"; tapping
 * it opens the app. Started and stopped by PlaybackServicePlugin, nothing else.
 */
public class PlaybackService extends Service {
    private static final String CHANNEL_ID = "stageboard-playback";
    private static final int NOTIFICATION_ID = 7101;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        // Not restarted by Android on its own: the app decides when it plays.
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private Notification buildNotification() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Wiedergabe", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Solange StageBoard spielt oder ein Gig offen ist");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent openApp = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle("StageBoard spielt")
                .setContentText("Klick und Track laufen auch bei gesperrtem Bildschirm")
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setOngoing(true)
                .setContentIntent(openApp)
                .build();
    }
}
