#pragma once

#include <atomic>
#include <cstddef>
#include <type_traits>

namespace stageboard {

/**
 * One writer, one reader, fixed size, no locks and no allocation after construction (docs/30 §8h):
 * the only way values cross between the control thread and the audio thread. `Capacity` must be a
 * power of two; one slot stays empty, so it holds Capacity - 1 values.
 */
template <typename T, std::size_t Capacity>
class SpscQueue {
  static_assert((Capacity & (Capacity - 1)) == 0, "Capacity must be a power of two");
  static_assert(std::is_trivially_copyable<T>::value, "only plain values cross threads");

 public:
  /** Writer side. False when full - the value is not queued. */
  bool push(const T& value) {
    const std::size_t head = head_.load(std::memory_order_relaxed);
    const std::size_t next = (head + 1) & (Capacity - 1);
    if (next == tail_.load(std::memory_order_acquire)) return false;
    slots_[head] = value;
    head_.store(next, std::memory_order_release);
    return true;
  }

  /** Reader side. False when empty. */
  bool pop(T& out) {
    const std::size_t tail = tail_.load(std::memory_order_relaxed);
    if (tail == head_.load(std::memory_order_acquire)) return false;
    out = slots_[tail];
    tail_.store((tail + 1) & (Capacity - 1), std::memory_order_release);
    return true;
  }

 private:
  T slots_[Capacity];
  alignas(64) std::atomic<std::size_t> head_{0};
  alignas(64) std::atomic<std::size_t> tail_{0};
};

}  // namespace stageboard
