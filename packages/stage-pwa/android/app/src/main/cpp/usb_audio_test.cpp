// Spike for #481 (not for production): our own USB audio driver, bypassing Android's audio stack.
// Some devices (Redmi Pad SE, MediaTek HAL) detect a class-compliant interface but never get an
// isochronous stream through their kernel/HAL path - while an app-side driver over the same cable
// works. This drives the interface straight through usbdevfs on the file descriptor of a
// UsbDeviceConnection: the Java side claims the interfaces, picks the alt settings and sets the
// sample rate; here we keep isochronous URBs queued (1 ms each) - OUT packets sized from the
// interface's feedback endpoint (asynchronous mode), IN packets taken as they come - and report a
// disconnect when unplugged.
//
// Test signal per output channel: a sine (playMask) and/or a 20 ms burst every 500 ms (clickMask).
// The input is analysed on the fly: level, peak and frequency per channel, and - for a loopback
// cable from a click output to an input - the round trip from the burst leaving to it arriving.
#include <jni.h>
#include <android/log.h>
#include <linux/usbdevice_fs.h>
#include <sys/ioctl.h>
#include <sys/resource.h>
#include <unistd.h>
#include <atomic>
#include <cerrno>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <deque>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#define LOG(...) __android_log_print(ANDROID_LOG_INFO, "UsbAudioTest", __VA_ARGS__)

namespace {
constexpr int kUrbs = 8;           // 8 x 1 ms queued per direction
constexpr int kPacketsPerUrb = 8;  // high speed, bInterval 1: one packet per 125 us microframe
constexpr int kFbUrbs = 2;
constexpr int kMaxIn = 8;
constexpr double kClickPeriodS = 0.5, kClickLengthS = 0.02, kClickFreq = 1000.0;
constexpr double kDetectThreshold = 0.01;  // -40 dBFS

struct Config {
    int fd, epOut, maxPacket, epFb, fbMaxPacket, channels, subslot, rate, playMask, clickMask;
    int epIn, inMaxPacket, inChannels, inSubslot, inPackets, inUrbs;
    double freq, gain, clickGain;
    bool highSpeed;
};

Config gCfg{};
std::thread gThread;
std::atomic<bool> gStop{false};
std::atomic<bool> gRunning{false};
std::atomic<long long> gFrames{0}, gPackets{0}, gUrbs{0}, gPacketErrors{0}, gFbCount{0};
std::atomic<long long> gInFrames{0}, gInPacketErrors{0}, gInEmptyPackets{0}, gClicksSent{0};
std::atomic<long long> gInUrbs{0}, gInUrbErrors{0};
std::atomic<int> gInLastStatus{0};
std::atomic<double> gMaxReapGapMs{0};
std::atomic<long long> gReapGapsOver4ms{0};
std::atomic<int> gPriority{0};
std::atomic<long long> gStartedAt{0}, gDisconnectedAt{0};
std::atomic<int> gLastErrno{0};
std::atomic<double> gFbFrames{0.0};  // frames per packet as reported by the feedback endpoint
std::atomic<unsigned> gFbRaw{0};
// Time base per direction: completion time of a URB minus the time its last sample stands for,
// minimum over a 1 s window (the lower envelope removes the reap jitter). Then sample f of the
// output left at offOut + f/rate and sample g of the input arrived at offIn + g/rate.
std::atomic<double> gOffOut{0}, gOffIn{0};
double gWinOut = 1e18, gWinIn = 1e18, gWinStart = 0;

double nowSec() {
    timespec ts{};
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec + ts.tv_nsec * 1e-9;
}

// Input analysis, written by the USB thread, read by status - under gMutex.
std::mutex gMutex;
std::string gError;
struct InStats {
    double sumSq = 0, peak = 0;
    long long n = 0, crossings = 0;
    float last = 0;
    double rmsDb = -200, peakDb = -200, freq = 0;  // of the last finished 0.5 s block
};
InStats gIn[kMaxIn];
std::deque<double> gLatenciesMs;  // round trip of the last bursts (loopback)
long long gClicksDetected = 0;
long long gLastDetectFrame = -1000000;

long long nowMs() {
    timespec ts{};
    clock_gettime(CLOCK_BOOTTIME, &ts);
    return ts.tv_sec * 1000LL + ts.tv_nsec / 1000000;
}

void setError(const std::string &e) {
    std::lock_guard<std::mutex> lock(gMutex);
    gError = e;
}

usbdevfs_urb *allocUrb(int packets, int bufferSize) {
    size_t size = sizeof(usbdevfs_urb) + packets * sizeof(usbdevfs_iso_packet_desc);
    auto *urb = static_cast<usbdevfs_urb *>(calloc(1, size));
    urb->buffer = calloc(1, bufferSize);
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
        urb->iso_frame_desc[i].length = packetLength;
        urb->iso_frame_desc[i].actual_length = 0;
        urb->iso_frame_desc[i].status = 0;
    }
}

