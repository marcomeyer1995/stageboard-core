#include "playback_plan.h"
#include <algorithm>
#include <sstream>
#include <iostream>

PlaybackPlanQueue::PlaybackPlanQueue(ClickSynthesizer& clickSynth)
    : clickSynth(clickSynth), sampleRate(48000) {}

void PlaybackPlanQueue::addPlan(int64_t bandTimeMs, const std::string& type, const std::string& payloadJson) {
    Plan plan;
    plan.bandTimeMs = bandTimeMs;
    plan.framePosition = bandTimeToFrame(bandTimeMs);
    plan.type = type;
    plan.payloadJson = payloadJson;
    
    plans.push_back(plan);
    
    // Keep sorted by frame position for efficient processing
    std::sort(plans.begin(), plans.end(), [](const Plan& a, const Plan& b) {
        return a.framePosition < b.framePosition;
    });
}

int64_t PlaybackPlanQueue::bandTimeToFrame(int64_t bandTimeMs) const {
    return bandTimeMs * sampleRate / 1000;
}

void PlaybackPlanQueue::process(int64_t currentFrame) {
    // Process plans in order (sorted by frame position)
    for (auto it = plans.begin(); it != plans.end(); ) {
        const Plan& plan = *it;
        
        // Stop if plan is in the future (sorted, so all remaining are after)
        if (plan.framePosition > currentFrame) {
            break;
        }
        
        // Discard plans in the past (more than 50ms late = 2400 frames)
        // 50ms is the threshold - beyond that, the click is perceptually "late"
        const int64_t lateThresholdFrames = 2400; // 50ms at 48kHz
        if (plan.framePosition < currentFrame - lateThresholdFrames) {
            it = plans.erase(it);
            continue;
        }
        
        // Plan is due - process it
        if (plan.type == "click") {
            processClick(plan);
        } else if (plan.type == "announcement") {
            processAnnouncement(plan);
        }
        
        it = plans.erase(it);
    }
}

void PlaybackPlanQueue::processClick(const Plan& plan) {
    // Simple JSON parsing for {isDownbeat:bool, gain:float}
    // Format: {"isDownbeat":true,"gain":1.0}
    bool isDownbeat = plan.payloadJson.find("\"isDownbeat\":true") != std::string::npos;
    
    // Extract gain (default 1.0)
    float gain = 1.0f;
    size_t gainPos = plan.payloadJson.find("\"gain\":");
    if (gainPos != std::string::npos) {
        gainPos += 7; // skip "gain":
        // Find the end of the number (comma, brace, or end of string)
        size_t gainEnd = plan.payloadJson.find_first_of(",}", gainPos);
        if (gainEnd != std::string::npos) {
            gain = std::stof(plan.payloadJson.substr(gainPos, gainEnd - gainPos));
        } else {
            gain = std::stof(plan.payloadJson.substr(gainPos));
        }
    }
    
    clickSynth.scheduleClick(plan.framePosition, isDownbeat, gain);
}

void PlaybackPlanQueue::processAnnouncement(const Plan& plan) {
    // Simple JSON parsing for {clipId:string, gain:float}
    // Format: {"clipId":"intro","gain":0.8}
    std::string clipId;
    size_t clipIdPos = plan.payloadJson.find("\"clipId\":\"");
    if (clipIdPos != std::string::npos) {
        clipIdPos += 10; // skip "clipId":"
        size_t clipIdEnd = plan.payloadJson.find("\"", clipIdPos);
        if (clipIdEnd != std::string::npos) {
            clipId = plan.payloadJson.substr(clipIdPos, clipIdEnd - clipIdPos);
        }
    }
    
    float gain = 1.0f;
    size_t gainPos = plan.payloadJson.find("\"gain\":");
    if (gainPos != std::string::npos) {
        gainPos += 7; // skip "gain":
        gain = std::stof(plan.payloadJson.substr(gainPos));
    }
    
    // TODO: Announcement player (N1 phase 2)
    // For now, just log - announcement player will be added later
    // announcementPlayer.scheduleClip(plan.framePosition, clipId, gain);
    (void)clipId;
    (void)gain;
}

void PlaybackPlanQueue::clear() {
    plans.clear();
}

int PlaybackPlanQueue::getPendingCount() const {
    return static_cast<int>(plans.size());
}
