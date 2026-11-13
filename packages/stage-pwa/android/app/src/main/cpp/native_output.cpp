// Native audio output (docs/30): the WebView's finished mix, played through AAudio at a time the app
// chooses. JS pushes the mix in chunks (pipe frames, counted from 0) together with `baseMs`, the
// wall-clock time (CLOCK_REALTIME, Date.now()) at which pipe frame 0 is to be *heard*. Each callback
// asks AAudio when its first frame will be heard (its own timestamp: frame position + presentation
// time - measured truthful on every device we have, unlike the WebView's latency on the Fire) and
// reads the pipe frame due then. Small differences are taken up by playing up to 0.2 % faster or
// slower (interpolated, inaudible - skipping single frames instead crackled), large ones by a jump.
// Nothing here knows the band clock: JS converts with the same wall clock.
//
// The engine core (native/engine, docs/30 §8h stage 3) can add the click here, in the callback: JS
// hands it the whole plan (beats, transport) and the offset band time - wall clock; it places each
// click on the sample from AAudio's own timestamp, so the click needs neither the WebView nor its
// timers - a locked screen throttles those to once a minute (Fire, 2026-11-10).
#include <jni.h>
#include <aaudio/AAudio.h>
#include <android/log.h>
#include <linux/usbdevice_fs.h>
#include <sys/ioctl.h>
#include <sys/resource.h>
#include <unistd.h>
#include <algorithm>
#include <cerrno>
#include <cstdlib>
#include <cstring>
#include <atomic>
#include <cmath>
#include <cstdarg>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <ctime>
#include <map>
#include <mutex>
#include <string>
#include <memory>
#include <thread>
#include <vector>

#include "stageboard/engine.h"
#include "stageboard/stream_clip.h"

#define LOG(...) __android_log_print(ANDROID_LOG_INFO, "NativeOutput", __VA_ARGS__)

