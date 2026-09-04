import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// This store now imports workspaceDb.ts (removeWorkspaceLocally's destroyLocalWorkspaceDb),
// which constructs a real PouchDB at module load time - unavailable under happy-dom (see
// workspaceDb.test.ts's identical mock, and useProfilesStore.test.ts's for the same reason).
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
    destroy() {
      return Promise.resolve()
    }
  },
}))

const getWorkspaceAccessDoc = vi.fn()
const watchWorkspaceAccessDoc = vi.fn()
vi.mock('../lib/workspaceAccessDoc', () => ({
  getWorkspaceAccessDoc: (...args: unknown[]) => getWorkspaceAccessDoc(...args),
  watchWorkspaceAccessDoc: (...args: unknown[]) => watchWorkspaceAccessDoc(...args),
}))

const { useDialogStore } = await import('./useDialogStore')
const { useWorkspaceStore } = await import('./useWorkspaceStore')

function stubFetch(response: Partial<Response> | null) {
  const fetchMock = response ? vi.fn().mockResolvedValue(response as Response) : vi.fn().mockRejectedValue(new Error('network down'))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  useWorkspaceStore.setState({
    workspaces: [
      { id: 'band-a', name: 'Band A' },
      { id: 'band-b', name: 'Band B' },
    ],
    activeWorkspaceId: 'band-a',
  })
  useDialogStore.setState({ alert: vi.fn().mockResolvedValue(undefined) })
  getWorkspaceAccessDoc.mockReset().mockResolvedValue(null)
  watchWorkspaceAccessDoc.mockReset().mockReturnValue({ on: () => {}, cancel: () => {} })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('addWorkspace', () => {
  it('provisions via the Stage-Server, stores the founder\'s own credential, and marks the device admin', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(import.meta.env as any).VITE_STAGE_SERVER_URL = 'https://stage-server:3001'
    const fetchMock = stubFetch({
      ok: true,
      status: 201,
      json: async () => ({ username: 'stageboard-new-id-p1', password: 'founder-pw' }),
    })

    const workspace = await useWorkspaceStore.getState().addWorkspace('Band C')

    expect(workspace).not.toBeNull()
    expect(workspace?.name).toBe('Band C')
    expect(workspace?.couchPassword).toBe('founder-pw')
    expect(workspace?.username).toBe('stageboard-new-id-p1')
    expect(workspace?.isAdmin).toBe(true)
    expect(typeof workspace?.ownProfileId).toBe('string')

    const state = useWorkspaceStore.getState()
    expect(state.activeWorkspaceId).toBe(workspace?.id)
    expect(state.workspaces).toContainEqual(workspace)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://stage-server:3001/workspaces')
    const body = JSON.parse(init.body)
    expect(body.workspaceId).toBe(workspace?.id)
    expect(body.founderId).toBe(workspace?.ownProfileId)
    expect(body.workspaceName).toBe('Band C')

    delete (import.meta.env as unknown as Record<string, unknown>).VITE_STAGE_SERVER_URL
  })

  it('alerts and does not add the workspace when the Stage-Server is unreachable', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(import.meta.env as any).VITE_STAGE_SERVER_URL = 'https://stage-server:3001'
    stubFetch(null)
    const alertMock = vi.fn().mockResolvedValue(undefined)
    useDialogStore.setState({ alert: alertMock })

    const before = useWorkspaceStore.getState().workspaces.length
    const workspace = await useWorkspaceStore.getState().addWorkspace('Band C')

    expect(workspace).toBeNull()
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(before)
    expect(alertMock).toHaveBeenCalled()

    delete (import.meta.env as unknown as Record<string, unknown>).VITE_STAGE_SERVER_URL
  })

  it('founds the band entirely locally, with no network call, when no Stage-Server is configured (Tier-A local-only founding)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const workspace = await useWorkspaceStore.getState().addWorkspace('Band C')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(workspace).not.toBeNull()
    expect(workspace?.name).toBe('Band C')
    expect(workspace?.isAdmin).toBe(true)
    expect(workspace?.username).toBeUndefined()
    expect(workspace?.couchPassword).toBeUndefined()
    expect(typeof workspace?.ownProfileId).toBe('string')
    expect(useWorkspaceStore.getState().workspaces).toContainEqual(workspace)
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(workspace?.id)
  })
})

