import { analysisCheck, ANALYSIS_SAMPLE_RATE, type AnalysisCheck } from './rigCheckAnalysis'
import { buildRigCheckSong, synthesizeRigCheckTrack, type RigCheckKind } from './rigCheckSong'

export interface RigCheckAnalysisRequest {
  kind: RigCheckKind
}

export type RigCheckAnalysisResponse = { ok: true; result: AnalysisCheck } | { ok: false; error: string }

/**
 * The Rig-Check's analysis check (docs/24 §6) off the main thread - synthesizing the track and
 * running both editor paths takes a few seconds on a tablet, right when every device asks for its
 * verdict. One request per worker, like trackAnalysisWorker.ts.
 */
self.onmessage = (event: MessageEvent<RigCheckAnalysisRequest>) => {
  try {
    const song = buildRigCheckSong(event.data.kind)
    const result = analysisCheck(song, synthesizeRigCheckTrack(song, ANALYSIS_SAMPLE_RATE), ANALYSIS_SAMPLE_RATE)
    self.postMessage({ ok: true, result } satisfies RigCheckAnalysisResponse)
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) } satisfies RigCheckAnalysisResponse)
  }
}
