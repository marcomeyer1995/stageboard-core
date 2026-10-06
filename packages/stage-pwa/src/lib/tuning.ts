/**
 * Whether a tuning text means plain standard tuning (#410) - then the Prompter doesn't show it at
 * all; only a different tuning (Drop D, Eb, DADGAD …) is worth a chip. Imports write it in many
 * ways: "E A D G B E", "EADGBe", "Standard", "E Standard".
 */
export function isStandardTuning(tuning: string | undefined | null): boolean {
  if (!tuning) return true
  const text = tuning.trim().toUpperCase()
  if (text.replace(/[^A-Z]/g, '') === 'EADGBE') return true
  return /^(E\s*)?STANDARD(\s*\(?E\s*A\s*D\s*G\s*B\s*E\)?)?$/.test(text)
}