describe('connectWorkspace', () => {
  it('provisions the already-locally-founded workspace\'s founder account and stores the returned credentials', async () => {
    useWorkspaceStore.setState({
      workspaces: [{ id: 'band-a', name: 'Band A', ownProfileId: 'founder-id', isAdmin: true }],
      activeWorkspaceId: 'band-a',
    })
    const fetchMock = stubFetch({
      ok: true,
      status: 201,
      json: async () => ({ username: 'stageboard-band-a-founder-id', password: 'founder-pw' }),
    })

    const ok = await useWorkspaceStore.getState().connectWorkspace('band-a', 'https://stage-server:3001')

    expect(ok).toBe(true)
    const workspace = useWorkspaceStore.getState().workspaces.find((w) => w.id === 'band-a')
    expect(workspace?.username).toBe('stageboard-band-a-founder-id')
    expect(workspace?.couchPassword).toBe('founder-pw')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://stage-server:3001/workspaces')
    expect(JSON.parse(init.body)).toEqual({ workspaceId: 'band-a', founderId: 'founder-id', workspaceName: 'Band A' })
  })

  it('alerts and returns false, leaving the workspace local-only, when the server call fails', async () => {
    useWorkspaceStore.setState({
      workspaces: [{ id: 'band-a', name: 'Band A', ownProfileId: 'founder-id', isAdmin: true }],
      activeWorkspaceId: 'band-a',
    })
    stubFetch(null)
    const alertMock = vi.fn().mockResolvedValue(undefined)
    useDialogStore.setState({ alert: alertMock })

    const ok = await useWorkspaceStore.getState().connectWorkspace('band-a', 'https://stage-server:3001')

    expect(ok).toBe(false)
    expect(useWorkspaceStore.getState().workspaces.find((w) => w.id === 'band-a')?.username).toBeUndefined()
    expect(alertMock).toHaveBeenCalled()
  })
})

describe('joinWithPassword', () => {
  it('records the username/password/isAdmin on an already-known workspace and activates it, without touching others', () => {
    useWorkspaceStore.getState().joinWithPassword('band-b', 'stageboard-band-b-p1', 'joined-pw', true)

    const state = useWorkspaceStore.getState()
    const joined = state.workspaces.find((w) => w.id === 'band-b')
    expect(joined?.couchPassword).toBe('joined-pw')
    expect(joined?.username).toBe('stageboard-band-b-p1')
    expect(joined?.isAdmin).toBe(true)
    expect(state.workspaces.find((w) => w.id === 'band-a')?.couchPassword).toBeUndefined()
    expect(state.activeWorkspaceId).toBe('band-b')
  })

  it('adds a brand-new entry (name falls back to the id) for a workspace not known locally yet', () => {
    useWorkspaceStore.getState().joinWithPassword('band-c', 'stageboard-band-c-p1', 'raw-pw', false)

    const state = useWorkspaceStore.getState()
    const added = state.workspaces.find((w) => w.id === 'band-c')
    expect(added).toEqual({
      id: 'band-c',
      name: 'band-c',
      couchPassword: 'raw-pw',
      username: 'stageboard-band-c-p1',
      isAdmin: false,
    })
    expect(state.activeWorkspaceId).toBe('band-c')
  })
})

describe('deleteWorkspace', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(import.meta.env as any).VITE_STAGE_SERVER_URL = 'https://stage-server:3001'
  })

  afterEach(() => {
    delete (import.meta.env as unknown as Record<string, unknown>).VITE_STAGE_SERVER_URL
  })

  it('deletes the workspace via the Stage-Server, removes it locally, and picks a new active workspace', async () => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: 'band-a', name: 'Band A', couchPassword: 'admin-pw', username: 'stageboard-band-a-p1', isAdmin: true },
        { id: 'band-b', name: 'Band B' },
      ],
      activeWorkspaceId: 'band-a',
    })
    const fetchMock = stubFetch({ ok: true, status: 204 })

    const result = await useWorkspaceStore.getState().deleteWorkspace('band-a')

    expect(result).toBe(true)
    const state = useWorkspaceStore.getState()
    expect(state.workspaces.find((w) => w.id === 'band-a')).toBeUndefined()
    expect(state.activeWorkspaceId).toBe('band-b')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://stage-server:3001/workspaces/band-a')
    expect(init.method).toBe('DELETE')
    expect(JSON.parse(init.body)).toEqual({ adminUsername: 'stageboard-band-a-p1', adminPassword: 'admin-pw' })
  })

  it('returns false without calling the Stage-Server for a non-admin workspace', async () => {
    useWorkspaceStore.setState({
      workspaces: [{ id: 'band-a', name: 'Band A', couchPassword: 'member-pw', username: 'stageboard-band-a-p2', isAdmin: false }],
      activeWorkspaceId: 'band-a',
    })
    const fetchMock = stubFetch({ ok: true, status: 204 })

    expect(await useWorkspaceStore.getState().deleteWorkspace('band-a')).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('drops a local-only workspace (no server yet) with no network call - RosterSetupView.tsx\'s "Neu anfangen" relies on this', async () => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: 'band-a', name: 'Band A', ownProfileId: 'founder-id', isAdmin: true },
        { id: 'band-b', name: 'Band B' },
      ],
      activeWorkspaceId: 'band-a',
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await useWorkspaceStore.getState().deleteWorkspace('band-a')

    expect(result).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(useWorkspaceStore.getState().workspaces.find((w) => w.id === 'band-a')).toBeUndefined()
  })

  it('alerts and returns false, keeping the workspace, when the Stage-Server call fails', async () => {
    useWorkspaceStore.setState({
      workspaces: [{ id: 'band-a', name: 'Band A', couchPassword: 'admin-pw', username: 'stageboard-band-a-p1', isAdmin: true }],
      activeWorkspaceId: 'band-a',
    })
    stubFetch(null)
    const alertMock = vi.fn().mockResolvedValue(undefined)
    useDialogStore.setState({ alert: alertMock })

    const result = await useWorkspaceStore.getState().deleteWorkspace('band-a')

    expect(result).toBe(false)
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1)
    expect(alertMock).toHaveBeenCalled()
  })
})

