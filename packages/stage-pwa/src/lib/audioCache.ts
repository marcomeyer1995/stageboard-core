/**
 * Minimal local blob cache for downloaded audio tracks (see #30) - "fetch once, keep
 * forever", no eviction or quota awareness at all. That's deliberate: the quota-aware
 * None/Selective/Full strategy is a separate follow-up issue's job, layered on top of this
 * same cache later. Without even this much, offline playback would regress the moment
 * audio stops riding along on PouchDB's own replication - a track fetched once still needs
 * to survive a reload with no network.
 *
 * Hand-rolled IndexedDB rather than a dependency: this project keeps its dependency list
 * lean on purpose (see couch.ts), and the surface needed here is three tiny operations.
 */

const DB_NAME = 'stageboard-audio-cache'
const STORE_NAME = 'tracks'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export function cacheKey(variantId: string, trackId: string): string {
  return `${variantId}:${trackId}`
}

export async function getCached(key: string): Promise<Blob | null> {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key)
      request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null)
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

export async function setCached(key: string, blob: Blob): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(blob, key)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

export async function removeCached(key: string): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(key)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}
