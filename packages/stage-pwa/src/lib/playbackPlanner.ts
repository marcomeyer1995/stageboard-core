/**
 * Native Engine N1 (docs/30 §8): plans clicks and announcements on band time, sends them to the
 * native engine ahead of time so they keep playing when the WebView is locked.
 *
 * The WebView's scheduler (clickEngine.ts) plans 150 ms ahead; this planner extends that to 2-3 s
 * for the native side. The native engine plays on its own when the WebView stops (lock, stall).
 */

export type PlaybackPlanType = 'click' | 'announcement'

export interface ClickPayload {
  isDownbeat: boolean
}

export interface AnnouncementPayload {
  clipId: string
}

export interface PlaybackPlan {
  bandTimeMs: number
  type: PlaybackPlanType
  payload: ClickPayload | AnnouncementPayload
  gain: number
}

export interface ScheduleClickOptions {
  bandTimeMs: number
  isDownbeat: boolean
  gain?: number
}

export interface ScheduleAnnouncementOptions {
  bandTimeMs: number
  clipId: string
  gain?: number
}

/**
 * Plans clicks and announcements on band time, sends them to the native engine ahead of time.
 * Sorted by band time; plans are removed after being sent.
 */
export class PlaybackPlanner {
  private queue: PlaybackPlan[] = []

  constructor(private readonly sendToNative: (plans: PlaybackPlan[]) => Promise<void>) {}

  /** Adds a click to the plan queue. */
  scheduleClick(options: ScheduleClickOptions): void {
    this.queue.push({
      bandTimeMs: options.bandTimeMs,
      type: 'click',
      payload: { isDownbeat: options.isDownbeat },
      gain: options.gain ?? 1.0,
    })
    this.sortQueue()
  }

  /** Adds an announcement to the plan queue. */
  scheduleAnnouncement(options: ScheduleAnnouncementOptions): void {
    this.queue.push({
      bandTimeMs: options.bandTimeMs,
      type: 'announcement',
      payload: { clipId: options.clipId },
      gain: options.gain ?? 1.0,
    })
    this.sortQueue()
  }

  /**
   * Sends plans within the lookahead window to the native engine.
   * Plans in the past are discarded; plans outside the window stay in the queue.
   */
  async sendUpcoming(nowMs: number, lookaheadMs: number): Promise<void> {
    const cutoff = nowMs + lookaheadMs
    const toSend: PlaybackPlan[] = []
    const remaining: PlaybackPlan[] = []

    for (const plan of this.queue) {
      if (plan.bandTimeMs < nowMs) {
        // Past: discard
        continue
      }
      if (plan.bandTimeMs <= cutoff) {
        toSend.push(plan)
      } else {
        remaining.push(plan)
      }
    }

    if (toSend.length === 0) return

    this.queue = remaining
    await this.sendToNative(toSend)
  }

  /** Removes all plans from the queue (stop, seek, etc.). */
  clear(): void {
    this.queue = []
  }

  /** Test-only: number of plans in the queue. */
  getQueueLength(): number {
    return this.queue.length
  }

  /** Test-only: plan at index. */
  getPlanAt(index: number): PlaybackPlan | undefined {
    return this.queue[index]
  }

  private sortQueue(): void {
    this.queue.sort((a, b) => a.bandTimeMs - b.bandTimeMs)
  }
}
