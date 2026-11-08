#include "click_synth.h"
#include <algorithm>
#include <cmath>

ClickSynthesizer::ClickSynthesizer(int sampleRate)
    : sampleRate(sampleRate) {}

void ClickSynthesizer::scheduleClick(int64_t startFrame, bool isDownbeat, float gain) {
    Click click;
    click.startFrame = startFrame;
    click.frequency = isDownbeat ? DOWNBEAT_FREQ_HZ : NORMAL_FREQ_HZ;
    click.baseAmplitude = isDownbeat ? DOWNBEAT_AMPLITUDE : NORMAL_AMPLITUDE;
    click.gain = gain;
    click.durationFrames = static_cast<int>(CLICK_DURATION_S * sampleRate);
    click.endFrame = startFrame + click.durationFrames;
    
    clicks.push_back(click);
    
    // Keep sorted by startFrame for efficient rendering
    std::sort(clicks.begin(), clicks.end(), [](const Click& a, const Click& b) {
        return a.startFrame < b.startFrame;
    });
}

void ClickSynthesizer::render(float* buffer, int frames) {
    const int64_t startFrame = currentFrame;
    const int64_t endFrame = currentFrame + frames;
    
    // Clear buffer
    std::fill(buffer, buffer + frames, 0.0f);
    
    // Render each click that overlaps with [startFrame, endFrame)
    for (auto it = clicks.begin(); it != clicks.end(); ) {
        const Click& click = *it;
        
        // Skip clicks that end before our window
        if (click.endFrame <= startFrame) {
            it = clicks.erase(it);
            continue;
        }
        
        // Stop if click starts after our window (sorted, so all remaining are after)
        if (click.startFrame >= endFrame) {
            break;
        }
        
        // Click overlaps with our window - render it
        const int64_t clickStart = std::max(click.startFrame, startFrame);
        const int64_t clickEnd = std::min(click.endFrame, endFrame);
        
        const float amplitude = click.baseAmplitude * click.gain;
        const double angularFreq = 2.0 * M_PI * click.frequency / sampleRate;
        
        for (int64_t frame = clickStart; frame < clickEnd; frame++) {
            const int64_t clickOffset = frame - click.startFrame;
            const float time = static_cast<float>(clickOffset) / sampleRate;
            
            // Exponential decay: fast attack, decay to near-silence
            // Matches clickEngine.ts: gain.gain.exponentialRampToValueAtTime(0.001, time + 0.03)
            const float decay = std::exp(-5.0f * time / CLICK_DURATION_S);
            const float envelope = amplitude * decay;
            
            // Oscillator: sin(2π * freq * time)
            const float sample = envelope * std::sin(angularFreq * clickOffset);
            
            // Add to buffer (mix with other clicks)
            buffer[frame - startFrame] += sample;
        }
        
        // Remove if fully consumed
        if (click.endFrame <= endFrame) {
            it = clicks.erase(it);
        } else {
            ++it;
        }
    }
    
    currentFrame = endFrame;
}

void ClickSynthesizer::clear() {
    clicks.clear();
}

int ClickSynthesizer::getPendingCount() const {
    return static_cast<int>(clicks.size());
}
