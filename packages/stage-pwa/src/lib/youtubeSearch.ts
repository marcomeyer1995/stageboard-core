import type { YoutubeSearchResult } from 'shared-types'
import { bandParam, getJson, type LookupClientResult } from './lookupClient'
import { getStageServerUrl } from './stageServer'

/** "Track hinzufügen" (#618): YouTube searched by the Stage-Server's yt-dlp - only with the band's
 * YouTube-Download add-on, which the server checks. */
export function searchYoutube(query: string): Promise<LookupClientResult<YoutubeSearchResult[]>> {
  return getJson(`/youtube/search?q=${encodeURIComponent(query)}${bandParam()}`)
}

/** A hit's picture, fetched through the Stage-Server - the tablets often have no internet of their own. */
export function youtubeThumbnailUrl(videoId: string): string | null {
  const base = getStageServerUrl()
  return base ? `${base}/youtube/thumbnail?id=${encodeURIComponent(videoId)}` : null
}

/** 171 → "2:51". */
export function formatVideoLength(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