// Fills one OUT URB with the next kPacketsPerUrb packets of signal; packet sizes follow the feedback.
void fillOut(usbdevfs_urb *urb, double &acc, long long &frame) {
    const Config &c = gCfg;
    const int frameBytes = c.channels * c.subslot;
    const int maxFrames = c.maxPacket / frameBytes;
    const long long period = static_cast<long long>(kClickPeriodS * c.rate);
    const long long clickLen = static_cast<long long>(kClickLengthS * c.rate);
    auto *p = static_cast<unsigned char *>(urb->buffer);
    int total = 0;
    for (int i = 0; i < kPacketsPerUrb; i++) {
        acc += gFbFrames.load();
        int n = static_cast<int>(acc);
        acc -= n;
        if (n > maxFrames) n = maxFrames;
        for (int f = 0; f < n; f++, frame++) {
            const long long inPeriod = frame % period;
            if (inPeriod == 0 && c.clickMask) gClicksSent.fetch_add(1);
            int k = 0;
            for (int ch = 0; ch < c.channels; ch++) {
                double v = 0.0;
                if (c.playMask & (1 << ch)) {
                    v += c.gain * std::sin(2.0 * M_PI * (c.freq + 220.0 * k) * static_cast<double>(frame) / c.rate);
                    k++;
                }
                if ((c.clickMask & (1 << ch)) && inPeriod < clickLen)
                    v += c.clickGain * std::sin(2.0 * M_PI * kClickFreq * static_cast<double>(inPeriod) / c.rate);
                // UAC: the significant bits sit at the top of the subslot, little endian.
                int32_t s = static_cast<int32_t>(std::fmax(-1.0, std::fmin(1.0, v)) * 2147483647.0);
                for (int b = 0; b < c.subslot; b++) *p++ = static_cast<unsigned char>(s >> (8 * (4 - c.subslot + b)));
            }
        }
        urb->iso_frame_desc[i].length = n * frameBytes;
        total += n * frameBytes;
    }
    urb->type = USBDEVFS_URB_TYPE_ISO;
    urb->endpoint = static_cast<unsigned char>(c.epOut);
    urb->flags = USBDEVFS_URB_ISO_ASAP;
    urb->buffer_length = total;
    urb->actual_length = 0;
    urb->status = 0;
    urb->number_of_packets = kPacketsPerUrb;
    for (int i = 0; i < kPacketsPerUrb; i++) {
        urb->iso_frame_desc[i].actual_length = 0;
        urb->iso_frame_desc[i].status = 0;
    }
}

// High speed: 16.16 frames per microframe (4 bytes); full speed: 10.14 frames per ms (3 bytes).
// Devices get this wrong in both directions, so accept the scaling that lands near nominal.
void parseFb(const usbdevfs_urb *urb) {
    int len = urb->iso_frame_desc[0].actual_length;
    if (len < 3) return;
    const auto *b = static_cast<const unsigned char *>(urb->buffer);
    unsigned v = b[0] | (b[1] << 8) | (b[2] << 16) | (len >= 4 ? (b[3] << 24) : 0);
    gFbRaw.store(v);
    const double nominal = gCfg.rate / (gCfg.highSpeed ? 8000.0 : 1000.0);
    const double candidates[] = {v / 65536.0, v / 65536.0 / 8.0, v / 16384.0, v / 16384.0 / 8.0};
    for (double f : candidates) {
        if (std::fabs(f - nominal) < nominal * 0.05) {
            gFbFrames.store(f);
            gFbCount.fetch_add(1);
            return;
        }
    }
}

