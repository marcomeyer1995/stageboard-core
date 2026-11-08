// Playback Plan Queue tests (docs/30 §8)
// Compile: g++ -std=c++17 -I. playback_plan_test.cpp playback_plan.cpp click_synth.cpp -o playback_plan_test && ./playback_plan_test

#include "playback_plan.h"
#include "click_synth.h"
#include <cassert>
#include <cmath>
#include <iostream>
#include <string>

void test_add_click_plan() {
    ClickSynthesizer clickSynth(48000);
    PlaybackPlanQueue queue(clickSynth);
    
    queue.addPlan(1000, "click", R"({"isDownbeat":false,"gain":1.0})");
    assert(queue.getPendingCount() == 1);
    std::cout << "✓ addPlan adds a click plan\n";
}

void test_add_announcement_plan() {
    ClickSynthesizer clickSynth(48000);
    PlaybackPlanQueue queue(clickSynth);
    
    queue.addPlan(5000, "announcement", R"({"clipId":"intro","gain":0.8})");
    assert(queue.getPendingCount() == 1);
    std::cout << "✓ addPlan adds an announcement plan\n";
}

void test_band_time_to_frame() {
    ClickSynthesizer clickSynth(48000);
    PlaybackPlanQueue queue(clickSynth);
    
    // Band time 1000ms at 48kHz = 48000 frames
    int64_t frame = queue.bandTimeToFrame(1000);
    assert(frame == 48000);
    std::cout << "✓ bandTimeToFrame converts ms to frames correctly\n";
}

void test_process_click() {
    ClickSynthesizer clickSynth(48000);
    PlaybackPlanQueue queue(clickSynth);
    
    // Add click at 100ms (4800 frames)
    queue.addPlan(100, "click", R"({"isDownbeat":true,"gain":1.0})");
    
    // Process at frame 0 (click is in the future)
    queue.process(0);
    assert(queue.getPendingCount() == 1); // still in queue
    assert(clickSynth.getPendingCount() == 0); // not yet scheduled
    
    // Process at frame 4800 (click is due)
    queue.process(4800);
    assert(queue.getPendingCount() == 0); // removed from queue
    assert(clickSynth.getPendingCount() == 1); // scheduled to synth
    
    // Render to verify the click is actually there
    std::vector<float> buffer(9600, 0.0f); // 200ms
    clickSynth.render(buffer.data(), 9600);
    
    // Check that there's audio around frame 4800 (the click)
    bool hasAudio = false;
    for (int i = 4700; i < 4900; i++) {
        if (std::abs(buffer[i]) > 0.01f) {
            hasAudio = true;
            break;
        }
    }
    assert(hasAudio);
    
    std::cout << "✓ process schedules click at correct frame\n";
}

void test_process_past_plan() {
    ClickSynthesizer clickSynth(48000);
    PlaybackPlanQueue queue(clickSynth);
    
    // Add click at 100ms
    queue.addPlan(100, "click", R"({"isDownbeat":false,"gain":1.0})");
    
    // Process at frame 9600 (200ms, past the click)
    queue.process(9600);
    assert(queue.getPendingCount() == 0); // discarded
    assert(clickSynth.getPendingCount() == 0); // not scheduled (too late)
    std::cout << "✓ process discards plans in the past\n";
}

void test_clear() {
    ClickSynthesizer clickSynth(48000);
    PlaybackPlanQueue queue(clickSynth);
    
    queue.addPlan(1000, "click", R"({"isDownbeat":false,"gain":1.0})");
    queue.addPlan(2000, "click", R"({"isDownbeat":true,"gain":1.0})");
    
    assert(queue.getPendingCount() == 2);
    queue.clear();
    assert(queue.getPendingCount() == 0);
    std::cout << "✓ clear removes all pending plans\n";
}

void test_multiple_plans() {
    ClickSynthesizer clickSynth(48000);
    PlaybackPlanQueue queue(clickSynth);
    
    queue.addPlan(100, "click", R"({"isDownbeat":false,"gain":1.0})");
    queue.addPlan(200, "click", R"({"isDownbeat":true,"gain":1.0})");
    queue.addPlan(300, "announcement", R"({"clipId":"verse","gain":0.8})");
    
    assert(queue.getPendingCount() == 3);
    
    // Process at 150ms (7200 frames): first click due
    queue.process(7200);
    assert(queue.getPendingCount() == 2);
    assert(clickSynth.getPendingCount() == 1);
    
    // Process at 250ms (12000 frames): second click due
    queue.process(12000);
    assert(queue.getPendingCount() == 1); // announcement still pending (not implemented)
    assert(clickSynth.getPendingCount() == 2); // both clicks scheduled
    
    // Render to consume both clicks
    std::vector<float> buffer(14400, 0.0f); // 300ms
    clickSynth.render(buffer.data(), 14400);
    
    // Verify both clicks are in the buffer
    bool hasFirstClick = false;
    bool hasSecondClick = false;
    for (int i = 4700; i < 4900; i++) {
        if (std::abs(buffer[i]) > 0.01f) {
            hasFirstClick = true;
            break;
        }
    }
    for (int i = 9500; i < 9700; i++) {
        if (std::abs(buffer[i]) > 0.01f) {
            hasSecondClick = true;
            break;
        }
    }
    assert(hasFirstClick);
    assert(hasSecondClick);
    
    std::cout << "✓ multiple_plans: processes in order\n";
}

int main() {
    std::cout << "Running Playback Plan Queue tests...\n\n";
    
    test_add_click_plan();
    test_add_announcement_plan();
    test_band_time_to_frame();
    test_process_click();
    test_process_past_plan();
    test_clear();
    test_multiple_plans();
    
    std::cout << "\n✅ All tests passed!\n";
    return 0;
}
