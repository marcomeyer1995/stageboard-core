import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { useAutoFitFontSize } from './useAutoFitFontSize'

/** happy-dom doesn't do real layout, so every element reports 0 for client/scroll
 * dimensions by default - stub a fixed container box and a scroll size that scales
 * linearly with the applied font-size (mimicking how real text grows), which is enough to
 * exercise the binary search's own logic without a real browser. */
function stubBox(el: HTMLElement, { clientWidth, clientHeight }: { clientWidth: number; clientHeight: number }) {
  Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
}

function stubScalingText(el: HTMLElement, { widthPerPx, heightPerPx }: { widthPerPx: number; heightPerPx: number }) {
  Object.defineProperty(el, 'scrollWidth', {
    configurable: true,
    get() {
      return parseFloat(this.style.fontSize || '0') * widthPerPx
    },
  })
  Object.defineProperty(el, 'scrollHeight', {
    configurable: true,
    get() {
      return parseFloat(this.style.fontSize || '0') * heightPerPx
    },
  })
}

function Probe({ onFontSize }: { onFontSize: (size: number) => void }) {
  const [containerRef, textRef, fontSize] = useAutoFitFontSize<HTMLDivElement, HTMLSpanElement>({ min: 1, max: 200 }, [])
  onFontSize(fontSize)
  return (
    <div
      ref={(el) => {
        containerRef(el)
        if (el) stubBox(el, { clientWidth: 400, clientHeight: 40 })
      }}
    >
      <span
        ref={(el) => {
          textRef(el)
          // Wide text (10x its font-size) but short (1.2x its font-size) - a realistic
          // single-line label: width is the binding constraint here, not height.
          if (el) stubScalingText(el, { widthPerPx: 10, heightPerPx: 1.2 })
        }}
      >
        some text
      </span>
    </div>
  )
}

describe('useAutoFitFontSize', () => {
  it('picks the largest font size that fits both the width and height ceiling', () => {
    let last = 0
    render(<Probe onFontSize={(size) => (last = size)} />)
    // width ceiling: 400 / 10 = 40; height ceiling: 40 / 1.2 ≈ 33.3 -> the binding one.
    // A pre-fix bug (height silently unconstrained) would have let this reach the 40 width
    // ceiling, or even the 200 max, instead of respecting the tighter height limit.
    expect(last).toBe(33)
  })

  it('never exceeds the configured max even when both dimensions have generous room', () => {
    function Roomy({ onFontSize }: { onFontSize: (size: number) => void }) {
      const [containerRef, textRef, fontSize] = useAutoFitFontSize<HTMLDivElement, HTMLSpanElement>(
        { min: 1, max: 60 },
        [],
      )
      onFontSize(fontSize)
      return (
        <div
          ref={(el) => {
            containerRef(el)
            if (el) stubBox(el, { clientWidth: 5000, clientHeight: 5000 })
          }}
        >
          <span
            ref={(el) => {
              textRef(el)
              if (el) stubScalingText(el, { widthPerPx: 1, heightPerPx: 1 })
            }}
          >
            x
          </span>
        </div>
      )
    }
    let last = 0
    render(<Roomy onFontSize={(size) => (last = size)} />)
    expect(last).toBe(60)
  })
})