// Reads one IN URB: level/frequency per channel, and the arrival of loopback bursts.
void readIn(const usbdevfs_urb *urb, long long &inFrame) {
    const Config &c = gCfg;
    const int frameBytes = c.inChannels * c.inSubslot;
    const int block = c.rate / 2;
    const auto *base = static_cast<const unsigned char *>(urb->buffer);
    std::lock_guard<std::mutex> lock(gMutex);
    for (int i = 0; i < urb->number_of_packets; i++) {
        const auto &d = urb->iso_frame_desc[i];
        if (d.status != 0) gInPacketErrors.fetch_add(1);
        if (d.actual_length == 0) gInEmptyPackets.fetch_add(1);
        // Packets keep their slot in the buffer; only actual_length bytes of each are data.
        const unsigned char *p = base + i * c.inMaxPacket;
        const int n = static_cast<int>(d.actual_length) / frameBytes;
        for (int f = 0; f < n; f++, inFrame++) {
            double loudest = 0;
            for (int ch = 0; ch < c.inChannels && ch < kMaxIn; ch++) {
                int32_t s = 0;
                for (int b = 0; b < c.inSubslot; b++) s |= static_cast<int32_t>(p[b]) << (8 * (4 - c.inSubslot + b));
                p += c.inSubslot;
                const float v = static_cast<float>(s / 2147483648.0);
                InStats &st = gIn[ch];
                st.sumSq += v * v;
                st.peak = std::fmax(st.peak, std::fabs(v));
                if ((st.last < 0) != (v < 0)) st.crossings++;
                st.last = v;
                if (++st.n >= block) {
                    st.rmsDb = 10 * std::log10(st.sumSq / st.n + 1e-20);
                    st.peakDb = 20 * std::log10(st.peak + 1e-10);
                    st.freq = st.crossings * c.rate / (2.0 * st.n);
                    st.sumSq = 0; st.peak = 0; st.n = 0; st.crossings = 0;
                }
                loudest = std::fmax(loudest, std::fabs(v));
            }
            // A burst arrives: first sample above threshold after a quiet 300 ms.
            if (c.clickMask && loudest > kDetectThreshold && inFrame - gLastDetectFrame > c.rate * 3 / 10) {
                gLastDetectFrame = inFrame;
                const double rate = gFbFrames.load() * (c.highSpeed ? 8000.0 : 1000.0);
                const double offOut = gOffOut.load(), offIn = gOffIn.load();
                if (offOut != 0 && offIn != 0) {
                    const long long period = static_cast<long long>(kClickPeriodS * c.rate);
                    const double arrived = offIn + inFrame / rate;
                    const long long outPos = static_cast<long long>((arrived - offOut) * rate);
                    const long long sent = (outPos / period) * period;  // the burst this one belongs to
                    gLatenciesMs.push_back((arrived - (offOut + sent / rate)) * 1000.0);
                }
                if (gLatenciesMs.size() > 10) gLatenciesMs.pop_front();
                gClicksDetected++;
            }
        }
    }
    gInFrames.store(inFrame);
}

