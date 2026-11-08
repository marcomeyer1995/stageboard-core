#pragma once

#include <cstdint>
#include <vector>

/**
 * Native Engine N1 (docs/30 §8): synthesizes click bursts (short oscillator tones) at exact frame
 * positions. Called by the native audio engine to render clicks into the output buffer.
 *
 * Each click is a short (30 ms) oscillator burst with exponential decay - higher-pitched and louder
 * on the downbeat (matching the WebView's clickEngine.ts). The synthesizer is frame-accurate: a
 * click scheduled at frame N starts exactly at frame N, not "sometime soon".
 *
 * Why: when the WebView is locked, the native engine keeps playing clicks on its own. The WebView's
 * scheduler (clickEngine.ts) plans 150 ms ahead; the native engine plans 2-3 s ahead via the
 * playback planner (playbackPlanner.ts).
 */
class ClickSynthesizer {
public:
    explicit ClickSynthesizer(int sampleRate);

    /**
     * Schedules a click at the given frame position.
     * @param startFrame Frame position on the output timeline (band time → frame).
     * @param isDownbeat True for downbeat (1500 Hz, gain 0.5), false for normal (1000 Hz, gain 0.35).
     * @param gain Additional gain multiplier (0.0-1.0), applied on top of the base amplitude.
     */
    void scheduleClick(int64_t startFrame, bool isDownbeat, float gain);

    /**
     * Renders clicks into the output buffer. Consumed clicks are removed from the queue.
     * @param buffer Output buffer (mono, float, -1.0 to 1.0).
     * @param frames Number of frames to render.
     */
    void render(float* buffer, int frames);

    /** Removes all pending clicks (stop, seek, etc.). */
    void clear();

    /** Test-only: number of pending clicks. */
    int getPendingCount() const;

private:
    struct Click {
        int64_t startFrame;
        float frequency; // Hz (1000 or 1500)
        float baseAmplitude; // 0.35 or 0.5
        float gain; // additional multiplier
        int durationFrames; // 0.03s * sampleRate
        int64_t endFrame; // startFrame + durationFrames
    };

    int sampleRate;
    std::vector<Click> clicks;
    int64_t currentFrame = 0; // output position (advances with each render call)

    static constexpr float CLICK_DURATION_S = 0.03f;
    static constexpr float DOWNBEAT_FREQ_HZ = 1500.0f;
    static constexpr float NORMAL_FREQ_HZ = 1000.0f;
    static constexpr float DOWNBEAT_AMPLITUDE = 0.5f;
    static constexpr float NORMAL_AMPLITUDE = 0.35f;
};
