import PouchDB from 'pouchdb'
import type { Song } from 'shared-types'

export const songsDb = new PouchDB<Song>('stageboard-songs')