namespace {
constexpr int RING_FRAMES = 1 << 17;   // ~2.7 s at 48 kHz - well above any delay we choose
/** A difference up to this is taken up frame by frame, above it the read position jumps. */
constexpr double JUMP_MS = 20.0;
/** How fast a difference is taken up: playing faster/slower by off / this, at most MAX_RATE_DEVIATION -
 * plus an integral part (INTEGRAL_TIME_S) that learns the steady speed difference: the WebView's
 * clock runs ~1 ms/s slower than the wall clock, and with the proportional part alone following
 * it took a lasting 2-4 ms offset that changed with the load (2026-11-05). */
constexpr double PULL_TIME_S = 2.0;
constexpr double INTEGRAL_TIME_S = 20.0;
constexpr double MAX_RATE_DEVIATION = 0.004;
/** A timestamp this far from the running estimate is an outlier - or a real move, once it has held
 * for TIMESTAMP_CONFIRM_MS. Three callbacks in a row were not enough: the Redmi's timestamps stay
 * ~5 ms off for a few dozen ms at a time, and each such stretch moved its output there and back
 * (115 confirmed "jumps" in an hour, playback speed swinging ±0.05 %, 2026-11-05). */
constexpr double TIMESTAMP_JUMP_MS = 3.0;
constexpr double TIMESTAMP_CONFIRM_MS = 500.0;
/** No timestamp for this long after opening: play on an estimated one (the buffer's length) instead
 * of waiting. The Redmi's USB output, reopened after the cable came back, never gave one - and the
 * output wrote silence until the tablet rebooted (2026-11-12). A real timestamp, should one come,
 * takes over like any other move (TIMESTAMP_CONFIRM_MS). */
constexpr double NO_TIMESTAMP_MS = 500.0;

std::mutex gLock;   // open/close only - never taken in the callback
AAudioStream *gStream = nullptr;
int gRate = 48000;
bool gLowLatency = true;  // set at nativeStart, before the stream opens
int gChannels = 2;
std::atomic<bool> gReopen{false};

float gRing[RING_FRAMES * 2];
std::atomic<long long> gWritten{0};
std::atomic<double> gBaseMs{0};

// Callback thread only.
long long gFrames = 0;
bool gLocked = false;
double gHeardMs0 = 0;   // wall-clock time at which the current buffer's first frame is heard
double gPendingErr = 0;  // an unconfirmed move of the timestamps, and since which frame it holds
long long gPendingSince = -1;
double gRead = -1;   // pipe frame position, fractional
double gRateIntegral = 0;   // learned steady speed difference (fraction)
long long gNoStampFrames = 0;   // frames played since opening without a timestamp

// Stats for JS.
std::atomic<double> gLatencyMs{-1};
std::atomic<double> gLeadMs{0};
std::atomic<double> gLeadMinMs{1e9};
std::atomic<long long> gJumps{0};
std::atomic<long long> gTimestampJumps{0};
std::atomic<double> gRateDev{0};   // current speed - 1
std::atomic<long long> gMissing{0};
std::atomic<long long> gReopens{0};
std::atomic<int> gError{0};
std::atomic<bool> gEstimated{false};   // playing on an estimated timestamp (NO_TIMESTAMP_MS)

// The engine core. Made at nativeStart while no stream runs; its setters (JNI, one at a time under
// gEngineLock) are the control thread, the callback renders and feeds the clock.
std::mutex gEngineLock;
std::unique_ptr<stageboard::Engine> gEngine;
std::atomic<bool> gEngineOn{false};
/** Band time minus wall clock (server offset + this output's trim), from JS; NaN until known. */
std::atomic<double> gBandOffsetMs{NAN};
/** The clock goes to the engine this often - it learns the drift over a minute of these. */
constexpr double ENGINE_CLOCK_MS = 500.0;
// Clip files arriving in pieces (base64 over the plugin), by clip id - control side, gEngineLock.
std::map<int, std::vector<uint8_t>> gStaging;
// The streamed clips handed to the engine, by id - read for self-monitoring only (counters are atomic).
std::map<int, stageboard::StreamedClip *> gStreamed;
std::once_flag gPumpStarted;
long long gEngineClockAt = 0;   // callback thread: frame of the last clock observation
float gEngineOut[2 * 4096];

int64_t clockNs(clockid_t id) {
    timespec ts{};
    clock_gettime(id, &ts);
    return ts.tv_sec * 1000000000LL + ts.tv_nsec;
}

std::string json(const char *fmt, ...) __attribute__((format(printf, 1, 2)));
std::string json(const char *fmt, ...) {
    char buf[1024];
    va_list args;
    va_start(args, fmt);
    vsnprintf(buf, sizeof buf, fmt, args);
    va_end(args);
    return buf;
}

void resetCallbackState() {
    gFrames = 0;
    gEngineClockAt = -1;
    gLocked = false;
    gPendingSince = -1;
    gRead = -1;
    gRateIntegral = 0;
    gNoStampFrames = 0;
    gEstimated = false;
}

float ringAt(long long f, int ch, long long written, bool &missing) {
    if (f < 0 || f >= written || f < written - RING_FRAMES) {
        missing = true;
        return 0.f;
    }
    return gRing[2 * static_cast<int>(f & (RING_FRAMES - 1)) + ch];
}

/** The wall-clock time frame gFrames - the next one written - is heard, `measured` from the output's
 * own timestamp: taken at once the first time, a jump only once confirmed, jitter followed slowly. */
void followHeard(double measured) {
    const double msPerFrame = 1000.0 / gRate;
    const double err = measured - gHeardMs0;
    if (!gLocked) {
        gHeardMs0 = measured;
        gLocked = true;
    } else if (std::fabs(err) > TIMESTAMP_JUMP_MS) {
        if (gPendingSince < 0 || std::fabs(err - gPendingErr) > TIMESTAMP_JUMP_MS) gPendingSince = gFrames;
        gPendingErr = err;
        if ((gFrames - gPendingSince) * msPerFrame >= TIMESTAMP_CONFIRM_MS) {
            gTimestampJumps.fetch_add(1);
            gHeardMs0 = measured;
            gPendingSince = -1;
        }
    } else {
        gPendingSince = -1;
        gHeardMs0 += 0.02 * err;   // timestamps jitter by a burst; follow slowly
    }
}

/**
 * Renders `numFrames` frames of `gChannels` into `out`: the pipe (the WebView's mix, placed by its
 * band time) plus the engine core - for whichever output runs, AAudio's callback or the own USB
 * driver (docs/28 §4). Frame gFrames is heard at gHeardMs0.
 */
void produce(float *out, int numFrames) {
    const double msPerFrame = 1000.0 / gRate;
    const long long written = gWritten.load();
    const double base = gBaseMs.load();
    double step = 1.0;
    if (gLocked && written > 0 && base > 0) {
        const double want = (gHeardMs0 - base) * gRate / 1000.0;
        const double off = (want - gRead) * msPerFrame;
        if (gRead < 0 || std::fabs(off) > JUMP_MS) {
            if (gRead >= 0) gJumps.fetch_add(1);
            gRead = want;
        } else {
            const double dtS = numFrames / static_cast<double>(gRate);
            gRateIntegral = std::max(-MAX_RATE_DEVIATION, std::min(MAX_RATE_DEVIATION, gRateIntegral + off / 1000.0 * dtS / (PULL_TIME_S * INTEGRAL_TIME_S)));
            step = 1.0 + std::max(-MAX_RATE_DEVIATION, std::min(MAX_RATE_DEVIATION, off / 1000.0 / PULL_TIME_S + gRateIntegral));
        }
        gRateDev.store(step - 1.0);
        const double lead = (static_cast<double>(written) - gRead) * msPerFrame;
        gLeadMs.store(lead);
        if (lead < gLeadMinMs.load()) gLeadMinMs.store(lead);
    }
    for (int i = 0; i < numFrames; i++) {
        float l = 0.f, r = 0.f;
        if (gRead >= 0) {
            const long long f = static_cast<long long>(std::floor(gRead));
            const float frac = static_cast<float>(gRead - static_cast<double>(f));
            bool missing = false;
            l = ringAt(f, 0, written, missing) * (1.f - frac) + ringAt(f + 1, 0, written, missing) * frac;
            r = ringAt(f, 1, written, missing) * (1.f - frac) + ringAt(f + 1, 1, written, missing) * frac;
            if (missing) gMissing.fetch_add(1);
            gRead += step;
        }
        out[i * gChannels] = l;
        if (gChannels > 1) out[i * gChannels + 1] = r;
        for (int c = 2; c < gChannels; c++) out[i * gChannels + c] = 0.f;
    }
    if (gEngineOn.load() && gEngine) {
        // Frame gFrames - this buffer's first - is heard at gHeardMs0 (wall clock, smoothed above).
        const double offset = gBandOffsetMs.load();
        if (gLocked && !std::isnan(offset) && (gEngineClockAt < 0 || (gFrames - gEngineClockAt) * msPerFrame >= ENGINE_CLOCK_MS)) {
            gEngine->observeClockNow(gFrames, gHeardMs0 + offset);
            gEngineClockAt = gFrames;
        }
        for (int done = 0; done < numFrames;) {
            const int n = std::min(numFrames - done, 4096);
            gEngine->render(gEngineOut, n, gFrames + done);
            // Each source's side comes from the engine's feeds (the output plan) - added as it is.
            for (int i = 0; i < n; i++) {
                float *frame = out + (done + i) * gChannels;
                frame[0] += gEngineOut[2 * i];
                if (gChannels > 1) frame[1] += gEngineOut[2 * i + 1];
            }
            done += n;
        }
    }
    gFrames += numFrames;
    if (gLocked) gHeardMs0 += numFrames * msPerFrame;
}

aaudio_data_callback_result_t onData(AAudioStream *stream, void *, void *audioData, int32_t numFrames) {
    const double msPerFrame = 1000.0 / gRate;
    int64_t framePos = 0, timeNs = 0;
    if (AAudioStream_getTimestamp(stream, CLOCK_MONOTONIC, &framePos, &timeNs) == AAUDIO_OK) {
        gEstimated = false;
        const int64_t mono = clockNs(CLOCK_MONOTONIC);
        const int64_t real = clockNs(CLOCK_REALTIME);
        // Frames between the timestamp's frame and the next one we write - a fraction of a second.
        // Taken modulo 2^32: Android 9's AAudio (legacy AudioTrack path, the Fire) reports a 32-bit
        // position, which wraps after 2^31 frames (12.4 h at 48 kHz) - with the app kept awake
        // overnight the output then sat 2^32 frames (24.9 h) "late" and played nothing.
        const auto ahead = static_cast<int32_t>(static_cast<uint32_t>(static_cast<uint64_t>(gFrames - framePos)));
        const double heardMonoNs = static_cast<double>(timeNs) + static_cast<double>(ahead) * 1e9 / gRate;
        gLatencyMs.store((heardMonoNs - static_cast<double>(mono)) / 1e6);
        followHeard((heardMonoNs + static_cast<double>(real - mono)) / 1e6);
    } else if (!gLocked) {
        gNoStampFrames += numFrames;
        if (gNoStampFrames * msPerFrame >= NO_TIMESTAMP_MS) {
            const double bufferMs = AAudioStream_getBufferSizeInFrames(stream) * msPerFrame;
            gLatencyMs.store(bufferMs);
            gHeardMs0 = static_cast<double>(clockNs(CLOCK_REALTIME)) / 1e6 + bufferMs;
            gLocked = true;
            gEstimated = true;
        }
    }
    produce(static_cast<float *>(audioData), numFrames);
    return AAUDIO_CALLBACK_RESULT_CONTINUE;
}

aaudio_result_t openStream();

void onError(AAudioStream *, void *, aaudio_result_t error) {
    gError.store(error);
    LOG("stream error %d (%s)", error, AAudio_convertResultToText(error));
    // The output changed (headphones, Bluetooth, USB): AAudio disconnects the stream. Reopen it on
    // the new default output - from another thread, never from this callback.
    if (error == AAUDIO_ERROR_DISCONNECTED && !gReopen.exchange(true)) {
        std::thread([] {
            std::lock_guard<std::mutex> guard(gLock);
            if (gStream) {
                AAudioStream_close(gStream);
                gStream = nullptr;
                if (openStream() == AAUDIO_OK) gReopens.fetch_add(1);
            }
            gReopen = false;
        }).detach();
    }
}

// Caller holds gLock.
aaudio_result_t openStream() {
    AAudioStreamBuilder *b = nullptr;
    aaudio_result_t r = AAudio_createStreamBuilder(&b);
    if (r != AAUDIO_OK) return r;
    AAudioStreamBuilder_setDirection(b, AAUDIO_DIRECTION_OUTPUT);
    AAudioStreamBuilder_setFormat(b, AAUDIO_FORMAT_PCM_FLOAT);
    AAudioStreamBuilder_setChannelCount(b, 2);
    AAudioStreamBuilder_setSampleRate(b, gRate);
    // Low latency unless the stream came up broken that way (#837): on the Redmi's MediaTek HAL the
    // low-latency path opened right after a USB interface came back played nothing.
    AAudioStreamBuilder_setPerformanceMode(b, gLowLatency ? AAUDIO_PERFORMANCE_MODE_LOW_LATENCY : AAUDIO_PERFORMANCE_MODE_NONE);
    AAudioStreamBuilder_setSharingMode(b, AAUDIO_SHARING_MODE_SHARED);
    AAudioStreamBuilder_setUsage(b, AAUDIO_USAGE_MEDIA);
    AAudioStreamBuilder_setContentType(b, AAUDIO_CONTENT_TYPE_MUSIC);
    AAudioStreamBuilder_setDataCallback(b, onData, nullptr);
    AAudioStreamBuilder_setErrorCallback(b, onError, nullptr);
    r = AAudioStreamBuilder_openStream(b, &gStream);
    AAudioStreamBuilder_delete(b);
    if (r != AAUDIO_OK) {
        gStream = nullptr;
        return r;
    }
    gChannels = AAudioStream_getChannelCount(gStream);
    // Two bursts of buffer, as Oboe recommends - less is underrun-prone.
    AAudioStream_setBufferSizeInFrames(gStream, 2 * AAudioStream_getFramesPerBurst(gStream));
    resetCallbackState();
    return AAudioStream_requestStart(gStream);
}

const char *perf(aaudio_performance_mode_t m) {
    return m == AAUDIO_PERFORMANCE_MODE_LOW_LATENCY ? "low-latency" : m == AAUDIO_PERFORMANCE_MODE_POWER_SAVING ? "power-saving" : "none";
}
// ---- The own USB driver (docs/28 §4, #837) ---------------------------------------------------
// Some devices never get a working isochronous stream through Android's USB audio (the Redmi's
// MediaTek HAL: "cannot prepare channel: Device or resource busy" after a re-plug, even after a
// reboot, 2026-11-13) - while a driver in the app over the same cable works (spike, docs/28 §4).
// The Java side claims the interfaces, picks the alt setting and sets the rate; here isochronous
// OUT URBs stay queued (1 ms each), packet sizes follow the interface's feedback endpoint, and the
// frames come from produce() - the same pipe and engine as AAudio's callback.

constexpr int kUsbUrbs = 8;             // 8 ms queued
constexpr int kUsbMaxChannels = 8;
/** From the last frame leaving the bus to it being heard: the interface's DAC and output stage
 * (UMC204HD: ~1 ms). A first value - the per-device trim (latencyProfiles.ts) covers the rest. */
constexpr double kUsbDeviceMs = 1.0;

struct UsbConfig {
    int fd, epOut, maxPacket, epFb, fbMaxPacket, channels, subslot, rate, packetsPerUrb;
    bool highSpeed;
};

UsbConfig gUsb{};
std::thread gUsbThread;
std::atomic<bool> gUsbStop{false};
std::atomic<bool> gUsbRunning{false};
std::atomic<bool> gUsbDisconnected{false};
std::atomic<long long> gUsbUrbs{0}, gUsbPacketErrors{0}, gUsbFbCount{0};
std::atomic<double> gUsbFbFrames{0.0};  // frames per packet, from the feedback endpoint
std::atomic<int> gUsbErrno{0};
std::vector<float> gUsbScratch;         // rendered frames of one URB, float, gChannels each
// Self-monitoring in the log (docs/30 §8i) - also while the screen is locked and the page frozen:
// what actually leaves per side, every USB_LOG_MS.
constexpr long long USB_LOG_MS = 30000;
double gUsbSumSq[2] = {0, 0}, gUsbPeak[2] = {0, 0};
long long gUsbLevelFrames = 0;

usbdevfs_urb *allocUrb(int packets, int bufferSize) {
    const size_t size = sizeof(usbdevfs_urb) + static_cast<size_t>(packets) * sizeof(usbdevfs_iso_packet_desc);
    auto *urb = static_cast<usbdevfs_urb *>(calloc(1, size));
    urb->buffer = calloc(1, static_cast<size_t>(bufferSize));
    urb->number_of_packets = packets;
    return urb;
}

void freeUrb(usbdevfs_urb *urb) {
    free(urb->buffer);
    free(urb);
}

void prepareIso(usbdevfs_urb *urb, int endpoint, int packets, int packetLength) {
    urb->type = USBDEVFS_URB_TYPE_ISO;
    urb->endpoint = static_cast<unsigned char>(endpoint);
    urb->flags = USBDEVFS_URB_ISO_ASAP;
    urb->buffer_length = packets * packetLength;
    urb->actual_length = 0;
    urb->status = 0;
    urb->number_of_packets = packets;
    for (int i = 0; i < packets; i++) {
        urb->iso_frame_desc[i].length = static_cast<unsigned>(packetLength);
        urb->iso_frame_desc[i].actual_length = 0;
        urb->iso_frame_desc[i].status = 0;
    }
}

/** High speed 16.16 frames per microframe, full speed 10.14 per ms - devices get it wrong both ways,
 * so take the scaling that lands near nominal (spike, docs/28 §4). */
void parseFeedback(const usbdevfs_urb *urb) {
    const unsigned len = urb->iso_frame_desc[0].actual_length;
    if (len < 3) return;
    const auto *b = static_cast<const unsigned char *>(urb->buffer);
    const unsigned v = b[0] | (b[1] << 8) | (b[2] << 16) | (len >= 4 ? (static_cast<unsigned>(b[3]) << 24) : 0u);
    const double nominal = gUsb.rate / (gUsb.highSpeed ? 8000.0 : 1000.0);
    const double candidates[] = {v / 65536.0, v / 65536.0 / 8.0, v / 16384.0, v / 16384.0 / 8.0};
    for (double f : candidates) {
        if (std::fabs(f - nominal) < nominal * 0.05) {
            gUsbFbFrames.store(f);
            gUsbFbCount.fetch_add(1);
            return;
        }
    }
}

/** Fills one OUT URB from produce(); `queuedFrames` are already on their way ahead of it. */
void fillUsb(usbdevfs_urb *urb, double &acc, long long queuedFrames, int &frames) {
    const UsbConfig &c = gUsb;
    const int frameBytes = c.channels * c.subslot;
    const int maxFrames = c.maxPacket / frameBytes;
    int sizes[64];
    int total = 0;
    for (int i = 0; i < c.packetsPerUrb; i++) {
        acc += gUsbFbFrames.load();
        int n = static_cast<int>(acc);
        acc -= n;
        n = std::min(n, maxFrames);
        sizes[i] = n;
        total += n;
    }
    // Heard when everything queued before it has played, plus the interface's own delay.
    const double msPerFrame = 1000.0 / gRate;
    const double now = static_cast<double>(clockNs(CLOCK_REALTIME)) / 1e6;
    const double heard = now + static_cast<double>(queuedFrames) * msPerFrame + kUsbDeviceMs;
    gLatencyMs.store(heard - now);
    followHeard(heard);
    if (gUsbScratch.size() < static_cast<size_t>(total * c.channels)) gUsbScratch.resize(static_cast<size_t>(total * c.channels));
    produce(gUsbScratch.data(), total);
    for (int f = 0; f < total; f++)
        for (int ch = 0; ch < 2 && ch < c.channels; ch++) {
            const double v = gUsbScratch[static_cast<size_t>(f * c.channels + ch)];
            gUsbSumSq[ch] += v * v;
            gUsbPeak[ch] = std::fmax(gUsbPeak[ch], std::fabs(v));
        }
    gUsbLevelFrames += total;
    // UAC: the significant bits sit at the top of the subslot, little endian.
    auto *p = static_cast<unsigned char *>(urb->buffer);
    const float *src = gUsbScratch.data();
    for (int k = 0; k < total * c.channels; k++) {
        const float v = std::fmax(-1.f, std::fmin(1.f, src[k]));
        const auto sample = static_cast<int32_t>(static_cast<double>(v) * 2147483647.0);
        for (int b = 0; b < c.subslot; b++) *p++ = static_cast<unsigned char>(sample >> (8 * (4 - c.subslot + b)));
    }
    urb->type = USBDEVFS_URB_TYPE_ISO;
    urb->endpoint = static_cast<unsigned char>(c.epOut);
    urb->flags = USBDEVFS_URB_ISO_ASAP;
    urb->buffer_length = total * frameBytes;
    urb->actual_length = 0;
    urb->status = 0;
    urb->number_of_packets = c.packetsPerUrb;
    for (int i = 0; i < c.packetsPerUrb; i++) {
        urb->iso_frame_desc[i].length = static_cast<unsigned>(sizes[i] * frameBytes);
        urb->iso_frame_desc[i].actual_length = 0;
        urb->iso_frame_desc[i].status = 0;
    }
    frames = total;
}

void runUsb() {
    const UsbConfig &c = gUsb;
    // Audio priority (ANDROID_PRIORITY_URGENT_AUDIO) - apps may set it for their own threads.
    setpriority(PRIO_PROCESS, static_cast<id_t>(gettid()), -19);
    std::vector<usbdevfs_urb *> outs, fbs;
    std::map<usbdevfs_urb *, int> framesOf;
    double acc = 0.0;
    long long queued = 0;
    auto fail = [](const char *what) {
        const int e = errno;
        gUsbErrno.store(e);
        if (e == ENODEV || e == ESHUTDOWN || e == EPROTO) gUsbDisconnected = true;
        LOG("usb %s: %s (errno %d)", what, strerror(e), e);
    };
    for (int i = 0; i < kUsbUrbs; i++) outs.push_back(allocUrb(c.packetsPerUrb, c.maxPacket * c.packetsPerUrb));
    if (c.epFb) for (int i = 0; i < 2; i++) fbs.push_back(allocUrb(1, c.fbMaxPacket));
    bool ok = true;
    for (auto *u : fbs) {
        prepareIso(u, c.epFb, 1, c.fbMaxPacket);
        if (ioctl(c.fd, USBDEVFS_SUBMITURB, u) < 0) { fail("submit feedback"); ok = false; break; }
    }
    for (size_t i = 0; ok && i < outs.size(); i++) {
        int n = 0;
        fillUsb(outs[i], acc, queued, n);
        if (ioctl(c.fd, USBDEVFS_SUBMITURB, outs[i]) < 0) { fail("submit out"); ok = false; break; }
        framesOf[outs[i]] = n;
        queued += n;
    }
    gUsbRunning = ok;
    while (ok && !gUsbStop.load()) {
        usbdevfs_urb *urb = nullptr;
        if (ioctl(c.fd, USBDEVFS_REAPURB, &urb) < 0) {
            if (errno == EINTR) continue;
            fail("reap");
            break;
        }
        if (c.epFb && urb->endpoint == static_cast<unsigned char>(c.epFb)) {
            if (urb->status == 0) parseFeedback(urb);
            prepareIso(urb, c.epFb, 1, c.fbMaxPacket);
            if (ioctl(c.fd, USBDEVFS_SUBMITURB, urb) < 0) { fail("resubmit feedback"); break; }
            continue;
        }
        gUsbUrbs.fetch_add(1);
        for (int i = 0; i < urb->number_of_packets; i++)
            if (urb->iso_frame_desc[i].status != 0) gUsbPacketErrors.fetch_add(1);
        if (urb->status != 0 && urb->status != -EXDEV) {
            errno = -urb->status;
            fail("out urb");
            break;
        }
        queued -= framesOf[urb];
        if (gUsbLevelFrames >= USB_LOG_MS * c.rate / 1000) {
            auto db = [](double x) { return x > 0 ? 20 * std::log10(x) : -200.0; };
            const double n = static_cast<double>(gUsbLevelFrames);
            LOG("usb status: urbs %lld packetErrors %lld feedback %.1f Hz pipeMissing %lld engine %d clockJumps %d driftPpm %.1f "
                "left rms %.1f peak %.1f dBFS right rms %.1f peak %.1f dBFS",
                static_cast<long long>(gUsbUrbs), static_cast<long long>(gUsbPacketErrors), gUsbFbFrames.load() * (c.highSpeed ? 8000.0 : 1000.0),
                static_cast<long long>(gMissing), gEngineOn.load() ? 1 : 0, gEngine ? gEngine->clockJumps() : -1, gEngine ? gEngine->clockDriftPpm() : 0.0,
                db(std::sqrt(gUsbSumSq[0] / n)), db(gUsbPeak[0]), db(std::sqrt(gUsbSumSq[1] / n)), db(gUsbPeak[1]));
            gUsbSumSq[0] = gUsbSumSq[1] = gUsbPeak[0] = gUsbPeak[1] = 0;
            gUsbLevelFrames = 0;
        }
        int n = 0;
        fillUsb(urb, acc, queued, n);
        if (ioctl(c.fd, USBDEVFS_SUBMITURB, urb) < 0) { fail("resubmit out"); break; }
        framesOf[urb] = n;
        queued += n;
    }
    // Whatever is still queued is cancelled and reaped before the buffers go.
    for (auto *u : outs) ioctl(c.fd, USBDEVFS_DISCARDURB, u);
    for (auto *u : fbs) ioctl(c.fd, USBDEVFS_DISCARDURB, u);
    for (size_t i = 0; i < outs.size() + fbs.size(); i++) {
        usbdevfs_urb *urb = nullptr;
        if (ioctl(c.fd, USBDEVFS_REAPURB, &urb) < 0) break;
    }
    for (auto *u : outs) freeUrb(u);
    for (auto *u : fbs) freeUrb(u);
    gUsbRunning = false;
}

void stopUsb() {
    gUsbStop = true;
    if (gUsbThread.joinable()) gUsbThread.join();
    gUsbStop = false;
    gUsbRunning = false;
}

}  // namespace

