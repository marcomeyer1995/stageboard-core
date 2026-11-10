package de.stageboard.app;

import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.os.Process;
import android.os.SystemClock;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.nio.ByteBuffer;

/**
 * Measurement only (docs/30 §8h, first task): can this device decode N Opus tracks at once with
 * reserve? Android's software Opus decoder is libopus - the same library the engine will carry.
 * Decodes the file N times in parallel as fast as it goes; nothing is played.
 */
@CapacitorPlugin(name = "OpusBench")
public class OpusBenchPlugin extends Plugin {
    @PluginMethod
    public void run(PluginCall call) {
        final String path = new File(getContext().getFilesDir(), call.getString("file", "bench.webm")).getPath();
        final int streams = call.getInt("streams", 6);
        new Thread(() -> {
            final long[] wallMs = new long[streams];
            final double[] audioS = new double[streams];
            final String[] codec = new String[streams];
            final String[] error = new String[streams];
            Thread[] threads = new Thread[streams];
            long cpu0 = Process.getElapsedCpuTime();
            long t0 = SystemClock.elapsedRealtime();
            for (int i = 0; i < streams; i++) {
                final int n = i;
                threads[i] = new Thread(() -> {
                    try {
                        long start = SystemClock.elapsedRealtime();
                        MediaExtractor ex = new MediaExtractor();
                        ex.setDataSource(path);
                        MediaFormat fmt = null;
                        for (int t = 0; t < ex.getTrackCount(); t++) {
                            MediaFormat f = ex.getTrackFormat(t);
                            if (f.getString(MediaFormat.KEY_MIME).startsWith("audio/")) { ex.selectTrack(t); fmt = f; break; }
                        }
                        if (fmt == null) throw new IllegalStateException("no audio track");
                        MediaCodec dec = MediaCodec.createDecoderByType(fmt.getString(MediaFormat.KEY_MIME));
                        codec[n] = dec.getName();
                        dec.configure(fmt, null, null, 0);
                        dec.start();
                        MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
                        boolean inputDone = false;
                        long bytes = 0;
                        int channels = fmt.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
                        int rate = fmt.getInteger(MediaFormat.KEY_SAMPLE_RATE);
                        while (true) {
                            if (!inputDone) {
                                int in = dec.dequeueInputBuffer(10_000);
                                if (in >= 0) {
                                    ByteBuffer buf = dec.getInputBuffer(in);
                                    int size = ex.readSampleData(buf, 0);
                                    if (size < 0) { dec.queueInputBuffer(in, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputDone = true; }
                                    else { dec.queueInputBuffer(in, 0, size, ex.getSampleTime(), 0); ex.advance(); }
                                }
                            }
                            int out = dec.dequeueOutputBuffer(info, 10_000);
                            if (out >= 0) {
                                bytes += info.size;
                                dec.releaseOutputBuffer(out, false);
                                if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) break;
                            } else if (out == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                                MediaFormat o = dec.getOutputFormat();
                                channels = o.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
                                rate = o.getInteger(MediaFormat.KEY_SAMPLE_RATE);
                            }
                        }
                        dec.stop(); dec.release(); ex.release();
                        wallMs[n] = SystemClock.elapsedRealtime() - start;
                        audioS[n] = bytes / 2.0 / channels / rate;
                    } catch (Exception e) {
                        error[n] = e.toString();
                    }
                });
                threads[i].start();
            }
            for (Thread t : threads) { try { t.join(); } catch (InterruptedException ignored) {} }
            long wall = SystemClock.elapsedRealtime() - t0;
            long cpu = Process.getElapsedCpuTime() - cpu0;
            JSObject ret = new JSObject();
            JSArray per = new JSArray();
            double audioTotal = 0;
            for (int i = 0; i < streams; i++) {
                JSObject s = new JSObject();
                s.put("codec", codec[i]); s.put("wallMs", wallMs[i]); s.put("audioS", audioS[i]); if (error[i] != null) s.put("error", error[i]);
                per.put(s);
                audioTotal += audioS[i];
            }
            ret.put("streams", per);
            ret.put("wallMs", wall);
            ret.put("cpuMs", cpu);
            ret.put("audioS", audioTotal);
            ret.put("cores", Runtime.getRuntime().availableProcessors());
            Log.i("OpusBench", "result " + ret.toString());
            call.resolve(ret);
        }).start();
    }
}