void run() {
    const Config &c = gCfg;
    // Audio priority (ANDROID_PRIORITY_URGENT_AUDIO); apps may set it for their own threads.
    setpriority(PRIO_PROCESS, static_cast<id_t>(gettid()), -19);
    gPriority.store(getpriority(PRIO_PROCESS, static_cast<id_t>(gettid())));
    std::vector<usbdevfs_urb *> outs, fbs, ins;
    double acc = 0.0;
    long long frame = 0, inFrame = 0;
    int inFlight = 0;
    auto fail = [&](const char *what) {
        int e = errno;
        gLastErrno.store(e);
        char buf[160];
        snprintf(buf, sizeof buf, "%s: %s (errno %d)", what, strerror(e), e);
        setError(buf);
        if (e == ENODEV) gDisconnectedAt.store(nowMs());
        LOG("%s", buf);
    };

    for (int i = 0; i < kUrbs; i++) outs.push_back(allocUrb(kPacketsPerUrb, c.maxPacket * kPacketsPerUrb));
    if (c.epFb) for (int i = 0; i < kFbUrbs; i++) fbs.push_back(allocUrb(1, c.fbMaxPacket));
    if (c.epIn) for (int i = 0; i < c.inUrbs; i++) ins.push_back(allocUrb(c.inPackets, c.inMaxPacket * c.inPackets));

    // Out and in are submitted back to back, so frame 0 of both lies in the same millisecond -
    // the loopback round trip is then simply the frame distance between sending and arriving.
    bool ok = true;
    for (auto *u : fbs) {
        prepareIso(u, c.epFb, 1, c.fbMaxPacket);
        if (ioctl(c.fd, USBDEVFS_SUBMITURB, u) < 0) { fail("submit feedback"); ok = false; break; }
        inFlight++;
    }
    for (size_t i = 0; ok && i < outs.size(); i++) {
        fillOut(outs[i], acc, frame);
        if (ioctl(c.fd, USBDEVFS_SUBMITURB, outs[i]) < 0) { fail("submit out"); ok = false; break; }
        inFlight++;
        if (i < ins.size()) {
            prepareIso(ins[i], c.epIn, c.inPackets, c.inMaxPacket);
            if (ioctl(c.fd, USBDEVFS_SUBMITURB, ins[i]) < 0) { fail("submit in"); ok = false; break; }
            inFlight++;
        }
    }
    for (size_t i = outs.size(); ok && i < ins.size(); i++) {
        prepareIso(ins[i], c.epIn, c.inPackets, c.inMaxPacket);
        if (ioctl(c.fd, USBDEVFS_SUBMITURB, ins[i]) < 0) { fail("submit in"); ok = false; break; }
        inFlight++;
    }
    gStartedAt.store(nowMs());
    double lastReap = nowSec();

    while (ok && !gStop.load()) {
        usbdevfs_urb *urb = nullptr;
        if (ioctl(c.fd, USBDEVFS_REAPURB, &urb) < 0) {
            if (errno == EINTR) continue;
            fail("reap");
            break;
        }
        inFlight--;
        {
            const double t = nowSec();
            const double gap = (t - lastReap) * 1000.0;
            lastReap = t;
            if (gap > gMaxReapGapMs.load()) gMaxReapGapMs.store(gap);
            if (gap > 4.0) gReapGapsOver4ms.fetch_add(1);
        }
        const auto ep = urb->endpoint;
        if (c.epFb && ep == static_cast<unsigned char>(c.epFb)) {
            if (urb->status == 0) parseFb(urb);
            prepareIso(urb, c.epFb, 1, c.fbMaxPacket);
        } else if (c.epIn && ep == static_cast<unsigned char>(c.epIn)) {
            gInUrbs.fetch_add(1);
            if (urb->status == 0 || urb->status == -EXDEV) readIn(urb, inFrame);
            else { gInUrbErrors.fetch_add(1); gInLastStatus.store(urb->status); }
            gWinIn = std::fmin(gWinIn, nowSec() - inFrame / (gFbFrames.load() * (c.highSpeed ? 8000.0 : 1000.0)));
            prepareIso(urb, c.epIn, c.inPackets, c.inMaxPacket);
        } else {
            gUrbs.fetch_add(1);
            for (int i = 0; i < urb->number_of_packets; i++) {
                if (urb->iso_frame_desc[i].status != 0) gPacketErrors.fetch_add(1);
                gFrames.fetch_add(urb->iso_frame_desc[i].actual_length / (c.channels * c.subslot));
            }
            gPackets.fetch_add(urb->number_of_packets);
            if (urb->status != 0 && urb->status != -EXDEV) {
                errno = -urb->status;
                fail("out urb status");
                if (errno == ENODEV || errno == ESHUTDOWN || errno == EPROTO) break;
            }
            gWinOut = std::fmin(gWinOut, nowSec() - gFrames.load() / (gFbFrames.load() * (c.highSpeed ? 8000.0 : 1000.0)));
            fillOut(urb, acc, frame);
        }
        const double t = nowSec();
        if (t - gWinStart > 1.0) {
            if (gWinOut < 1e17) gOffOut.store(gWinOut);
            if (gWinIn < 1e17) gOffIn.store(gWinIn);
            gWinOut = gWinIn = 1e18;
            gWinStart = t;
        }
        if (gStop.load()) break;
        if (ioctl(c.fd, USBDEVFS_SUBMITURB, urb) < 0) {
            char what[96];
            snprintf(what, sizeof what, "resubmit ep 0x%02x packets %d length %d", urb->endpoint, urb->number_of_packets, urb->buffer_length);
            fail(what);
            break;
        }
        inFlight++;
    }

    // Cancel what is still queued and collect it before freeing the buffers.
    for (auto *u : outs) ioctl(c.fd, USBDEVFS_DISCARDURB, u);
    for (auto *u : fbs) ioctl(c.fd, USBDEVFS_DISCARDURB, u);
    for (auto *u : ins) ioctl(c.fd, USBDEVFS_DISCARDURB, u);
    for (int tries = 0; inFlight > 0 && tries < 200; tries++) {
        usbdevfs_urb *urb = nullptr;
        if (ioctl(c.fd, USBDEVFS_REAPURBNDELAY, &urb) == 0) { inFlight--; continue; }
        if (errno == ENODEV) break;
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
    if (inFlight == 0) {
        for (auto *u : outs) freeUrb(u);
        for (auto *u : fbs) freeUrb(u);
        for (auto *u : ins) freeUrb(u);
    }  // else leak on purpose: the kernel may still write into them
    gRunning.store(false);
    LOG("usb audio thread ended: urbs %lld, packet errors %lld, in frames %lld", gUrbs.load(), gPacketErrors.load(), gInFrames.load());
}

void stopThread() {
    gStop.store(true);
    if (gThread.joinable()) gThread.join();
}
}  // namespace

