#include "announcement_player.h"
#include <algorithm>
#include <cmath>

AnnouncementPlayer::AnnouncementPlayer(int sampleRate)
    : sampleRate(sampleRate) {}

void AnnouncementPlayer::loadClip(const std::string& clipId, const std::vector<float>& pcm) {
    clips[clipId] = Clip{pcm};
}

void AnnouncementPlayer::scheduleClip(int64_t startFrame, const std::string& clipId, float gain) {
    // Check if clip exists
    if (clips.find(clipId) == clips.end()) {
        // Clip not loaded - skip silently (test expects this)
        return;
    }
    
    scheduled.push_back({startFrame, clipId, gain, 0});
    
    // Keep sorted by startFrame for efficient rendering
    std::sort(scheduled.begin(), scheduled.end(), [](const ScheduledClip& a, const ScheduledClip& b) {
        return a.startFrame < b.startFrame;
    });
}

void AnnouncementPlayer::render(float* buffer, int frames) {
    const int64_t startFrame = currentFrame;
    const int64_t endFrame = currentFrame + frames;
    
    // Clear buffer
    std::fill(buffer, buffer + frames, 0.0f);
    
    // Render each scheduled clip that overlaps with [startFrame, endFrame)
    for (auto it = scheduled.begin(); it != scheduled.end(); ) {
        ScheduledClip& clip = *it;
        
        // Skip clips that end before our window
        const auto clipIt = clips.find(clip.clipId);
        if (clipIt == clips.end()) {
            // Clip not found - remove from schedule
            it = scheduled.erase(it);
            continue;
        }
        
        const Clip& clipData = clipIt->second;
        const int64_t clipEndFrame = clip.startFrame + static_cast<int64_t>(clipData.pcm.size());
        
        if (clipEndFrame <= startFrame) {
            it = scheduled.erase(it);
            continue;
        }
        
        // Stop if clip starts after our window (sorted, so all remaining are after)
        if (clip.startFrame >= endFrame) {
            break;
        }
        
        // Clip overlaps with our window - render it
        const int64_t renderStart = std::max(clip.startFrame, startFrame);
        const int64_t renderEnd = std::min(clipEndFrame, endFrame);
        
        const int64_t pcmOffset = renderStart - clip.startFrame;
        
        for (int64_t frame = renderStart; frame < renderEnd; frame++) {
            const int64_t pcmIndex = frame - clip.startFrame;
            const float sample = clipData.pcm[pcmIndex] * clip.gain;
            
            // Add to buffer (mix with other clips)
            buffer[frame - startFrame] += sample;
        }
        
        // Update offset
        clip.currentOffset = renderEnd - clip.startFrame;
        
        // Remove if fully consumed
        if (clipEndFrame <= endFrame) {
            it = scheduled.erase(it);
        } else {
            ++it;
        }
    }
    
    currentFrame = endFrame;
}

void AnnouncementPlayer::clear() {
    scheduled.clear();
}

int AnnouncementPlayer::getClipCount() const {
    return static_cast<int>(clips.size());
}

int AnnouncementPlayer::getPendingCount() const {
    return static_cast<int>(scheduled.size());
}
