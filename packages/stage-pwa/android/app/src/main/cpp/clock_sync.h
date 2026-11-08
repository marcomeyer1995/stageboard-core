#pragma once

#include <cstdint>
#include <vector>

/**
 * Native Engine N1 (docs/30 §8): maintains clock sync between the device's local clock and the
 * band's master clock while the WebView is locked.
 *
 * The WebView's clock sync (clockSync.ts) runs NTP-style handshakes with the Stage-Server to
 * estimate the offset between local time and band time. When the WebView is locked, it stops,
 * but the native engine needs to keep playing clicks on band time. This class maintains the
 * estimate using the last known offset and drift rate.
 *
 * Drift: ~0.3 ms/min (measured 2026-11-05), so for a 60s lock the estimate stays within ~20ms.
 * The WebView sends sync samples periodically (every 2s) while it's running; the native side
 * uses them to track drift and apply corrections.
 *
 * Why: when the WebView is locked, the native engine plays clicks on its own. Without clock sync,
 * the clicks would drift from the band's timeline and be out of sync with other devices.
 */
class NativeClockSync {
public:
    NativeClockSync();

    /**
     * Adds a sync sample from the WebView.
     * @param localTimeMs Local time (performance.now() or Date.now()) in ms.
     * @param bandTimeMs Band time (server time) in ms.
     */
    void addSample(int64_t localTimeMs, int64_t bandTimeMs);

    /**
     * Estimates band time for a given local time.
     * Uses linear regression: bandTime = offset + driftRate * localTime.
     * Returns localTime if fewer than 2 samples (no sync yet).
     */
    int64_t estimateBandTime(int64_t localTimeMs) const;

    /**
     * Returns the drift rate (band time advance per local time unit).
     * 1.0 = no drift, >1.0 = band time advances faster, <1.0 = slower.
     * Typical: ~1.0003 (0.03% drift, ~0.3 ms/min).
     */
    double getDriftRate() const;

    /** Removes all samples (reset). */
    void clear();

    /** Test-only: number of samples. */
    int getSampleCount() const;

private:
    struct Sample {
        int64_t localTimeMs;
        int64_t bandTimeMs;
    };

    std::vector<Sample> samples;

    // Linear regression: bandTime = offset + driftRate * localTime
    double offset = 0.0;
    double driftRate = 1.0;
    bool needsRecalculation = true;

    void recalculate();
};