extern "C" JNIEXPORT jstring JNICALL
Java_de_stageboard_app_NativeAudioTestPlugin_usbStart(JNIEnv *env, jclass, jint fd, jint epOut, jint maxPacket, jint epFb,
                                                     jint fbMaxPacket, jint channels, jint subslot, jint rate, jint playMask,
                                                     jint clickMask, jint epIn, jint inMaxPacket, jint inChannels,
                                                     jint inSubslot, jint inPackets, jint inUrbs, jdouble freq, jdouble gainDb, jdouble clickGainDb,
                                                     jboolean highSpeed) {
    stopThread();
    gCfg = Config{fd, epOut, maxPacket, epFb, fbMaxPacket, channels, subslot, rate, playMask, clickMask,
                  epIn, inMaxPacket, inChannels, inSubslot, inPackets, inUrbs, freq, std::pow(10.0, gainDb / 20.0),
                  std::pow(10.0, clickGainDb / 20.0), static_cast<bool>(highSpeed)};
    gStop.store(false);
    gFrames = 0; gPackets = 0; gUrbs = 0; gPacketErrors = 0; gFbCount = 0; gFbRaw = 0;
    gInFrames = 0; gInPacketErrors = 0; gInEmptyPackets = 0; gClicksSent = 0;
    gStartedAt = 0; gDisconnectedAt = 0; gLastErrno = 0; gOffOut = 0; gOffIn = 0;
    gInUrbs = 0; gInUrbErrors = 0; gInLastStatus = 0; gMaxReapGapMs = 0; gReapGapsOver4ms = 0;
    gWinOut = gWinIn = 1e18; gWinStart = 0;
    {
        std::lock_guard<std::mutex> lock(gMutex);
        gError.clear();
        for (auto &s : gIn) s = InStats{};
        gLatenciesMs.clear();
        gClicksDetected = 0;
        gLastDetectFrame = -1000000;
    }
    gFbFrames.store(rate / (highSpeed ? 8000.0 : 1000.0));
    gRunning.store(true);
    gThread = std::thread(run);
    char buf[200];
    snprintf(buf, sizeof buf, R"({"started":true,"t":%lld})", nowMs());
    return env->NewStringUTF(buf);
}