/** What both outputs need before they run: the engine for this rate, the decoding thread, the
 * counters from zero. Under gLock, nothing playing. */
void prepareOutput(int sampleRate) {
    {
        // No stream runs now: the engine may be made (again) for this rate.
        std::lock_guard<std::mutex> engine(gEngineLock);
        if (!gEngine || gRate != sampleRate) {
            gEngine = std::make_unique<stageboard::Engine>(sampleRate, 2);
            gStaging.clear();
            gStreamed.clear();
        }
    }
    // The decoding thread (docs/30 §8h stage 4): streamed clips decode their windows ahead of the
    // callback, at most 100 ms of audio per window and call - the callback only reads.
    std::call_once(gPumpStarted, [] {
        std::thread([] {
            for (;;) {
                {
                    std::lock_guard<std::mutex> engine(gEngineLock);
                    if (gEngine) {
                        gEngine->pump();
                        gEngine->collectGarbage();
                    }
                }
                std::this_thread::sleep_for(std::chrono::milliseconds(10));
            }
        }).detach();
    });
    gRate = sampleRate;
    gWritten = 0;
    gBaseMs = 0;
    gLatencyMs = -1;
    gLeadMs = 0;
    gLeadMinMs = 1e9;
    gJumps = 0;
    gTimestampJumps = 0;
    gRateDev = 0;
    gMissing = 0;
    gReopens = 0;
    gError = 0;
}

