#pragma once

#include "click_synth.h"
#include <cstdint>
#include <string>
#include <vector>

/**
 * Native Engine N1 (docs/30 §8): receives playback plans from the WebView (JSON over the bridge),
 * converts band time → frame position, and dispatches to the click synthesizer or announcement
 * player.
 *
 * The WebView's playback planner (playbackPlanner.ts) sends plans 2-3 s ahead. This queue holds
 * them until they are due, then schedules them on the native synthesizer. Plans in the past are
 * discarded (too late to play).
 *
 * Why: when the WebView is locked, the native engine keeps playing on its own. The queue is the
 * bridge between the WebView's plan (band time, type, payload) and the native engine's frame
 * timeline.
 */
class PlaybackPlanQueue {
public:
    explicit PlaybackPlanQueue(ClickSynthesizer& clickSynth);

    /**
     * Adds a plan from the WebView.
     * @param bandTimeMs Band time in ms (when the sound should be heard).
     * @param type "click" or "announcement".
     * @param payloadJson JSON payload (click: {isDownbeat, gain}, announcement: {clipId, gain}).
     */
    void addPlan(int64_t bandTimeMs, const std::string& type, const std::string& payloadJson);

    /**
     * Converts band time (ms) to frame position on the output timeline.
     * Uses the sample rate: frames = ms * sampleRate / 1000.
     */
    int64_t bandTimeToFrame(int64_t bandTimeMs) const;

    /**
     * Processes all plans that are due at the given frame position.
     * Schedules due plans on the click synthesizer or announcement player.
     * Discards plans in the past (band time < current frame time).
     */
    void process(int64_t currentFrame);

    /** Removes all pending plans (stop, seek, etc.). */
    void clear();

    /** Test-only: number of pending plans. */
    int getPendingCount() const;

private:
    struct Plan {
        int64_t bandTimeMs;
        int64_t framePosition;
        std::string type; // "click" or "announcement"
        std::string payloadJson;
    };

    ClickSynthesizer& clickSynth;
    int sampleRate;
    std::vector<Plan> plans;

    void processClick(const Plan& plan);
    void processAnnouncement(const Plan& plan);
};
