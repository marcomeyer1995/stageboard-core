#include "stageboard/engine.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace stageboard {

Engine::Engine(double sampleRate, int channels)
    : sampleRate_(sampleRate),
      channels_(std::clamp(channels, 1, kMaxChannels)),
      clock_(sampleRate),
      // A gain change glides over ~5 ms - no click from the fader itself.
      gainStep_(static_cast<float>(1 - std::exp(-1.0 / (0.005 * sampleRate)))),
      limiter_(sampleRate) {
  for (int b = 0; b < kBuses; ++b) targetGain_[b] = gain_[b] = 1;
}

Engine::~Engine() {
  collectGarbage();
  delete plan_;
  for (ClipSlot& slot : clips_) delete slot.data;
  Command command;
  while (commands_.pop(command)) {
    if (command.type == Command::Type::Beats) delete command.plan;
    if (command.type == Command::Type::Clip) delete command.clip;
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

bool Engine::setClip(int id, ClipData* data, double songStartMs, Bus bus, float gain) {
  if (id < 0 || id >= kMaxClips) {
    delete data;
    return false;
  }
  Command command{};
  command.type = Command::Type::Clip;
  command.id = id;
  command.clip = data;
  command.songStartMs = songStartMs;
  command.bus = static_cast<int>(bus);
  command.gain = gain;
  if (commands_.push(command)) return true;
  delete data;
  return false;
}

bool Engine::removeClip(int id) {
  if (id < 0 || id >= kMaxClips) return false;
  Command command{};
  command.type = Command::Type::RemoveClip;
  command.id = id;
  return commands_.push(command);
}

bool Engine::setClipGain(int id, float gain) {
  if (id < 0 || id >= kMaxClips) return false;
  Command command{};
  command.type = Command::Type::ClipGain;
  command.id = id;
  command.gain = gain;
  return commands_.push(command);
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
  while (retiredPlans_.pop(plan)) delete plan;
  ClipData* clip;
  while (retiredClips_.pop(clip)) delete clip;
}

void Engine::retire(ClipData* data) {
  // Nothing is freed on the audio thread. If the way back is full (the control thread hasn't
  // collected for a long time) the memory is lost rather than freed here - it never happens in use.
  if (data) retiredClips_.push(data);
}

void Engine::apply(const Command& command) {
  switch (command.type) {
    case Command::Type::Transport:
      transport_ = command.transport;
      break;
    case Command::Type::Beats:
      // If the way back is full, the old plan stays and the new one goes back unused.
      if (plan_ && !retiredPlans_.push(plan_)) {
        retiredPlans_.push(command.plan);
        break;
      }
      plan_ = command.plan;
      break;
    case Command::Type::Clip: {
      ClipSlot& slot = clips_[command.id];
      retire(slot.data);
      slot.data = command.clip;
      slot.voice.setData(command.clip);
      slot.songStartMs = command.songStartMs;
      slot.bus = command.bus;
      slot.gain = command.gain;
      break;
    }
    case Command::Type::RemoveClip: {
      ClipSlot& slot = clips_[command.id];
      retire(slot.data);
      slot.data = nullptr;
      slot.voice.setData(nullptr);
      break;
    }
    case Command::Type::ClipGain:
      clips_[command.id].gain = command.gain;
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

int Engine::segments(int frames, int64_t firstFrame, Segment* out) const {
  const double startBand = clock_.bandMsAt(static_cast<double>(firstFrame));
  const double endBand = clock_.bandMsAt(static_cast<double>(firstFrame + frames));
  if (transport_.hasJump && transport_.jumpAt > startBand && transport_.jumpAt < endBand) {
    // The jump falls inside this block: before it the old line, from it the new one.
    const double split = clock_.frameAt(transport_.jumpAt) - static_cast<double>(firstFrame);
    Transport before = transport_;
    before.hasJump = false;
    out[0] = {0, split, songMsAt(before, startBand), songMsAt(before, transport_.jumpAt), false};
    out[1] = {split, static_cast<double>(frames), transport_.jumpToMs, songMsAt(transport_, endBand), true};
    return 2;
  }
  const bool afterJump = transport_.hasJump && startBand >= transport_.jumpAt;
  out[0] = {0, static_cast<double>(frames), songMsAt(transport_, startBand), songMsAt(transport_, endBand), afterJump};
  return 1;
}

void Engine::scheduleClicks(const Segment& segment, int64_t firstFrame) {
  if (!plan_ || segment.songTo <= segment.songFrom) return;
  const std::vector<Beat>& beats = plan_->beats;
  auto it = std::lower_bound(beats.begin(), beats.end(), segment.songFrom, [](const Beat& b, double ms) { return b.songMs < ms; });
  for (; it != beats.end() && it->songMs < segment.songTo; ++it) {
    const double frame = clock_.frameAt(bandMsAt(transport_, it->songMs, segment.afterJump));
    // Rounding at the edges of this stretch must not move a beat into the neighbouring one.
    const double inBlock = std::clamp(frame - static_cast<double>(firstFrame), segment.from, std::nextafter(segment.to, segment.from));
    triggerClick(inBlock, it->accent);
  }
}

void Engine::render(float* out, int frames, int64_t firstFrame) {
  Command command;
  while (commands_.pop(command)) apply(command);
  // A long buffer in pieces the size of the working buffers - same result, any length.
  for (int done = 0; done < frames; done += kMaxBlock) {
    const int n = frames - done < kMaxBlock ? frames - done : kMaxBlock;
    renderBlock(out + static_cast<size_t>(done) * static_cast<size_t>(channels_), n, firstFrame + done);
  }
}

void Engine::renderBlock(float* out, int frames, int64_t firstFrame) {
  const size_t width = static_cast<size_t>(frames) * static_cast<size_t>(channels_);
  for (int b = 0; b < kBuses; ++b) std::memset(bus_[b], 0, sizeof(float) * width);
  std::memset(click_, 0, sizeof(float) * static_cast<size_t>(frames));

  const bool playing = clock_.valid() && transport_.status == PlaybackStatus::Playing;
  Segment parts[2];
  const int count = playing ? segments(frames, firstFrame, parts) : 0;
  for (int p = 0; p < count; ++p) scheduleClicks(parts[p], firstFrame);
  for (ClickVoice& voice : voices_) voice.render(click_, frames);

  const double framesPerMs = sampleRate_ / 1000;
  for (ClipSlot& slot : clips_) {
    if (!slot.data) continue;
    float* bus = bus_[slot.bus];
    if (!playing) {
      slot.voice.render(bus, frames, channels_, false, 0, 0, slot.gain);
      continue;
    }
    for (int p = 0; p < count; ++p) {
      const Segment& s = parts[p];
      const int from = static_cast<int>(std::ceil(s.from));
      const int to = p + 1 < count ? static_cast<int>(std::ceil(s.to)) : frames;
      if (to <= from) continue;
      // Source positions at the segment's first frame and just after its last.
      const double perFrame = (s.songTo - s.songFrom) / (s.to - s.from);
      const double songAtFrom = s.songFrom + (from - s.from) * perFrame;
      const double songAtTo = s.songFrom + (to - s.from) * perFrame;
      slot.voice.render(bus + static_cast<size_t>(from) * static_cast<size_t>(channels_), to - from, channels_, true,
                        (songAtFrom - slot.songStartMs) * framesPerMs, (songAtTo - slot.songStartMs) * framesPerMs, slot.gain);
    }
  }

  const int click = static_cast<int>(Bus::Click);
  for (int f = 0; f < frames; ++f) {
    for (int b = 0; b < kBuses; ++b) gain_[b] += (targetGain_[b] - gain_[b]) * gainStep_;
    master_ += (targetMaster_ - master_) * gainStep_;
    for (int c = 0; c < channels_; ++c) {
      const size_t i = static_cast<size_t>(f) * static_cast<size_t>(channels_) + static_cast<size_t>(c);
      float sum = click_[f] * gain_[click];
      for (int b = 0; b < kBuses; ++b)
        if (b != click) sum += bus_[b][i] * gain_[b];
      out[i] = sum * master_;
    }
  }
  limiter_.process(out, frames, channels_);
}

}  // namespace stageboard