extern "C" JNIEXPORT jstring JNICALL
Java_de_stageboard_app_NativeOutputPlugin_nativeStart(JNIEnv *env, jclass, jint sampleRate, jboolean lowLatency) {
    std::lock_guard<std::mutex> guard(gLock);
    stopUsb();
    if (gStream) {
        AAudioStream_close(gStream);
        gStream = nullptr;
    }
    prepareOutput(sampleRate);
    gLowLatency = lowLatency;
    const aaudio_result_t r = openStream();
    if (!gStream) return env->NewStringUTF(json("{\"error\":\"%s\"}", AAudio_convertResultToText(r)).c_str());
    return env->NewStringUTF(json("{\"started\":%s,\"sampleRate\":%d,\"channels\":%d,\"performance\":\"%s\",\"framesPerBurst\":%d,\"bufferFrames\":%d}",
                                  r == AAUDIO_OK ? "true" : "false", AAudioStream_getSampleRate(gStream), gChannels,
                                  perf(AAudioStream_getPerformanceMode(gStream)), AAudioStream_getFramesPerBurst(gStream),
                                  AAudioStream_getBufferSizeInFrames(gStream)).c_str());
}

// Interleaved stereo int16 for pipe frames [frame, frame + n); pipe frame 0 is heard at `baseMs`.
extern "C" JNIEXPORT void JNICALL
Java_de_stageboard_app_NativeOutputPlugin_nativePush(JNIEnv *env, jclass, jlong frame, jshortArray data, jdouble baseMs) {
    const jsize len = env->GetArrayLength(data);
    jshort *p = env->GetShortArrayElements(data, nullptr);
    const int n = len / 2;
    for (int i = 0; i < n; i++) {
        const int k = static_cast<int>((frame + i) & (RING_FRAMES - 1));
        gRing[2 * k] = p[2 * i] / 32768.f;
        gRing[2 * k + 1] = p[2 * i + 1] / 32768.f;
    }
    env->ReleaseShortArrayElements(data, p, JNI_ABORT);
    gBaseMs = baseMs;
    if (frame + n > gWritten.load()) gWritten = frame + n;
}