describe('removeWorkspaceLocally (2026-09-02 thirteenth follow-up: the non-destructive, non-admin-gated counterpart to deleteWorkspace)', () => {
  it('drops the workspace locally and picks a new active workspace, with no network call at all', async () => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: 'band-a', name: 'Band A', couchPassword: 'member-pw', username: 'stageboard-band-a-p2', isAdmin: false },
        { id: 'band-b', name: 'Band B' },
      ],
      activeWorkspaceId: 'band-a',
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await useWorkspaceStore.getState().removeWorkspaceLocally('band-a')

    const state = useWorkspaceStore.getState()
    expect(state.workspaces.find((w) => w.id === 'band-a')).toBeUndefined()
    expect(state.activeWorkspaceId).toBe('band-b')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('leaves the active workspace alone when removing a different one', async () => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: 'band-a', name: 'Band A' },
        { id: 'band-b', name: 'Band B' },
      ],
      activeWorkspaceId: 'band-a',
    })

    await useWorkspaceStore.getState().removeWorkspaceLocally('band-b')

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('band-a')
  })

  it('works regardless of isAdmin - unlike deleteWorkspace, this is not an admin-only action', async () => {
    useWorkspaceStore.setState({
      workspaces: [{ id: 'band-a', name: 'Band A', couchPassword: 'member-pw', username: 'stageboard-band-a-p2', isAdmin: false }],
      activeWorkspaceId: 'band-a',
    })

    await useWorkspaceStore.getState().removeWorkspaceLocally('band-a')

    expect(useWorkspaceStore.getState().workspaces).toHaveLength(0)
  })
})

describe('createMember', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(import.meta.env as any).VITE_STAGE_SERVER_URL = 'https://stage-server:3001'
  })

  afterEach(() => {
    delete (import.meta.env as unknown as Record<string, unknown>).VITE_STAGE_SERVER_URL
  })

  it('posts this workspace\'s own credential plus the new member\'s chosen options, and returns the provisioned credential', async () => {
    useWorkspaceStore.setState({
      workspaces: [{ id: 'band-a', name: 'Band A', couchPassword: 'admin-pw', username: 'stageboard-band-a-p1', isAdmin: true }],
    })
    const fetchMock = stubFetch({
      ok: true,
      status: 201,
      json: async () => ({ username: 'stageboard-band-a-p2', password: 'generated-pw' }),
    })

    const result = await useWorkspaceStore.getState().createMember('band-a', { profileId: 'p2', isAdmin: true })

    expect(result).toEqual({ username: 'stageboard-band-a-p2', password: 'generated-pw' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://stage-server:3001/workspaces/band-a/members')
    expect(JSON.parse(init.body)).toEqual({
      adminUsername: 'stageboard-band-a-p1',
      adminPassword: 'admin-pw',
      profileId: 'p2',
      password: undefined,
      isAdmin: true,
    })
  })

  it('returns null without calling the Stage-Server for a non-admin workspace', async () => {
    useWorkspaceStore.setState({
      workspaces: [{ id: 'band-a', name: 'Band A', couchPassword: 'member-pw', username: 'stageboard-band-a-p2', isAdmin: false }],
    })
    const fetchMock = stubFetch({ ok: true, status: 201, json: async () => ({}) })

    expect(await useWorkspaceStore.getState().createMember('band-a', { profileId: 'p3' })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('alerts with a distinct "no longer admin" message on a 403 (not the generic unreachable one), and returns null', async () => {
    useWorkspaceStore.setState({
      workspaces: [{ id: 'band-a', name: 'Band A', couchPassword: 'admin-pw', username: 'stageboard-band-a-p1', isAdmin: true }],
    })
    stubFetch({ ok: false, status: 403 })
    const alertMock = vi.fn().mockResolvedValue(undefined)
    useDialogStore.setState({ alert: alertMock })

    expect(await useWorkspaceStore.getState().createMember('band-a', { profileId: 'p2' })).toBeNull()
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('kein Admin mehr'))
  })
})

describe('setMemberAdmin', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(import.meta.env as any).VITE_STAGE_SERVER_URL = 'https://stage-server:3001'
    useWorkspaceStore.setState({
      workspaces: [{ id: 'band-a', name: 'Band A', couchPassword: 'admin-pw', username: 'stageboard-band-a-p1', isAdmin: true }],
    })
  })

  afterEach(() => {
    delete (import.meta.env as unknown as Record<string, unknown>).VITE_STAGE_SERVER_URL
  })

  it('returns true on success', async () => {
    stubFetch({ ok: true, status: 204 })
    expect(await useWorkspaceStore.getState().setMemberAdmin('band-a', 'p2', true)).toBe(true)
  })

  it('alerts with the specific last-admin message on a 400, and returns false', async () => {
    stubFetch({ ok: false, status: 400 })
    const alertMock = vi.fn().mockResolvedValue(undefined)
    useDialogStore.setState({ alert: alertMock })

    expect(await useWorkspaceStore.getState().setMemberAdmin('band-a', 'p1', false)).toBe(false)
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('Mindestens ein Admin'))
  })

  it('alerts with a distinct "no longer admin" message on a 403 (not the generic unreachable one), and returns false', async () => {
    stubFetch({ ok: false, status: 403 })
    const alertMock = vi.fn().mockResolvedValue(undefined)
    useDialogStore.setState({ alert: alertMock })

    expect(await useWorkspaceStore.getState().setMemberAdmin('band-a', 'p2', true)).toBe(false)
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('kein Admin mehr'))
  })
})