extern "C" JNIEXPORT jstring JNICALL
Java_de_stageboard_app_NativeAudioTestPlugin_usbStatus(JNIEnv *env, jclass) {
    std::string inputs = "[", lat = "[", error;
    long long detected;
    {
        std::lock_guard<std::mutex> lock(gMutex);
        error = gError;
        detected = gClicksDetected;
        for (int ch = 0; ch < gCfg.inChannels && ch < kMaxIn; ch++) {
            char b[120];
            snprintf(b, sizeof b, R"(%s{"rmsDb":%.1f,"peakDb":%.1f,"freq":%.1f})", ch ? "," : "", gIn[ch].rmsDb, gIn[ch].peakDb, gIn[ch].freq);
            inputs += b;
        }
        for (size_t i = 0; i < gLatenciesMs.size(); i++) {
            char b[24];
            snprintf(b, sizeof b, "%s%.2f", i ? "," : "", gLatenciesMs[i]);
            lat += b;
        }
    }
    inputs += "]";
    lat += "]";
    char buf[1400];
    snprintf(buf, sizeof buf,
             R"({"running":%s,"frames":%lld,"packets":%lld,"urbs":%lld,"packetErrors":%lld,"feedbackCount":%lld,)"
             R"("feedbackRaw":%u,"feedbackFramesPerPacket":%.5f,"rateEstimate":%.1f,)"
             R"("inFrames":%lld,"inPacketErrors":%lld,"inEmptyPackets":%lld,"inputs":%s,)"
             R"("clicksSent":%lld,"clicksDetected":%lld,"roundTripMs":%s,"inUrbs":%lld,"inUrbErrors":%lld,"inLastStatus":%d,)"
             R"("maxReapGapMs":%.2f,"reapGapsOver4ms":%lld,"threadPriority":%d,)"
             R"("error":"%s","lastErrno":%d,"startedAt":%lld,"disconnectedAt":%lld,"now":%lld})",
             gRunning.load() ? "true" : "false", gFrames.load(), gPackets.load(), gUrbs.load(), gPacketErrors.load(),
             gFbCount.load(), gFbRaw.load(), gFbFrames.load(), gFbFrames.load() * (gCfg.highSpeed ? 8000.0 : 1000.0),
             gInFrames.load(), gInPacketErrors.load(), gInEmptyPackets.load(), inputs.c_str(),
             gClicksSent.load(), detected, lat.c_str(), gInUrbs.load(), gInUrbErrors.load(), gInLastStatus.load(),
             gMaxReapGapMs.load(), gReapGapsOver4ms.load(), gPriority.load(),
             error.c_str(), gLastErrno.load(), gStartedAt.load(), gDisconnectedAt.load(), nowMs());
    return env->NewStringUTF(buf);
}

extern "C" JNIEXPORT void JNICALL
Java_de_stageboard_app_NativeAudioTestPlugin_usbStop(JNIEnv *, jclass) {
    stopThread();
}

// Hands an interface back to the kernel driver (snd-usb-audio) after we released it.
extern "C" JNIEXPORT jint JNICALL
Java_de_stageboard_app_NativeAudioTestPlugin_usbReattachKernelDriver(JNIEnv *, jclass, jint fd, jint ifno) {
    usbdevfs_ioctl cmd{};
    cmd.ifno = ifno;
    cmd.ioctl_code = USBDEVFS_CONNECT;
    cmd.data = nullptr;
    return ioctl(fd, USBDEVFS_IOCTL, &cmd) < 0 ? -errno : 0;
}

// Port reset: the device re-enumerates with the same address; clears what the host controller
// still holds for its endpoints.
extern "C" JNIEXPORT jint JNICALL
Java_de_stageboard_app_NativeAudioTestPlugin_usbResetDevice(JNIEnv *, jclass, jint fd) {
    return ioctl(fd, USBDEVFS_RESET, nullptr) < 0 ? -errno : 0;
}