/** Self-monitoring (docs/30 §8i): streamed pieces with frames missing, or dropped (window moved). */
int streamedReads(bool missing) {
    std::lock_guard<std::mutex> engine(gEngineLock);
    int sum = 0;
    for (const auto &entry : gStreamed) sum += missing ? entry.second->missingReads() : entry.second->brokenReads();
    return sum;
}

extern "C" JNIEXPORT jstring JNICALL
Java_de_stageboard_app_NativeOutputPlugin_nativeStatus(JNIEnv *env, jclass) {
    std::lock_guard<std::mutex> guard(gLock);
    if (gUsbThread.joinable()) {
        const double leadMin = gLeadMinMs.exchange(1e9);
        // The own USB driver: gone when unplugged - "disconnected", nothing plays any more.
        return env->NewStringUTF(json(
                "{\"open\":%s,\"path\":\"usb\",\"state\":\"%s\",\"latencyMs\":%.2f,\"leadMs\":%.1f,\"leadMinMs\":%.1f,\"jumps\":%lld,\"timestampJumps\":%lld,"
                "\"rateDevPpm\":%.0f,\"missing\":%lld,\"xruns\":%lld,\"reopens\":0,\"error\":%d,\"performance\":\"usb\",\"framesPerBurst\":%d,"
                "\"usbRate\":%.2f,\"usbFeedback\":%lld,\"usbUrbs\":%lld,\"usbDisconnected\":%s,"
                "\"engine\":%s,\"engineClockJumps\":%d,\"engineDriftPpm\":%.1f,\"engineMissingReads\":%d,\"engineBrokenReads\":%d,\"estimated\":false}",
                gUsbRunning.load() ? "true" : "false", gUsbRunning.load() ? "USB_RUNNING" : gUsbDisconnected.load() ? "USB_DISCONNECTED" : "USB_STOPPED",
                gLatencyMs.load(), gLeadMs.load(), leadMin > 1e8 ? -1.0 : leadMin, static_cast<long long>(gJumps), static_cast<long long>(gTimestampJumps),
                gRateDev.load() * 1e6, static_cast<long long>(gMissing), static_cast<long long>(gUsbPacketErrors), gUsbErrno.load(),
                static_cast<int>(gUsbFbFrames.load() * gUsb.packetsPerUrb), gUsbFbFrames.load() * (gUsb.highSpeed ? 8000.0 : 1000.0),
                static_cast<long long>(gUsbFbCount), static_cast<long long>(gUsbUrbs), gUsbDisconnected.load() ? "true" : "false",
                gEngineOn.load() ? "true" : "false", gEngine ? gEngine->clockJumps() : 0, gEngine ? gEngine->clockDriftPpm() : 0.0,
                streamedReads(true), streamedReads(false)).c_str());
    }
    if (!gStream) return env->NewStringUTF("{\"open\":false}");
    const double leadMin = gLeadMinMs.exchange(1e9);
    return env->NewStringUTF(json(
            "{\"open\":true,\"state\":\"%s\",\"latencyMs\":%.2f,\"leadMs\":%.1f,\"leadMinMs\":%.1f,\"jumps\":%lld,\"timestampJumps\":%lld,\"rateDevPpm\":%.0f,"
            "\"missing\":%lld,\"xruns\":%d,\"reopens\":%lld,\"error\":%d,\"performance\":\"%s\",\"framesPerBurst\":%d,"
            "\"engine\":%s,\"engineClockJumps\":%d,\"engineDriftPpm\":%.1f,\"engineMissingReads\":%d,\"engineBrokenReads\":%d,\"estimated\":%s}",
            AAudio_convertStreamStateToText(AAudioStream_getState(gStream)), gLatencyMs.load(), gLeadMs.load(), leadMin > 1e8 ? -1.0 : leadMin,
            static_cast<long long>(gJumps), static_cast<long long>(gTimestampJumps), gRateDev.load() * 1e6, static_cast<long long>(gMissing), AAudioStream_getXRunCount(gStream),
            static_cast<long long>(gReopens), gError.load(), perf(AAudioStream_getPerformanceMode(gStream)),
            AAudioStream_getFramesPerBurst(gStream), gEngineOn.load() ? "true" : "false",
            gEngine ? gEngine->clockJumps() : 0, gEngine ? gEngine->clockDriftPpm() : 0.0, streamedReads(true), streamedReads(false), gEstimated.load() ? "true" : "false").c_str());
}

