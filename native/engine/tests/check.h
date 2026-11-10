#pragma once
// The tests' checks: no framework - plain checks, exit code 1 on any failure.

#include <cmath>
#include <cstdio>

inline int failures = 0;
#define CHECK(cond)                                                     \
  do {                                                                  \
    if (!(cond)) {                                                      \
      std::printf("  FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond);     \
      ++failures;                                                       \
    }                                                                   \
  } while (0)
#define CHECK_NEAR(a, b, tol)                                                                                      \
  do {                                                                                                             \
    const double a_ = (a), b_ = (b);                                                                               \
    if (std::fabs(a_ - b_) > (tol)) {                                                                              \
      std::printf("  FAIL %s:%d  %s = %.6f, expected %.6f ± %g\n", __FILE__, __LINE__, #a, a_, b_, (double)(tol)); \
      ++failures;                                                                                                  \
    }                                                                                                              \
  } while (0)

void runOpusClipTests();
void runResampleTests();