describe('renameWorkspace (#58)', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(import.meta.env as any).VITE_STAGE_SERVER_URL = 'https://stage-server:3001'
  })

  afterEach(() => {
    delete (import.meta.env as unknown as Record<string, unknown>).VITE_STAGE_SERVER_URL
  })

  it('renames a local-only workspace (no username) purely locally, with no network call', async () => {
    useWorkspaceStore.setState({ workspaces: [{ id: 'band-a', name: 'Band A' }] })
    const fetchMock = stubFetch({ ok: true, status: 200 })

    expect(await useWorkspaceStore.getState().renameWorkspace('band-a', 'New Name')).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(useWorkspaceStore.getState().workspaces.find((w) => w.id === 'band-a')?.name).toBe('New Name')
  })

  it('posts to the Stage-Server for a server-connected admin workspace, then updates the name locally', async () => {
    useWorkspaceStore.setState({
      workspaces: [{ id: 'band-a', name: 'Band A', couchPassword: 'admin-pw', username: 'stageboard-band-a-p1', isAdmin: true }],
    })
    const fetchMock = stubFetch({ ok: true, status: 200 })

    expect(await useWorkspaceStore.getState().renameWorkspace('band-a', 'New Name')).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://stage-server:3001/workspaces/band-a/name',
      expect.objectContaining({
        body: JSON.stringify({ adminUsername: 'stageboard-band-a-p1', adminPassword: 'admin-pw', name: 'New Name' }),
      }),
    )
    expect(useWorkspaceStore.getState().workspaces.find((w) => w.id === 'band-a')?.name).toBe('New Name')
  })

  it('returns false without calling the Stage-Server for a non-admin workspace', async () => {
    useWorkspaceStore.setState({
      workspaces: [{ id: 'band-a', name: 'Band A', couchPassword: 'pw', username: 'stageboard-band-a-p2', isAdmin: false }],
    })
    const fetchMock = stubFetch({ ok: true, status: 200 })

    expect(await useWorkspaceStore.getState().renameWorkspace('band-a', 'New Name')).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('alerts with a distinct "no longer admin" message on a 403, and returns false', async () => {
    useWorkspaceStore.setState({
      workspaces: [{ id: 'band-a', name: 'Band A', couchPassword: 'admin-pw', username: 'stageboard-band-a-p1', isAdmin: true }],
    })
    stubFetch({ ok: false, status: 403 })
    const alertMock = vi.fn().mockResolvedValue(undefined)
    useDialogStore.setState({ alert: alertMock })

    expect(await useWorkspaceStore.getState().renameWorkspace('band-a', 'New Name')).toBe(false)
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('kein Admin mehr'))
  })
})

describe('initNameSync (#58)', () => {
  it('seeds the workspace name from the local workspace:access doc if it differs, and starts watching for future changes', async () => {
    useWorkspaceStore.setState({ workspaces: [{ id: 'band-a', name: 'Stale Name' }] })
    getWorkspaceAccessDoc.mockResolvedValue({ code: '12345678', name: 'Fresh Name' })

    await useWorkspaceStore.getState().initNameSync('band-a')

    expect(useWorkspaceStore.getState().workspaces.find((w) => w.id === 'band-a')?.name).toBe('Fresh Name')
    expect(watchWorkspaceAccessDoc).toHaveBeenCalledWith('band-a', expect.any(Function))
  })

  it('applies a later remote rename picked up by the live watcher', async () => {
    useWorkspaceStore.setState({ workspaces: [{ id: 'band-a', name: 'Band A' }] })
    getWorkspaceAccessDoc.mockResolvedValue(null)
    let onChange: ((doc: { code: string; name: string }) => void) | undefined
    watchWorkspaceAccessDoc.mockImplementation((_workspaceId: string, cb: (doc: { code: string; name: string }) => void) => {
      onChange = cb
      return { on: () => {}, cancel: () => {} }
    })

    await useWorkspaceStore.getState().initNameSync('band-a')
    onChange?.({ code: '12345678', name: 'Renamed By Another Device' })

    expect(useWorkspaceStore.getState().workspaces.find((w) => w.id === 'band-a')?.name).toBe('Renamed By Another Device')
  })

  it('cancels the previous watcher when called again for a new workspace', async () => {
    const cancel = vi.fn()
    watchWorkspaceAccessDoc.mockReturnValueOnce({ on: () => {}, cancel })

    await useWorkspaceStore.getState().initNameSync('band-a')
    await useWorkspaceStore.getState().initNameSync('band-b')

    expect(cancel).toHaveBeenCalled()
  })
})