/** The own USB driver instead of AAudio (docs/28 §4): the interface's file descriptor and what the
 * Java side picked from its descriptors. */
extern "C" JNIEXPORT jstring JNICALL
Java_de_stageboard_app_NativeOutputPlugin_nativeUsbStart(JNIEnv *env, jclass, jint fd, jint epOut, jint maxPacket, jint epFb, jint fbMaxPacket,
                                                         jint channels, jint subslot, jint sampleRate, jboolean highSpeed) {
    std::lock_guard<std::mutex> guard(gLock);
    stopUsb();
    if (gStream) {
        AAudioStream_close(gStream);
        gStream = nullptr;
    }
    if (channels < 1 || channels > kUsbMaxChannels || subslot < 2 || subslot > 4 || maxPacket <= 0)
        return env->NewStringUTF(json("{\"error\":\"unsupported format: %d channels, %d bytes\"}", channels, subslot).c_str());
    prepareOutput(sampleRate);
    resetCallbackState();
    gChannels = channels;
    gUsb = UsbConfig{fd, epOut, maxPacket, epFb, fbMaxPacket, channels, subslot, sampleRate, highSpeed ? 8 : 1, static_cast<bool>(highSpeed)};
    gUsbFbFrames = sampleRate / (highSpeed ? 8000.0 : 1000.0);  // nominal until the feedback arrives
    gUsbUrbs = 0;
    gUsbPacketErrors = 0;
    gUsbFbCount = 0;
    gUsbErrno = 0;
    gUsbDisconnected = false;
    gUsbThread = std::thread(runUsb);
    for (int i = 0; i < 100 && !gUsbRunning.load() && gUsbErrno.load() == 0; i++) std::this_thread::sleep_for(std::chrono::milliseconds(5));
    if (!gUsbRunning.load()) {
        stopUsb();
        return env->NewStringUTF(json("{\"error\":\"usb start: %s\"}", strerror(gUsbErrno.load())).c_str());
    }
    return env->NewStringUTF(json("{\"started\":true,\"path\":\"usb\",\"sampleRate\":%d,\"channels\":%d,\"performance\":\"usb\",\"framesPerBurst\":%d}",
                                  sampleRate, channels, static_cast<int>(gUsbFbFrames.load() * gUsb.packetsPerUrb)).c_str());
}

