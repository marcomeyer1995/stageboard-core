#include "stageboard/engine.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace stageboard {

Engine::Engine(double sampleRate, int channels)
    : sampleRate_(sampleRate),
      channels_(channels),
      clock_(sampleRate),
      // A gain change glides over ~5 ms - no click from the fader itself.
      gainStep_(static_cast<float>(1 - std::exp(-1.0 / (0.005 * sampleRate)))),
      limiter_(sampleRate) {
  for (int b = 0; b < static_cast<int>(Bus::Count); ++b) targetGain_[b] = gain_[b] = 1;
}

Engine::~Engine() {
  collectGarbage();
  delete plan_;
  Command command;
  while (commands_.pop(command)) {
    if (command.type == Command::Type::Beats) delete command.plan;
  }
}

bool Engine::setTransport(const Transport& transport) {
  Command command{};
  command.type = Command::Type::Transport;
  command.transport = transport;
  return commands_.push(command);
}

bool Engine::setBeats(BeatPlan* plan) {
  Command command{};
  command.type = Command::Type::Beats;
  command.plan = plan;
  if (commands_.push(command)) return true;
  delete plan;
  return false;
}

bool Engine::setGain(Bus bus, float gain) {
  Command command{};
  command.type = Command::Type::Gain;
  command.bus = static_cast<int>(bus);
  command.gain = gain;
  return commands_.push(command);
}

bool Engine::setMasterGain(float gain) {
  Command command{};
  command.type = Command::Type::MasterGain;
  command.gain = gain;
  return commands_.push(command);
}

bool Engine::observeClock(int64_t frame, double bandMs) {
  Command command{};
  command.type = Command::Type::Clock;
  command.frame = frame;
  command.bandMs = bandMs;
  return commands_.push(command);
}

void Engine::collectGarbage() {
  BeatPlan* plan;
  while (retired_.pop(plan)) delete plan;
}

void Engine::apply(const Command& command) {
  switch (command.type) {
    case Command::Type::Transport:
      transport_ = command.transport;
      break;
    case Command::Type::Beats:
      // Nothing is freed here. If the way back is full (the control thread hasn't collected for a
      // long time), the old plan stays and the new one goes back unused - try again later.
      if (plan_ && !retired_.push(plan_)) {
        retired_.push(command.plan);
        break;
      }
      plan_ = command.plan;
      break;
    case Command::Type::Gain:
      targetGain_[command.bus] = command.gain;
      break;
    case Command::Type::MasterGain:
      targetMaster_ = command.gain;
      break;
    case Command::Type::Clock:
      clock_.observe(command.frame, command.bandMs);
      break;
  }
}

void Engine::triggerClick(double frameInBlock, bool accent) {
  for (ClickVoice& voice : voices_) {
    if (!voice.active()) {
      voice.trigger(frameInBlock, accent, sampleRate_);
      return;
    }
  }
}

void Engine::scheduleClicks(double fromFrame, double toFrame, double startSongMs, double endSongMs, bool afterJump, int64_t firstFrame) {
  if (!plan_ || endSongMs <= startSongMs) return;
  const std::vector<Beat>& beats = plan_->beats;
  auto it = std::lower_bound(beats.begin(), beats.end(), startSongMs, [](const Beat& b, double ms) { return b.songMs < ms; });
  for (; it != beats.end() && it->songMs < endSongMs; ++it) {
    const double frame = clock_.frameAt(bandMsAt(transport_, it->songMs, afterJump));
    double inBlock = frame - static_cast<double>(firstFrame);
    // Rounding at the edges of this stretch must not move a beat into the neighbouring block.
    inBlock = std::clamp(inBlock, fromFrame, std::nextafter(toFrame, fromFrame));
    triggerClick(inBlock, it->accent);
  }
}

void Engine::render(float* out, int frames, int64_t firstFrame) {
  Command command;
  while (commands_.pop(command)) apply(command);
  // A long buffer in pieces the size of the working buffer - same result, any length.
  for (int done = 0; done < frames; done += kMaxBlock) {
    const int n = frames - done < kMaxBlock ? frames - done : kMaxBlock;
    renderBlock(out + static_cast<size_t>(done) * static_cast<size_t>(channels_), n, firstFrame + done);
  }
}

void Engine::renderBlock(float* out, int frames, int64_t firstFrame) {

  if (clock_.valid() && transport_.status == PlaybackStatus::Playing) {
    const double startBand = clock_.bandMsAt(static_cast<double>(firstFrame));
    const double endBand = clock_.bandMsAt(static_cast<double>(firstFrame + frames));
    if (transport_.hasJump && transport_.jumpAt > startBand && transport_.jumpAt < endBand) {
      // The jump falls inside this block: before it the old stretch, from it the new one.
      const double split = clock_.frameAt(transport_.jumpAt) - static_cast<double>(firstFrame);
      Transport before = transport_;
      before.hasJump = false;
      scheduleClicks(0, split, songMsAt(before, startBand), songMsAt(before, transport_.jumpAt), false, firstFrame);
      scheduleClicks(split, frames, transport_.jumpToMs, songMsAt(transport_, endBand), true, firstFrame);
    } else {
      const bool afterJump = transport_.hasJump && startBand >= transport_.jumpAt;
      scheduleClicks(0, frames, songMsAt(transport_, startBand), songMsAt(transport_, endBand), afterJump, firstFrame);
    }
  }

  const int click = static_cast<int>(Bus::Click);
  std::memset(bus_, 0, sizeof(float) * static_cast<size_t>(frames));
  for (ClickVoice& voice : voices_) voice.render(bus_, frames);
  for (int f = 0; f < frames; ++f) {
    gain_[click] += (targetGain_[click] - gain_[click]) * gainStep_;
    master_ += (targetMaster_ - master_) * gainStep_;
    const float sample = bus_[f] * gain_[click] * master_;
    for (int c = 0; c < channels_; ++c) out[f * channels_ + c] = sample;
  }
  limiter_.process(out, frames, channels_);
}

}  // namespace stageboard