describe('setLocalAdminFlag', () => {
  it('flips isAdmin on the named workspace, locally, without any network call', () => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: 'band-a', name: 'Band A', isAdmin: true },
        { id: 'band-b', name: 'Band B', isAdmin: true },
      ],
    })

    useWorkspaceStore.getState().setLocalAdminFlag('band-a', false)

    const workspaces = useWorkspaceStore.getState().workspaces
    expect(workspaces.find((w) => w.id === 'band-a')?.isAdmin).toBe(false)
    expect(workspaces.find((w) => w.id === 'band-b')?.isAdmin).toBe(true)
  })
})

describe('removeMember', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(import.meta.env as any).VITE_STAGE_SERVER_URL = 'https://stage-server:3001'
    useWorkspaceStore.setState({
      workspaces: [{ id: 'band-a', name: 'Band A', couchPassword: 'admin-pw', username: 'stageboard-band-a-p1', isAdmin: true }],
    })
  })

  afterEach(() => {
    delete (import.meta.env as unknown as Record<string, unknown>).VITE_STAGE_SERVER_URL
  })

  it('returns true on success', async () => {
    stubFetch({ ok: true, status: 204 })
    expect(await useWorkspaceStore.getState().removeMember('band-a', 'p2')).toBe(true)
  })

  it('alerts with the specific last-admin message on a 400, and returns false', async () => {
    stubFetch({ ok: false, status: 400 })
    const alertMock = vi.fn().mockResolvedValue(undefined)
    useDialogStore.setState({ alert: alertMock })

    expect(await useWorkspaceStore.getState().removeMember('band-a', 'p1')).toBe(false)
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('Mindestens ein Admin'))
  })

  it('alerts with a distinct "no longer admin" message on a 403 (not the generic unreachable one), and returns false', async () => {
    stubFetch({ ok: false, status: 403 })
    const alertMock = vi.fn().mockResolvedValue(undefined)
    useDialogStore.setState({ alert: alertMock })

    expect(await useWorkspaceStore.getState().removeMember('band-a', 'p2')).toBe(false)
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('kein Admin mehr'))
  })
})

