#pragma once

#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

/**
 * Native Engine N1 (docs/30 §8): plays announcement clips (PCM audio) at scheduled times.
 *
 * Clips are loaded once from the WebView (over the bridge, PCM float32) and stored by ID.
 * When scheduled, the clip is played at the specified frame position with the given gain.
 *
 * Why: announcements (song intros, transitions) need to play even when the WebView is locked.
 * The WebView loads the clip data once; the native engine plays it on schedule.
 */
class AnnouncementPlayer {
public:
    explicit AnnouncementPlayer(int sampleRate);

    /**
     * Loads a clip from PCM data (float32, mono).
     * @param clipId Unique identifier for the clip.
     * @param pcm PCM data (float32, -1.0 to 1.0, mono).
     */
    void loadClip(const std::string& clipId, const std::vector<float>& pcm);

    /**
     * Schedules a clip to play at the given frame position.
     * @param startFrame Frame position on the output timeline (band time → frame).
     * @param clipId ID of a previously loaded clip.
     * @param gain Gain multiplier (0.0-1.0).
     */
    void scheduleClip(int64_t startFrame, const std::string& clipId, float gain);

    /**
     * Renders scheduled clips into the output buffer. Consumed clips are removed from the queue.
     * @param buffer Output buffer (mono, float, -1.0 to 1.0).
     * @param frames Number of frames to render.
     */
    void render(float* buffer, int frames);

    /** Removes all pending clips (stop, seek, etc.). */
    void clear();

    /** Test-only: number of loaded clips. */
    int getClipCount() const;

    /** Test-only: number of pending (scheduled but not yet played) clips. */
    int getPendingCount() const;

private:
    struct Clip {
        std::vector<float> pcm;
    };

    struct ScheduledClip {
        int64_t startFrame;
        std::string clipId;
        float gain;
        int64_t currentOffset; // how many frames already played
    };

    int sampleRate;
    std::unordered_map<std::string, Clip> clips;
    std::vector<ScheduledClip> scheduled;
    int64_t currentFrame = 0;
};