/** After releasing an interface: Android's own driver binds it again (usbfs leaves it without one). */
extern "C" JNIEXPORT jint JNICALL
Java_de_stageboard_app_NativeOutputPlugin_nativeUsbReattach(JNIEnv *, jclass, jint fd, jint ifno) {
    usbdevfs_ioctl command{};
    command.ifno = ifno;
    command.ioctl_code = USBDEVFS_CONNECT;
    command.data = nullptr;
    return ioctl(fd, USBDEVFS_IOCTL, &command);
}

extern "C" JNIEXPORT void JNICALL
Java_de_stageboard_app_NativeOutputPlugin_nativeStop(JNIEnv *, jclass) {
    std::lock_guard<std::mutex> guard(gLock);
    stopUsb();
    if (gStream) {
        AAudioStream_requestStop(gStream);
        AAudioStream_close(gStream);
        gStream = nullptr;
    }
}

// The engine core's control side (docs/30 §8h stage 3). Each call returns at once; the callback
// picks the change up before its next render.

extern "C" JNIEXPORT void JNICALL
Java_de_stageboard_app_NativeOutputPlugin_nativeEngineEnable(JNIEnv *, jclass, jboolean on) {
    gEngineOn = on;
}

/** `status`: 0 stopped, 1 playing, 2 paused. Band times in ms. */
extern "C" JNIEXPORT void JNICALL
Java_de_stageboard_app_NativeOutputPlugin_nativeEngineTransport(JNIEnv *, jclass, jint status, jdouble startedAt, jdouble accumulatedMs, jdouble rate,
                                                                 jboolean hasJump, jdouble jumpAt, jdouble jumpToMs, jdouble jumpRate) {
    std::lock_guard<std::mutex> guard(gEngineLock);
    if (!gEngine) return;
    stageboard::Transport t;
    t.status = status == 1 ? stageboard::PlaybackStatus::Playing : status == 2 ? stageboard::PlaybackStatus::Paused : stageboard::PlaybackStatus::Stopped;
    t.startedAt = startedAt;
    t.accumulatedMs = accumulatedMs;
    t.rate = rate;
    t.hasJump = hasJump;
    t.jumpAt = jumpAt;
    t.jumpToMs = jumpToMs;
    t.jumpRate = jumpRate;
    gEngine->setTransport(t);
    gEngine->collectGarbage();
}