describe('resetMemberPassword', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(import.meta.env as any).VITE_STAGE_SERVER_URL = 'https://stage-server:3001'
    useWorkspaceStore.setState({
      workspaces: [{ id: 'band-a', name: 'Band A', couchPassword: 'admin-pw', username: 'stageboard-band-a-p1', isAdmin: true }],
    })
  })

  afterEach(() => {
    delete (import.meta.env as unknown as Record<string, unknown>).VITE_STAGE_SERVER_URL
  })

  it('posts this workspace\'s own admin credential and returns the freshly reset credentials', async () => {
    const fetchMock = stubFetch({
      ok: true,
      status: 200,
      json: async () => ({ username: 'stageboard-band-a-p2', password: 'new-random-pw' }),
    })

    const credentials = await useWorkspaceStore.getState().resetMemberPassword('band-a', 'p2')

    expect(credentials).toEqual({ username: 'stageboard-band-a-p2', password: 'new-random-pw' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://stage-server:3001/workspaces/band-a/members/p2/reset-password')
    expect(JSON.parse(init.body)).toEqual({ adminUsername: 'stageboard-band-a-p1', adminPassword: 'admin-pw' })
  })

  it('alerts with a distinct "no longer admin" message on a 403, and returns null', async () => {
    stubFetch({ ok: false, status: 403 })
    const alertMock = vi.fn().mockResolvedValue(undefined)
    useDialogStore.setState({ alert: alertMock })

    expect(await useWorkspaceStore.getState().resetMemberPassword('band-a', 'p2')).toBeNull()
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('kein Admin mehr'))
  })

  it('returns null without calling the Stage-Server for a non-admin workspace', async () => {
    useWorkspaceStore.setState({
      workspaces: [{ id: 'band-a', name: 'Band A', couchPassword: 'member-pw', username: 'stageboard-band-a-p2', isAdmin: false }],
    })
    const fetchMock = stubFetch({ ok: true, status: 200, json: async () => ({}) })

    expect(await useWorkspaceStore.getState().resetMemberPassword('band-a', 'p2')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('2026-09-02 second follow-up: alerts with a distinct "only admin accounts" message on a 400 (non-admin target)', async () => {
    stubFetch({ ok: false, status: 400 })
    const alertMock = vi.fn().mockResolvedValue(undefined)
    useDialogStore.setState({ alert: alertMock })

    expect(await useWorkspaceStore.getState().resetMemberPassword('band-a', 'p2')).toBeNull()
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('Nur Admin-Konten'))
  })
})

describe('setOwnPin (2026-09-02 second follow-up: admin self-service PIN assignment)', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(import.meta.env as any).VITE_STAGE_SERVER_URL = 'https://stage-server:3001'
    useWorkspaceStore.setState({
      workspaces: [{ id: 'band-a', name: 'Band A', couchPassword: 'old-pin', username: 'stageboard-band-a-p1', isAdmin: true }],
    })
  })

  afterEach(() => {
    delete (import.meta.env as unknown as Record<string, unknown>).VITE_STAGE_SERVER_URL
  })

  it('posts this device\'s own current credentials as proof, and updates the stored credentials on success', async () => {
    const fetchMock = stubFetch({
      ok: true,
      status: 200,
      json: async () => ({ username: 'stageboard-band-a-p1', password: '9876', isAdmin: true }),
    })

    const result = await useWorkspaceStore.getState().setOwnPin('band-a', 'p1', '9876')

    expect(result).toEqual({ username: 'stageboard-band-a-p1', password: '9876' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://stage-server:3001/workspaces/band-a/members/p1/set-pin')
    expect(JSON.parse(init.body)).toEqual({ callerUsername: 'stageboard-band-a-p1', callerPassword: 'old-pin', newPin: '9876' })
    expect(useWorkspaceStore.getState().workspaces).toContainEqual(
      expect.objectContaining({ id: 'band-a', couchPassword: '9876', username: 'stageboard-band-a-p1' }),
    )
  })

  it('alerts with a distinct message on a 403 (wrong current PIN, or not this profile anymore)', async () => {
    stubFetch({ ok: false, status: 403 })
    const alertMock = vi.fn().mockResolvedValue(undefined)
    useDialogStore.setState({ alert: alertMock })

    expect(await useWorkspaceStore.getState().setOwnPin('band-a', 'p1', '9876')).toBeNull()
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('Aktuelles Passwort falsch'))
  })

  it('alerts with a distinct message on a 400 (invalid PIN format)', async () => {
    stubFetch({ ok: false, status: 400 })
    const alertMock = vi.fn().mockResolvedValue(undefined)
    useDialogStore.setState({ alert: alertMock })

    expect(await useWorkspaceStore.getState().setOwnPin('band-a', 'p1', '12345')).toBeNull()
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('4 Ziffern'))
  })

  it('returns null without calling the Stage-Server when this workspace has no stored credentials at all', async () => {
    useWorkspaceStore.setState({ workspaces: [{ id: 'band-a', name: 'Band A' }] })
    const fetchMock = stubFetch({ ok: true, status: 200, json: async () => ({}) })

    expect(await useWorkspaceStore.getState().setOwnPin('band-a', 'p1', '9876')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('alerts with a distinct network-failure message when fetch itself throws', async () => {
    stubFetch(null)
    const alertMock = vi.fn().mockResolvedValue(undefined)
    useDialogStore.setState({ alert: alertMock })

    expect(await useWorkspaceStore.getState().setOwnPin('band-a', 'p1', '9876')).toBeNull()
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('nicht erreichbar'))
  })
})

