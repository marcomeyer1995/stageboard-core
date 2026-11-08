// Clock Sync tests (docs/30 §8)
// Compile: g++ -std=c++17 -I. clock_sync_test.cpp clock_sync.cpp -o clock_sync_test && ./clock_sync_test

#include "clock_sync.h"
#include <cassert>
#include <cmath>
#include <iostream>

void test_add_sample() {
    NativeClockSync sync;
    sync.addSample(1000, 2000);
    assert(sync.getSampleCount() == 1);
    std::cout << "✓ addSample adds a sync sample\n";
}

void test_estimate_band_time() {
    NativeClockSync sync;
    
    // Add samples: local time → band time
    sync.addSample(0, 0);
    sync.addSample(1000, 1000);
    sync.addSample(2000, 2000);
    
    // Estimate: local 1500 → band ~1500 (no drift)
    int64_t band = sync.estimateBandTime(1500);
    assert(std::abs(band - 1500) < 10); // within 10ms
    std::cout << "✓ estimateBandTime estimates correctly with no drift\n";
}

void test_drift_rate() {
    NativeClockSync sync;
    
    // Simulate drift: band time advances 1.003x faster than local (0.3% = 0.3ms/s)
    sync.addSample(0, 0);
    sync.addSample(10000, 10030); // 30ms drift over 10s = 0.3% = drift rate 1.003
    
    double drift = sync.getDriftRate();
    assert(std::abs(drift - 1.003) < 0.001); // drift rate is 1.003 (band advances 1.003x faster)
    std::cout << "✓ getDriftRate calculates drift correctly\n";
}

void test_estimate_with_drift() {
    NativeClockSync sync;
    
    // Simulate drift: band time advances 1.003x faster
    sync.addSample(0, 0);
    sync.addSample(10000, 10030);
    
    // Estimate at local 5000: should be ~5015 (half of 30ms drift)
    int64_t band = sync.estimateBandTime(5000);
    assert(std::abs(band - 5015) < 5); // within 5ms
    std::cout << "✓ estimateBandTime compensates for drift\n";
}

void test_clear() {
    NativeClockSync sync;
    sync.addSample(0, 0);
    sync.addSample(1000, 1000);
    
    assert(sync.getSampleCount() == 2);
    sync.clear();
    assert(sync.getSampleCount() == 0);
    std::cout << "✓ clear removes all samples\n";
}

void test_robust_to_outliers() {
    NativeClockSync sync;
    
    // Add samples with an outlier
    sync.addSample(0, 0);
    sync.addSample(1000, 1000);
    sync.addSample(2000, 2000);
    sync.addSample(3000, 3100); // outlier: 100ms jump
    
    // Linear regression is affected by outliers, but the estimate should still be reasonable
    // (within 50ms of expected). For robust outlier rejection, we'd need Theil-Sen (like nativeOutput.ts).
    // For N1, we accept this limitation - the WebView sends samples every 2s, so outliers are rare.
    int64_t band = sync.estimateBandTime(1500);
    assert(std::abs(band - 1500) < 50); // within 50ms (outlier affects the estimate)
    std::cout << "✓ estimateBandTime handles outliers (affected but not broken)\n";
}

void test_min_samples() {
    NativeClockSync sync;
    
    // With 0-1 samples, estimate should return local time (no sync yet)
    assert(sync.estimateBandTime(1000) == 1000);
    
    sync.addSample(0, 0);
    assert(sync.estimateBandTime(1000) == 1000);
    
    // With 2+ samples, estimate uses sync
    sync.addSample(1000, 1005);
    int64_t band = sync.estimateBandTime(500);
    assert(band != 500); // should be adjusted
    std::cout << "✓ estimateBandTime requires min 2 samples\n";
}

int main() {
    std::cout << "Running Clock Sync tests...\n\n";
    
    test_add_sample();
    test_estimate_band_time();
    test_drift_rate();
    test_estimate_with_drift();
    test_clear();
    test_robust_to_outliers();
    test_min_samples();
    
    std::cout << "\n✅ All tests passed!\n";
    return 0;
}
