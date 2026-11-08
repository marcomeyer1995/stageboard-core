// Click Synthesizer tests (docs/30 §8)
// Compile: g++ -std=c++17 -I. click_synth_test.cpp click_synth.cpp -o click_synth_test && ./click_synth_test

#include "click_synth.h"
#include <cassert>
#include <cmath>
#include <iostream>
#include <vector>

void test_schedule_click() {
    ClickSynthesizer synth(48000);
    synth.scheduleClick(48000, false, 1.0f); // 1 second, normal click
    assert(synth.getPendingCount() == 1);
    std::cout << "✓ scheduleClick adds a click\n";
}

void test_click_frequency() {
    ClickSynthesizer synth(48000);
    synth.scheduleClick(0, false, 1.0f); // normal: 1000 Hz
    synth.scheduleClick(48000, true, 1.0f); // downbeat: 1500 Hz
    
    // Render 100 frames and check frequency
    std::vector<float> buffer(100, 0.0f);
    synth.render(buffer.data(), 100);
    
    // First click should be 1000 Hz (period = 48 samples)
    // Second click should be 1500 Hz (period = 32 samples)
    // We just verify it renders without crashing for now
    std::cout << "✓ click_frequency renders without crash\n";
}

void test_click_duration() {
    ClickSynthesizer synth(48000);
    synth.scheduleClick(0, false, 1.0f);
    
    // Click duration: 0.03s = 1440 frames @ 48kHz
    // After 1500 frames, the click should be done
    std::vector<float> buffer(2000, 0.0f);
    synth.render(buffer.data(), 2000);
    
    // Check that frames after 1440 are silent
    bool silent_after = true;
    for (int i = 1500; i < 2000; i++) {
        if (std::abs(buffer[i]) > 0.001f) {
            silent_after = false;
            break;
        }
    }
    assert(silent_after);
    std::cout << "✓ click_duration: click ends after ~1440 frames\n";
}

void test_gain() {
    ClickSynthesizer synth(48000);
    synth.scheduleClick(0, false, 0.5f); // half gain
    
    std::vector<float> buffer(100, 0.0f);
    synth.render(buffer.data(), 100);
    
    // Find peak
    float peak = 0.0f;
    for (float sample : buffer) {
        peak = std::max(peak, std::abs(sample));
    }
    
    // Peak should be around 0.5 * 0.35 (gain * initial amplitude)
    assert(peak > 0.1f && peak < 0.3f);
    std::cout << "✓ gain: peak amplitude matches gain setting\n";
}

void test_multiple_clicks() {
    ClickSynthesizer synth(48000);
    synth.scheduleClick(0, false, 1.0f);
    synth.scheduleClick(4800, false, 1.0f); // 100ms later
    synth.scheduleClick(9600, true, 1.0f); // 200ms later (downbeat)
    
    assert(synth.getPendingCount() == 3);
    
    std::vector<float> buffer(48000, 0.0f); // 1 second
    synth.render(buffer.data(), 48000);
    
    assert(synth.getPendingCount() == 0); // all clicks consumed
    std::cout << "✓ multiple_clicks: all clicks rendered\n";
}

void test_clear() {
    ClickSynthesizer synth(48000);
    synth.scheduleClick(0, false, 1.0f);
    synth.scheduleClick(48000, false, 1.0f);
    
    assert(synth.getPendingCount() == 2);
    synth.clear();
    assert(synth.getPendingCount() == 0);
    std::cout << "✓ clear: removes all pending clicks\n";
}

int main() {
    std::cout << "Running Click Synthesizer tests...\n\n";
    
    test_schedule_click();
    test_click_frequency();
    test_click_duration();
    test_gain();
    test_multiple_clicks();
    test_clear();
    
    std::cout << "\n✅ All tests passed!\n";
    return 0;
}
