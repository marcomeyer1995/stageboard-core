// Announcement Player tests (docs/30 §8)
// Compile: g++ -std=c++17 -I. announcement_player_test.cpp announcement_player.cpp -o announcement_player_test && ./announcement_player_test

#include "announcement_player.h"
#include <cassert>
#include <cmath>
#include <iostream>
#include <vector>

void test_load_clip() {
    AnnouncementPlayer player(48000);
    
    std::vector<float> pcm(48000, 0.5f); // 1 second of 0.5 amplitude
    player.loadClip("intro", pcm);
    
    assert(player.getClipCount() == 1);
    std::cout << "✓ loadClip loads a clip\n";
}

void test_schedule_clip() {
    AnnouncementPlayer player(48000);
    
    std::vector<float> pcm(48000, 0.5f);
    player.loadClip("intro", pcm);
    player.scheduleClip(0, "intro", 1.0f);
    
    assert(player.getPendingCount() == 1);
    std::cout << "✓ scheduleClip schedules a clip\n";
}

void test_render_clip() {
    AnnouncementPlayer player(48000);
    
    // Load a 1-second clip with constant 0.5 amplitude
    std::vector<float> pcm(48000, 0.5f);
    player.loadClip("intro", pcm);
    player.scheduleClip(0, "intro", 1.0f);
    
    // Render 1 second
    std::vector<float> buffer(48000, 0.0f);
    player.render(buffer.data(), 48000);
    
    // Check that buffer has audio (should be ~0.5 amplitude)
    float sum = 0.0f;
    for (float sample : buffer) {
        sum += std::abs(sample);
    }
    float avg = sum / buffer.size();
    assert(avg > 0.4f && avg < 0.6f);
    std::cout << "✓ render plays clip with correct amplitude\n";
}

void test_clip_gain() {
    AnnouncementPlayer player(48000);
    
    std::vector<float> pcm(48000, 1.0f);
    player.loadClip("intro", pcm);
    player.scheduleClip(0, "intro", 0.5f); // half gain
    
    std::vector<float> buffer(48000, 0.0f);
    player.render(buffer.data(), 48000);
    
    // Check that buffer has ~0.5 amplitude (gain applied)
    float sum = 0.0f;
    for (float sample : buffer) {
        sum += std::abs(sample);
    }
    float avg = sum / buffer.size();
    assert(avg > 0.4f && avg < 0.6f);
    std::cout << "✓ scheduleClip applies gain correctly\n";
}

void test_multiple_clips() {
    AnnouncementPlayer player(48000);
    
    std::vector<float> pcm1(24000, 0.3f); // 0.5s
    std::vector<float> pcm2(24000, 0.7f); // 0.5s
    player.loadClip("clip1", pcm1);
    player.loadClip("clip2", pcm2);
    
    player.scheduleClip(0, "clip1", 1.0f);
    player.scheduleClip(24000, "clip2", 1.0f); // after first clip
    
    assert(player.getPendingCount() == 2);
    
    std::vector<float> buffer(48000, 0.0f);
    player.render(buffer.data(), 48000);
    
    assert(player.getPendingCount() == 0); // both consumed
    std::cout << "✓ multiple clips render sequentially\n";
}

void test_clear() {
    AnnouncementPlayer player(48000);
    
    std::vector<float> pcm(48000, 0.5f);
    player.loadClip("intro", pcm);
    player.scheduleClip(0, "intro", 1.0f);
    
    assert(player.getPendingCount() == 1);
    player.clear();
    assert(player.getPendingCount() == 0);
    std::cout << "✓ clear removes all pending clips\n";
}

void test_missing_clip() {
    AnnouncementPlayer player(48000);
    
    // Schedule a clip that doesn't exist
    player.scheduleClip(0, "missing", 1.0f);
    
    // Should not crash, just skip
    std::vector<float> buffer(48000, 0.0f);
    player.render(buffer.data(), 48000);
    
    // Buffer should be silent
    float sum = 0.0f;
    for (float sample : buffer) {
        sum += std::abs(sample);
    }
    assert(sum < 0.001f);
    std::cout << "✓ scheduleClip handles missing clip gracefully\n";
}

int main() {
    std::cout << "Running Announcement Player tests...\n\n";
    
    test_load_clip();
    test_schedule_clip();
    test_render_clip();
    test_clip_gain();
    test_multiple_clips();
    test_clear();
    test_missing_clip();
    
    std::cout << "\n✅ All tests passed!\n";
    return 0;
}
