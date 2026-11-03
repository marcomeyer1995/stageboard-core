// Spike for #481 step 2 (not for production): a multichannel AAudio output stream on one fixed
// device. Unlike an AudioTrack, a stream opened on a specific device is *disconnected* when that
// device goes away (AAUDIO_ERROR_DISCONNECTED) instead of being rerouted to the speaker - the
// behaviour "safe stop" needs. Measures what the stream really got (channels, rate, sharing and
// performance mode, burst, latency) and when a disconnect arrived.
#include <jni.h>
#include <aaudio/AAudio.h>
#include <android/log.h>
#include <atomic>
#include <cmath>
#include <cstdio>
#include <ctime>
#include <string>

#define LOG(...) __android_log_print(ANDROID_LOG_INFO, "NativeAudioTest", __VA_ARGS__)

namespace {
AAudioStream *gStream = nullptr;
std::atomic<int> gChannels{0};
std::atomic<int> gPlayMask{0};
std::atomic<float> gGain{0.f};
std::atomic<double> gFreq{440.0};
std::atomic<long long> gFrames{0};
std::atomic<long long> gCallbacks{0};
std::atomic<long long> gDisconnectedAt{0};
std::atomic<int> gError{0};
std::atomic<long long> gStartedAt{0};
int gRate = 48000;

long long nowMs() {
    timespec ts{};
    clock_gettime(CLOCK_BOOTTIME, &ts);  // same clock as SystemClock.elapsedRealtime()
    return ts.tv_sec * 1000LL + ts.tv_nsec / 1000000;
}

aaudio_data_callback_result_t onData(AAudioStream *, void *, void *audioData, int32_t numFrames) {
    auto *out = static_cast<float *>(audioData);
    const int ch = gChannels.load();
    const int mask = gPlayMask.load();
    const float gain = gGain.load();
    const double freq = gFreq.load();
    long long n0 = gFrames.load();
    for (int i = 0; i < numFrames; i++) {
        int k = 0;
        for (int c = 0; c < ch; c++) {
            float v = 0.f;
            if (mask & (1 << c)) {
                v = gain * static_cast<float>(std::sin(2.0 * M_PI * (freq + 220.0 * k) * static_cast<double>(n0 + i) / gRate));
                k++;
            }
            out[i * ch + c] = v;
        }
    }
    gFrames.fetch_add(numFrames);
    gCallbacks.fetch_add(1);
    return AAUDIO_CALLBACK_RESULT_CONTINUE;
}

void onError(AAudioStream *, void *, aaudio_result_t error) {
    // Called on a separate thread; only record it - closing happens from status/stop.
    gError.store(error);
    if (error == AAUDIO_ERROR_DISCONNECTED) gDisconnectedAt.store(nowMs());
    LOG("stream error %d (%s)", error, AAudio_convertResultToText(error));
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

const char *sharing(aaudio_sharing_mode_t m) { return m == AAUDIO_SHARING_MODE_EXCLUSIVE ? "exclusive" : "shared"; }
const char *perf(aaudio_performance_mode_t m) {
    return m == AAUDIO_PERFORMANCE_MODE_LOW_LATENCY ? "low-latency" : m == AAUDIO_PERFORMANCE_MODE_POWER_SAVING ? "power-saving" : "none";
}

void closeStream() {
    if (gStream) {
        AAudioStream_requestStop(gStream);
        AAudioStream_close(gStream);
        gStream = nullptr;
    }
}
}  // namespace

extern "C" JNIEXPORT jstring JNICALL
Java_de_stageboard_app_NativeAudioTestPlugin_aaudioStart(JNIEnv *env, jclass, jint deviceId, jint channels, jint playMask,
                                                         jdouble freq, jdouble gainDb, jboolean exclusive) {
    closeStream();
    gChannels = channels;
    gPlayMask = playMask;
    gFreq = freq;
    gGain = static_cast<float>(std::pow(10.0, gainDb / 20.0));
    gFrames = 0;
    gCallbacks = 0;
    gDisconnectedAt = 0;
    gError = 0;

    AAudioStreamBuilder *b = nullptr;
    aaudio_result_t r = AAudio_createStreamBuilder(&b);
    if (r != AAUDIO_OK) return env->NewStringUTF(json("{\"error\":\"createStreamBuilder %d\"}", r).c_str());
    AAudioStreamBuilder_setDeviceId(b, deviceId);
    AAudioStreamBuilder_setDirection(b, AAUDIO_DIRECTION_OUTPUT);
    AAudioStreamBuilder_setChannelCount(b, channels);
    AAudioStreamBuilder_setFormat(b, AAUDIO_FORMAT_PCM_FLOAT);
    AAudioStreamBuilder_setSampleRate(b, 48000);
    AAudioStreamBuilder_setPerformanceMode(b, AAUDIO_PERFORMANCE_MODE_LOW_LATENCY);
    AAudioStreamBuilder_setSharingMode(b, exclusive ? AAUDIO_SHARING_MODE_EXCLUSIVE : AAUDIO_SHARING_MODE_SHARED);
    AAudioStreamBuilder_setDataCallback(b, onData, nullptr);
    AAudioStreamBuilder_setErrorCallback(b, onError, nullptr);
    r = AAudioStreamBuilder_openStream(b, &gStream);
    AAudioStreamBuilder_delete(b);
    if (r != AAUDIO_OK) {
        gStream = nullptr;
        return env->NewStringUTF(json("{\"error\":\"openStream %d %s\"}", r, AAudio_convertResultToText(r)).c_str());
    }
    gRate = AAudioStream_getSampleRate(gStream);
    gChannels = AAudioStream_getChannelCount(gStream);
    r = AAudioStream_requestStart(gStream);
    gStartedAt = nowMs();
    return env->NewStringUTF(json(
            "{\"started\":%s,\"startResult\":\"%s\",\"deviceId\":%d,\"channels\":%d,\"sampleRate\":%d,\"sharing\":\"%s\",\"performance\":\"%s\","
            "\"framesPerBurst\":%d,\"bufferFrames\":%d,\"capacityFrames\":%d,\"t\":%lld}",
            r == AAUDIO_OK ? "true" : "false", AAudio_convertResultToText(r), AAudioStream_getDeviceId(gStream), AAudioStream_getChannelCount(gStream),
            gRate, sharing(AAudioStream_getSharingMode(gStream)), perf(AAudioStream_getPerformanceMode(gStream)),
            AAudioStream_getFramesPerBurst(gStream), AAudioStream_getBufferSizeInFrames(gStream), AAudioStream_getBufferCapacityInFrames(gStream),
            static_cast<long long>(gStartedAt)).c_str());
}

extern "C" JNIEXPORT jstring JNICALL
Java_de_stageboard_app_NativeAudioTestPlugin_aaudioStatus(JNIEnv *env, jclass) {
    if (!gStream) return env->NewStringUTF("{\"open\":false}");
    aaudio_stream_state_t state = AAudioStream_getState(gStream);
    int64_t framePos = 0, timeNs = 0;
    double latencyMs = -1;
    if (AAudioStream_getTimestamp(gStream, CLOCK_MONOTONIC, &framePos, &timeNs) == AAUDIO_OK) {
        timespec ts{};
        clock_gettime(CLOCK_MONOTONIC, &ts);
        int64_t nowNs = ts.tv_sec * 1000000000LL + ts.tv_nsec;
        int64_t presentedNow = framePos + (nowNs - timeNs) * gRate / 1000000000LL;
        latencyMs = (AAudioStream_getFramesWritten(gStream) - presentedNow) * 1000.0 / gRate;
    }
    return env->NewStringUTF(json(
            "{\"open\":true,\"state\":\"%s\",\"framesRendered\":%lld,\"callbacks\":%lld,\"xruns\":%d,\"latencyMs\":%.1f,"
            "\"error\":%d,\"errorText\":\"%s\",\"disconnectedAt\":%lld,\"startedAt\":%lld,\"now\":%lld}",
            AAudio_convertStreamStateToText(state), static_cast<long long>(gFrames), static_cast<long long>(gCallbacks),
            AAudioStream_getXRunCount(gStream), latencyMs, gError.load(), gError.load() ? AAudio_convertResultToText(gError.load()) : "",
            static_cast<long long>(gDisconnectedAt), static_cast<long long>(gStartedAt), nowMs()).c_str());
}

extern "C" JNIEXPORT void JNICALL
Java_de_stageboard_app_NativeAudioTestPlugin_aaudioStop(JNIEnv *, jclass) {
    closeStream();
}
