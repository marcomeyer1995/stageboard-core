import { describe, expect, it, vi, beforeEach } from 'vitest'
import { PlaybackPlanner, type PlaybackPlan } from './playbackPlanner'

describe('playbackPlanner', () => {
  let planner: PlaybackPlanner
  let sendToNative: ReturnType<typeof vi.fn>

  beforeEach(() => {
    sendToNative = vi.fn().mockResolvedValue(undefined)
    planner = new PlaybackPlanner(sendToNative)
  })

  describe('scheduleClick', () => {
    it('adds a click plan to the queue', () => {
      planner.scheduleClick({ bandTimeMs: 1000, isDownbeat: false })
      expect(planner.getQueueLength()).toBe(1)
    })

    it('marks downbeat clicks correctly', () => {
      planner.scheduleClick({ bandTimeMs: 1000, isDownbeat: true })
      const plan = planner.getPlanAt(0)
      expect(plan?.type).toBe('click')
      expect(plan?.payload.isDownbeat).toBe(true)
    })

    it('sorts plans by band time', () => {
      planner.scheduleClick({ bandTimeMs: 3000, isDownbeat: false })
      planner.scheduleClick({ bandTimeMs: 1000, isDownbeat: false })
      planner.scheduleClick({ bandTimeMs: 2000, isDownbeat: false })
      
      expect(planner.getPlanAt(0)?.bandTimeMs).toBe(1000)
      expect(planner.getPlanAt(1)?.bandTimeMs).toBe(2000)
      expect(planner.getPlanAt(2)?.bandTimeMs).toBe(3000)
    })
  })

  describe('scheduleAnnouncement', () => {
    it('adds an announcement plan to the queue', () => {
      planner.scheduleAnnouncement({ bandTimeMs: 5000, clipId: 'intro' })
      expect(planner.getQueueLength()).toBe(1)
    })

    it('stores the clip ID', () => {
      planner.scheduleAnnouncement({ bandTimeMs: 5000, clipId: 'verse-1' })
      const plan = planner.getPlanAt(0)
      expect(plan?.type).toBe('announcement')
      expect(plan?.payload.clipId).toBe('verse-1')
    })
  })

  describe('sendUpcoming', () => {
    it('sends plans within the lookahead window', async () => {
      const now = 10000
      planner.scheduleClick({ bandTimeMs: 10500, isDownbeat: false }) // +500ms
      planner.scheduleClick({ bandTimeMs: 11000, isDownbeat: false }) // +1000ms
      planner.scheduleClick({ bandTimeMs: 12500, isDownbeat: false }) // +2500ms (outside 2s window)
      
      await planner.sendUpcoming(now, 2000)
      
      expect(sendToNative).toHaveBeenCalledTimes(1)
      const sent: PlaybackPlan[] = sendToNative.mock.calls[0][0]
      expect(sent).toHaveLength(2)
      expect(sent[0].bandTimeMs).toBe(10500)
      expect(sent[1].bandTimeMs).toBe(11000)
    })

    it('does not send plans in the past', async () => {
      const now = 10000
      planner.scheduleClick({ bandTimeMs: 9000, isDownbeat: false }) // -1000ms (past)
      planner.scheduleClick({ bandTimeMs: 10500, isDownbeat: false }) // +500ms
      
      await planner.sendUpcoming(now, 2000)
      
      const sent: PlaybackPlan[] = sendToNative.mock.calls[0][0]
      expect(sent).toHaveLength(1)
      expect(sent[0].bandTimeMs).toBe(10500)
    })

    it('removes sent plans from the queue', async () => {
      const now = 10000
      planner.scheduleClick({ bandTimeMs: 10500, isDownbeat: false })
      
      expect(planner.getQueueLength()).toBe(1)
      await planner.sendUpcoming(now, 2000)
      expect(planner.getQueueLength()).toBe(0)
    })

    it('does not send if queue is empty', async () => {
      await planner.sendUpcoming(10000, 2000)
      expect(sendToNative).not.toHaveBeenCalled()
    })
  })

  describe('clear', () => {
    it('removes all plans from the queue', () => {
      planner.scheduleClick({ bandTimeMs: 1000, isDownbeat: false })
      planner.scheduleClick({ bandTimeMs: 2000, isDownbeat: false })
      
      expect(planner.getQueueLength()).toBe(2)
      planner.clear()
      expect(planner.getQueueLength()).toBe(0)
    })
  })

  describe('gain', () => {
    it('uses default gain of 1.0 if not specified', () => {
      planner.scheduleClick({ bandTimeMs: 1000, isDownbeat: false })
      const plan = planner.getPlanAt(0)
      expect(plan?.gain).toBe(1.0)
    })

    it('stores custom gain', () => {
      planner.scheduleClick({ bandTimeMs: 1000, isDownbeat: false, gain: 0.5 })
      const plan = planner.getPlanAt(0)
      expect(plan?.gain).toBe(0.5)
    })
  })
})