describe('getAccessCode / rotateAccessCode (2026-09-01 WiFi-style redesign)', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(import.meta.env as any).VITE_STAGE_SERVER_URL = 'https://stage-server:3001'
    useWorkspaceStore.setState({
      workspaces: [{ id: 'band-a', name: 'Band A', couchPassword: 'admin-pw', username: 'stageboard-band-a-p1', isAdmin: true }],
    })
  })

  afterEach(() => {
    delete (import.meta.env as unknown as Record<string, unknown>).VITE_STAGE_SERVER_URL
  })

  it('getAccessCode posts this workspace\'s own admin credential and returns the current standing code', async () => {
    const fetchMock = stubFetch({ ok: true, status: 200, json: async () => ({ code: '12345678' }) })

    const result = await useWorkspaceStore.getState().getAccessCode('band-a')

    expect(result).toEqual({ code: '12345678' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://stage-server:3001/workspaces/band-a/access-code')
    expect(JSON.parse(init.body)).toEqual({ adminUsername: 'stageboard-band-a-p1', adminPassword: 'admin-pw' })
  })

  it('getAccessCode returns null without calling the Stage-Server for a non-admin workspace', async () => {
    useWorkspaceStore.setState({
      workspaces: [{ id: 'band-a', name: 'Band A', couchPassword: 'member-pw', username: 'stageboard-band-a-p2', isAdmin: false }],
    })
    const fetchMock = stubFetch({ ok: true, status: 200, json: async () => ({}) })

    expect(await useWorkspaceStore.getState().getAccessCode('band-a')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('getAccessCode returns null when the Stage-Server is unreachable', async () => {
    stubFetch(null)

    expect(await useWorkspaceStore.getState().getAccessCode('band-a')).toBeNull()
  })

  it('rotateAccessCode posts to the rotate route and returns the fresh code', async () => {
    const fetchMock = stubFetch({ ok: true, status: 200, json: async () => ({ code: '87654321' }) })

    const result = await useWorkspaceStore.getState().rotateAccessCode('band-a')

    expect(result).toEqual({ code: '87654321' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://stage-server:3001/workspaces/band-a/access-code/rotate')
    expect(JSON.parse(init.body)).toEqual({ adminUsername: 'stageboard-band-a-p1', adminPassword: 'admin-pw' })
  })

  it('rotateAccessCode alerts and returns null when the Stage-Server is unreachable', async () => {
    stubFetch(null)
    const alertMock = vi.fn().mockResolvedValue(undefined)
    useDialogStore.setState({ alert: alertMock })

    const result = await useWorkspaceStore.getState().rotateAccessCode('band-a')

    expect(result).toBeNull()
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('nicht erreichbar'))
  })
})

describe('listWorkspaces', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(import.meta.env as any).VITE_STAGE_SERVER_URL = 'https://stage-server:3001'
  })

  afterEach(() => {
    delete (import.meta.env as unknown as Record<string, unknown>).VITE_STAGE_SERVER_URL
  })

  it('fetches every workspace the Stage-Server hosts, with no code and no auth', async () => {
    const fetchMock = stubFetch({
      ok: true,
      status: 200,
      json: async () => [
        { workspaceId: 'band-a', workspaceName: 'Band A' },
        { workspaceId: 'ggh', workspaceName: 'ggh' },
      ],
    })

    const result = await useWorkspaceStore.getState().listWorkspaces()

    expect(result).toEqual([
      { workspaceId: 'band-a', workspaceName: 'Band A' },
      { workspaceId: 'ggh', workspaceName: 'ggh' },
    ])
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://stage-server:3001/workspaces')
    expect(init).toBeUndefined()
  })

  it('alerts and returns null when no Stage-Server is configured', async () => {
    delete (import.meta.env as unknown as Record<string, unknown>).VITE_STAGE_SERVER_URL
    const alertMock = vi.fn().mockResolvedValue(undefined)
    useDialogStore.setState({ alert: alertMock })

    const result = await useWorkspaceStore.getState().listWorkspaces()

    expect(result).toBeNull()
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('nicht konfiguriert'))
  })

  it('alerts with a distinct network-failure message when fetch itself throws', async () => {
    stubFetch(null)
    const alertMock = vi.fn().mockResolvedValue(undefined)
    useDialogStore.setState({ alert: alertMock })

    const result = await useWorkspaceStore.getState().listWorkspaces()

    expect(result).toBeNull()
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('nicht erreichbar'))
  })

  it('alerts with a distinct server-error message for a non-ok response', async () => {
    stubFetch({ ok: false, status: 500 })
    const alertMock = vi.fn().mockResolvedValue(undefined)
    useDialogStore.setState({ alert: alertMock })

    const result = await useWorkspaceStore.getState().listWorkspaces()

    expect(result).toBeNull()
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('Serverfehler'))
  })
})

describe('fetchRoster', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(import.meta.env as any).VITE_STAGE_SERVER_URL = 'https://stage-server:3001'
  })

  afterEach(() => {
    delete (import.meta.env as unknown as Record<string, unknown>).VITE_STAGE_SERVER_URL
  })

  it('resolves the workspace + code to its roster, without touching local state', async () => {
    const fetchMock = stubFetch({
      ok: true,
      status: 200,
      json: async () => ({
        workspaceId: 'band-c',
        workspaceName: 'Band C',
        members: [{ profileId: 'p1', name: 'Marco', isAdmin: false }],
      }),
    })

    const roster = await useWorkspaceStore.getState().fetchRoster('band-c', '11112222')

    expect(roster).toEqual({
      workspaceId: 'band-c',
      workspaceName: 'Band C',
      members: [{ profileId: 'p1', name: 'Marco', isAdmin: false }],
    })
    expect(useWorkspaceStore.getState().workspaces).not.toContainEqual(expect.objectContaining({ id: 'band-c' }))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://stage-server:3001/workspaces/band-c/roster')
    expect(JSON.parse(init.body)).toEqual({ code: '11112222' })
  })

  it('alerts with "Falscher Code" and returns null for a wrong code', async () => {
    stubFetch({ ok: false, status: 403 })
    const alertMock = vi.fn().mockResolvedValue(undefined)
    useDialogStore.setState({ alert: alertMock })

    const roster = await useWorkspaceStore.getState().fetchRoster('band-c', '00000000')

    expect(roster).toBeNull()
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('Falscher Code'))
  })

  it('alerts with a distinct network-failure message when fetch itself throws, not "Falscher Code"', async () => {
    stubFetch(null) // simulates fetch() rejecting, e.g. TypeError: Failed to fetch
    const alertMock = vi.fn().mockResolvedValue(undefined)
    useDialogStore.setState({ alert: alertMock })

    const roster = await useWorkspaceStore.getState().fetchRoster('band-c', '11112222')

    expect(roster).toBeNull()
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('nicht erreichbar'))
    expect(alertMock).not.toHaveBeenCalledWith(expect.stringContaining('Falscher Code'))
  })

  it('alerts with a distinct server-error message for a non-403 failure response', async () => {
    stubFetch({ ok: false, status: 500 })
    const alertMock = vi.fn().mockResolvedValue(undefined)
    useDialogStore.setState({ alert: alertMock })

    const roster = await useWorkspaceStore.getState().fetchRoster('band-c', '11112222')

    expect(roster).toBeNull()
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('Serverfehler'))
    expect(alertMock).not.toHaveBeenCalledWith(expect.stringContaining('Falscher Code'))
  })
})