/** The song's beats: song ms, and whether each is a downbeat. */
extern "C" JNIEXPORT void JNICALL
Java_de_stageboard_app_NativeOutputPlugin_nativeEngineBeats(JNIEnv *env, jclass, jdoubleArray songMs, jbooleanArray accent) {
    const jsize n = std::min(env->GetArrayLength(songMs), env->GetArrayLength(accent));
    auto plan = std::make_unique<stageboard::BeatPlan>();
    plan->beats.resize(static_cast<size_t>(n));
    std::vector<jdouble> times(static_cast<size_t>(n));
    std::vector<jboolean> accents(static_cast<size_t>(n));
    env->GetDoubleArrayRegion(songMs, 0, n, times.data());
    env->GetBooleanArrayRegion(accent, 0, n, accents.data());
    for (jsize i = 0; i < n; i++) plan->beats[static_cast<size_t>(i)] = {times[static_cast<size_t>(i)], accents[static_cast<size_t>(i)] != 0};
    std::lock_guard<std::mutex> guard(gEngineLock);
    if (!gEngine) return;
    gEngine->setBeats(plan.release());
    gEngine->collectGarbage();
}

/** Band time - wall clock: the server offset plus what AAudio can't see of this output (its trim). */
extern "C" JNIEXPORT void JNICALL
Java_de_stageboard_app_NativeOutputPlugin_nativeEngineOffset(JNIEnv *, jclass, jdouble offsetMs) {
    gBandOffsetMs = offsetMs;
}

/** `bus` as engine.h's Bus (0 click); -1 the master. */
extern "C" JNIEXPORT void JNICALL
Java_de_stageboard_app_NativeOutputPlugin_nativeEngineGain(JNIEnv *, jclass, jint bus, jfloat gain) {
    std::lock_guard<std::mutex> guard(gEngineLock);
    if (!gEngine) return;
    if (bus < 0) gEngine->setMasterGain(gain);
    else if (bus < static_cast<int>(stageboard::Bus::Count)) gEngine->setGain(static_cast<stageboard::Bus>(bus), gain);
    gEngine->collectGarbage();
}

/** Where bus `bus` goes on the stereo output (engine.h Feed: 0 left, 1 right, 2 both, 3 none) -
 * the output plan (#742): the click on the left for in-ear, the track summed on the right, ... */
extern "C" JNIEXPORT void JNICALL
Java_de_stageboard_app_NativeOutputPlugin_nativeEngineFeeds(JNIEnv *, jclass, jint bus, jint left, jint right) {
    if (bus < 0 || bus >= static_cast<int>(stageboard::Bus::Count) || left < 0 || left > 3 || right < 0 || right > 3) return;
    std::lock_guard<std::mutex> guard(gEngineLock);
    if (!gEngine) return;
    gEngine->setFeeds(static_cast<stageboard::Bus>(bus), static_cast<stageboard::Feed>(left), static_cast<stageboard::Feed>(right));
}

/** A clip's Ogg Opus file in pieces: `size` bytes are coming for clip `id`. */
extern "C" JNIEXPORT void JNICALL
Java_de_stageboard_app_NativeOutputPlugin_nativeClipBegin(JNIEnv *, jclass, jint id, jint size) {
    std::lock_guard<std::mutex> guard(gEngineLock);
    auto &buf = gStaging[id];
    buf.assign(static_cast<size_t>(std::max(0, static_cast<int>(size))), 0);
}

extern "C" JNIEXPORT jboolean JNICALL
Java_de_stageboard_app_NativeOutputPlugin_nativeClipChunk(JNIEnv *env, jclass, jint id, jint offset, jbyteArray data) {
    std::lock_guard<std::mutex> guard(gEngineLock);
    auto it = gStaging.find(id);
    const jsize n = env->GetArrayLength(data);
    if (it == gStaging.end() || offset < 0 || static_cast<size_t>(offset) + static_cast<size_t>(n) > it->second.size()) return JNI_FALSE;
    env->GetByteArrayRegion(data, 0, n, reinterpret_cast<jbyte *>(it->second.data() + offset));
    return JNI_TRUE;
}

/** The file is complete: opened (every page checked) and placed so its frame 0 sounds at song time
 * `songStartMs`. Returns "" or why it can't play. */
extern "C" JNIEXPORT jstring JNICALL
Java_de_stageboard_app_NativeOutputPlugin_nativeClipCommit(JNIEnv *env, jclass, jint id, jdouble songStartMs, jint bus, jfloat gain) {
    std::lock_guard<std::mutex> guard(gEngineLock);
    auto it = gStaging.find(id);
    if (!gEngine || it == gStaging.end()) return env->NewStringUTF("no file");
    if (bus < 0 || bus >= static_cast<int>(stageboard::Bus::Count)) return env->NewStringUTF("bad bus");
    auto clip = std::make_unique<stageboard::StreamedClip>();
    std::string error;
    const bool ok = clip->open(it->second.data(), it->second.size(), &error);
    gStaging.erase(it);
    if (!ok) return env->NewStringUTF(error.empty() ? "cannot open" : error.c_str());
    stageboard::StreamedClip *raw = clip.release();
    if (!gEngine->setClip(id, raw, songStartMs, static_cast<stageboard::Bus>(bus), gain)) {
        delete raw;
        return env->NewStringUTF("engine queue full");
    }
    gStreamed[id] = raw;
    gEngine->collectGarbage();
    return env->NewStringUTF("");
}

extern "C" JNIEXPORT void JNICALL
Java_de_stageboard_app_NativeOutputPlugin_nativeClipRemove(JNIEnv *, jclass, jint id) {
    std::lock_guard<std::mutex> guard(gEngineLock);
    gStaging.erase(id);
    gStreamed.erase(id);
    if (gEngine) gEngine->removeClip(id);
}

extern "C" JNIEXPORT void JNICALL
Java_de_stageboard_app_NativeOutputPlugin_nativeClipGain(JNIEnv *, jclass, jint id, jfloat gain) {
    std::lock_guard<std::mutex> guard(gEngineLock);
    if (gEngine) gEngine->setClipGain(id, gain);
}
