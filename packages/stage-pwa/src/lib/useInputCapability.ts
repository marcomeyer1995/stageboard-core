import { useEffect, useState } from 'react'

export type InputCapability = 'touch' | 'pointer'

function computeCapability(): InputCapability {
  return window.matchMedia('(pointer: fine)').matches && window.matchMedia('(hover: hover)').matches
    ? 'pointer'
    : 'touch'
}

/**
 * Touch vs. mouse/trackpad, live - screen-size class alone can't tell these apart (a
 * touchscreen laptop is both wide and fine-pointer at once; see the "UI Tech Rider" concept's
 * edge cases). Trusts the platform's own `(pointer: fine)`/`(hover: hover)` report on mount and
 * for any *downgrade* (unplugging a mouse) without waiting - most devices report their real
 * primary input correctly already, and the touch-lane fallback this drives (e.g. a visible "+"
 * button instead of a swipe gesture) still works fine by touch even on the rare
 * misreporting device.
 *
 * An *upgrade* to 'pointer' mid-session, though, only commits once real pointer movement is
 * observed (a nonzero `movementX`/`movementY`) - a footswitch or click-only peripheral that
 * enumerates as a mouse can make the OS report a fine pointer without anyone ever actually
 * moving one, and silently swapping the UI mid-show (not at load, where a touch-compatible
 * fallback is one tap away regardless) is the scenario worth guarding against.
 */
export function useInputCapability(): InputCapability {
  const [capability, setCapability] = useState<InputCapability>(computeCapability)

  useEffect(() => {
    const fineQuery = window.matchMedia('(pointer: fine)')
    const hoverQuery = window.matchMedia('(hover: hover)')

    function handleMediaChange() {
      if (computeCapability() === 'touch') setCapability('touch')
    }
    fineQuery.addEventListener('change', handleMediaChange)
    hoverQuery.addEventListener('change', handleMediaChange)

    function handleMouseMove(e: MouseEvent) {
      if (e.movementX === 0 && e.movementY === 0) return
      if (computeCapability() === 'pointer') setCapability('pointer')
    }
    window.addEventListener('mousemove', handleMouseMove)

    return () => {
      fineQuery.removeEventListener('change', handleMediaChange)
      hoverQuery.removeEventListener('change', handleMediaChange)
      window.removeEventListener('mousemove', handleMouseMove)
    }
  }, [])

  return capability
}

function computeHasCoarsePointer(): boolean {
  return window.matchMedia('(any-pointer: coarse)').matches
}

/**
 * True when a coarse (touch) pointer is present *alongside* whatever useInputCapability()
 * reports - a hybrid 2-in-1 laptop's touchscreen sitting next to its trackpad, for instance
 * (see the "UI Tech Rider" concept's own edge cases). Independent of the touch/pointer lane
 * itself: a device can be in the 'pointer' lane (trackpad drives `(pointer: fine)`/
 * `(hover: hover)`) and still have this be true - which is exactly the case that matters, so
 * primary interactive targets stay full touch-target size once promoted to the pointer lane,
 * since a real finger might still tap them directly. Folding a 2-in-1 into tablet posture typically
 * disables the trackpad in hardware, flipping `useInputCapability()` back to 'touch' on its
 * own - this hook only covers the case where both are active at once.
 */
export function useHasCoarsePointer(): boolean {
  const [hasCoarsePointer, setHasCoarsePointer] = useState(computeHasCoarsePointer)

  useEffect(() => {
    const query = window.matchMedia('(any-pointer: coarse)')
    const update = () => setHasCoarsePointer(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return hasCoarsePointer
}
