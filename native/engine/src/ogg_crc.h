#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

namespace stageboard::detail {

/** Ogg's page checksum: CRC-32, polynomial 0x04c11db7, not reflected, starting at 0. */
inline uint32_t oggCrc(uint32_t crc, const uint8_t* data, size_t size) {
  static const std::array<uint32_t, 256> table = [] {
    std::array<uint32_t, 256> t{};
    for (uint32_t i = 0; i < 256; ++i) {
      uint32_t r = i << 24;
      for (int b = 0; b < 8; ++b) r = r & 0x80000000u ? (r << 1) ^ 0x04c11db7u : r << 1;
      t[i] = r;
    }
    return t;
  }();
  for (size_t i = 0; i < size; ++i) crc = (crc << 8) ^ table[((crc >> 24) ^ data[i]) & 0xff];
  return crc;
}

}  // namespace stageboard::detail