describe('joinAsMember', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(import.meta.env as any).VITE_STAGE_SERVER_URL = 'https://stage-server:3001'
  })

  afterEach(() => {
    delete (import.meta.env as unknown as Record<string, unknown>).VITE_STAGE_SERVER_URL
  })

  it('posts the code, optional password, and profileId; adds the workspace with the resolved credentials; and activates it', async () => {
    const fetchMock = stubFetch({
      ok: true,
      status: 200,
      json: async () => ({ username: 'stageboard-band-c-p2', password: 'member-pw', isAdmin: false }),
    })

    const workspace = await useWorkspaceStore.getState().joinAsMember('band-c', 'Band C', '11112222', 'p2', 'their-pin')

    expect(workspace).toEqual({
      id: 'band-c',
      name: 'Band C',
      couchPassword: 'member-pw',
      username: 'stageboard-band-c-p2',
      isAdmin: false,
    })
    const state = useWorkspaceStore.getState()
    expect(state.workspaces).toContainEqual(workspace)
    expect(state.activeWorkspaceId).toBe('band-c')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://stage-server:3001/workspaces/band-c/join/p2')
    expect(JSON.parse(init.body)).toEqual({ code: '11112222', password: 'their-pin', deviceId: expect.any(String) })
  })

  it('resolves with isAdmin: true when the picked account holds the admin role', async () => {
    stubFetch({
      ok: true,
      status: 200,
      json: async () => ({ username: 'stageboard-band-c-p1', password: 'admin-pw', isAdmin: true }),
    })

    const workspace = await useWorkspaceStore.getState().joinAsMember('band-c', 'Band C', '33334444', 'p1', 'admin-pw')

    expect(workspace?.isAdmin).toBe(true)
  })

  it('leaving the password blank still joins - it is the code-based recovery path, not an error', async () => {
    const fetchMock = stubFetch({
      ok: true,
      status: 200,
      json: async () => ({ username: 'stageboard-band-c-p1', password: 'fresh-recovered-pw', isAdmin: true }),
    })

    const workspace = await useWorkspaceStore.getState().joinAsMember('band-c', 'Band C', '11112222', 'p1')

    expect(workspace?.couchPassword).toBe('fresh-recovered-pw')
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ code: '11112222', password: undefined, deviceId: expect.any(String) })
  })

  it('alerts with a distinct "wrong code/password" message on a 403, and returns null', async () => {
    stubFetch({ ok: false, status: 403 })
    const alertMock = vi.fn().mockResolvedValue(undefined)
    useDialogStore.setState({ alert: alertMock })

    const workspace = await useWorkspaceStore.getState().joinAsMember('band-c', 'Band C', '11112222', 'p1', 'wrong')

    expect(workspace).toBeNull()
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('Falscher Code oder falsches Passwort'))
  })

  it('alerts with "Unbekanntes Mitglied" and returns null for a 404', async () => {
    stubFetch({ ok: false, status: 404 })
    const alertMock = vi.fn().mockResolvedValue(undefined)
    useDialogStore.setState({ alert: alertMock })

    const workspace = await useWorkspaceStore.getState().joinAsMember('band-c', 'Band C', '11112222', 'unknown-profile')

    expect(workspace).toBeNull()
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('Unbekanntes Mitglied'))
  })

  it('alerts with a distinct network-failure message when fetch itself throws', async () => {
    stubFetch(null) // simulates fetch() rejecting, e.g. TypeError: Failed to fetch
    const alertMock = vi.fn().mockResolvedValue(undefined)
    useDialogStore.setState({ alert: alertMock })

    const workspace = await useWorkspaceStore.getState().joinAsMember('band-c', 'Band C', '11112222', 'p1')

    expect(workspace).toBeNull()
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('nicht erreichbar'))
    expect(alertMock).not.toHaveBeenCalledWith(expect.stringContaining('Falscher Code'))
  })

  it('alerts with a distinct server-error message for a non-403/404 failure response', async () => {
    stubFetch({ ok: false, status: 500 })
    const alertMock = vi.fn().mockResolvedValue(undefined)
    useDialogStore.setState({ alert: alertMock })

    const workspace = await useWorkspaceStore.getState().joinAsMember('band-c', 'Band C', '11112222', 'p1')

    expect(workspace).toBeNull()
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('Serverfehler'))
    expect(alertMock).not.toHaveBeenCalledWith(expect.stringContaining('Falscher Code'))
  })
})
