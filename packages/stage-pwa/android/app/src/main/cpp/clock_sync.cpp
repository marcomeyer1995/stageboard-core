#include "clock_sync.h"
#include <algorithm>
#include <cmath>

NativeClockSync::NativeClockSync() {}

void NativeClockSync::addSample(int64_t localTimeMs, int64_t bandTimeMs) {
    samples.push_back({localTimeMs, bandTimeMs});
    needsRecalculation = true;
    
    // Keep only the last 60 samples (2 minutes at 2s interval)
    // Older samples are less relevant for drift estimation
    if (samples.size() > 60) {
        samples.erase(samples.begin());
    }
}

int64_t NativeClockSync::estimateBandTime(int64_t localTimeMs) const {
    if (samples.size() < 2) {
        // Not enough samples yet - return local time (no sync)
        return localTimeMs;
    }
    
    // Recalculate if needed (const_cast to allow lazy evaluation)
    if (needsRecalculation) {
        const_cast<NativeClockSync*>(this)->recalculate();
    }
    
    // Apply linear regression: bandTime = offset + driftRate * localTime
    return static_cast<int64_t>(offset + driftRate * localTimeMs);
}

double NativeClockSync::getDriftRate() const {
    if (needsRecalculation && samples.size() >= 2) {
        const_cast<NativeClockSync*>(this)->recalculate();
    }
    return driftRate;
}

void NativeClockSync::clear() {
    samples.clear();
    offset = 0.0;
    driftRate = 1.0;
    needsRecalculation = true;
}

int NativeClockSync::getSampleCount() const {
    return static_cast<int>(samples.size());
}

void NativeClockSync::recalculate() {
    if (!needsRecalculation || samples.size() < 2) {
        return;
    }
    
    // Linear regression: bandTime = offset + driftRate * localTime
    // Using least squares: driftRate = Cov(local, band) / Var(local)
    //                      offset = Mean(band) - driftRate * Mean(local)
    
    const int n = static_cast<int>(samples.size());
    
    // Calculate means
    double sumLocal = 0.0, sumBand = 0.0;
    for (const auto& s : samples) {
        sumLocal += s.localTimeMs;
        sumBand += s.bandTimeMs;
    }
    const double meanLocal = sumLocal / n;
    const double meanBand = sumBand / n;
    
    // Calculate covariance and variance
    double cov = 0.0, var = 0.0;
    for (const auto& s : samples) {
        const double dLocal = s.localTimeMs - meanLocal;
        const double dBand = s.bandTimeMs - meanBand;
        cov += dLocal * dBand;
        var += dLocal * dLocal;
    }
    
    // Drift rate (slope)
    if (var > 0) {
        driftRate = cov / var;
    } else {
        driftRate = 1.0; // No variance in local time - assume no drift
    }
    
    // Clamp drift rate to reasonable range (0.99 - 1.01, i.e., ±1% drift)
    // Beyond that is likely a measurement error or clock jump
    driftRate = std::max(0.99, std::min(1.01, driftRate));
    
    // Offset (intercept)
    offset = meanBand - driftRate * meanLocal;
    
    needsRecalculation = false;
}
