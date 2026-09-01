import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDialogStore } from './useDialogStore'
import { useWorkspaceStore } from './useWorkspaceStore'

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
    expect(JSON.parse(init.body)).toEqual({ workspaceId: 'band-a', founderId: 'founder-id' })
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
})

describe('createInvite (2026-09-01 redesign: workspace-level, not per-person)', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(import.meta.env as any).VITE_STAGE_SERVER_URL = 'https://stage-server:3001'
  })

  afterEach(() => {
    delete (import.meta.env as unknown as Record<string, unknown>).VITE_STAGE_SERVER_URL
  })

  it('posts this workspace\'s own admin credential and name, and returns the minted code', async () => {
    useWorkspaceStore.setState({
      workspaces: [{ id: 'band-a', name: 'Band A', couchPassword: 'admin-pw', username: 'stageboard-band-a-p1', isAdmin: true }],
    })
    const fetchMock = stubFetch({
      ok: true,
      status: 201,
      json: async () => ({ code: '12345678', expiresAt: 1234567890 }),
    })

    const invite = await useWorkspaceStore.getState().createInvite('band-a')

    expect(invite).toEqual({ code: '12345678', expiresAt: 1234567890 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://stage-server:3001/workspaces/band-a/invite')
    expect(JSON.parse(init.body)).toEqual({
      adminUsername: 'stageboard-band-a-p1',
      adminPassword: 'admin-pw',
      workspaceName: 'Band A',
    })
  })

  it('returns null without calling the Stage-Server for a non-admin workspace', async () => {
    useWorkspaceStore.setState({
      workspaces: [{ id: 'band-a', name: 'Band A', couchPassword: 'member-pw', username: 'stageboard-band-a-p2', isAdmin: false }],
    })
    const fetchMock = stubFetch({ ok: true, status: 201, json: async () => ({}) })

    expect(await useWorkspaceStore.getState().createInvite('band-a')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
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

  it('resolves the code to the workspace roster, without touching local state', async () => {
    const fetchMock = stubFetch({
      ok: true,
      status: 200,
      json: async () => ({
        workspaceId: 'band-c',
        workspaceName: 'Band C',
        members: [{ profileId: 'p1', name: 'Marco', role: 'Gitarre', requiresPassword: true }],
      }),
    })

    const roster = await useWorkspaceStore.getState().fetchRoster('11112222')

    expect(roster).toEqual({
      workspaceId: 'band-c',
      workspaceName: 'Band C',
      members: [{ profileId: 'p1', name: 'Marco', role: 'Gitarre', requiresPassword: true }],
    })
    expect(useWorkspaceStore.getState().workspaces).not.toContainEqual(expect.objectContaining({ id: 'band-c' }))
    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe('https://stage-server:3001/invites/11112222/roster')
  })

  it('alerts and returns null for an invalid/expired code', async () => {
    stubFetch({ ok: false, status: 404 })
    const alertMock = vi.fn().mockResolvedValue(undefined)
    useDialogStore.setState({ alert: alertMock })

    const roster = await useWorkspaceStore.getState().fetchRoster('00000000')

    expect(roster).toBeNull()
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('Code ungültig'))
  })

  it('alerts with a distinct network-failure message when fetch itself throws, not "Code ungültig"', async () => {
    stubFetch(null) // simulates fetch() rejecting, e.g. TypeError: Failed to fetch
    const alertMock = vi.fn().mockResolvedValue(undefined)
    useDialogStore.setState({ alert: alertMock })

    const roster = await useWorkspaceStore.getState().fetchRoster('11112222')

    expect(roster).toBeNull()
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('nicht erreichbar'))
    expect(alertMock).not.toHaveBeenCalledWith(expect.stringContaining('Code ungültig'))
  })

  it('alerts with a distinct server-error message for a non-404 failure response', async () => {
    stubFetch({ ok: false, status: 500 })
    const alertMock = vi.fn().mockResolvedValue(undefined)
    useDialogStore.setState({ alert: alertMock })

    const roster = await useWorkspaceStore.getState().fetchRoster('11112222')

    expect(roster).toBeNull()
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('Serverfehler'))
    expect(alertMock).not.toHaveBeenCalledWith(expect.stringContaining('Code ungültig'))
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

  it('posts the code, profileId, and password; adds the workspace with the resolved credentials; and activates it', async () => {
    const fetchMock = stubFetch({
      ok: true,
      status: 200,
      json: async () => ({ username: 'stageboard-band-c-p2', password: 'member-pw', isAdmin: false }),
    })

    const workspace = await useWorkspaceStore.getState().joinAsMember('11112222', 'band-c', 'Band C', 'p2', 'their-pin')

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
    expect(url).toBe('https://stage-server:3001/invites/11112222/join/p2')
    expect(JSON.parse(init.body)).toEqual({ password: 'their-pin' })
  })

  it('resolves with isAdmin: true when the picked account holds the admin role', async () => {
    stubFetch({
      ok: true,
      status: 200,
      json: async () => ({ username: 'stageboard-band-c-p1', password: 'admin-pw', isAdmin: true }),
    })

    const workspace = await useWorkspaceStore.getState().joinAsMember('33334444', 'band-c', 'Band C', 'p1', 'admin-pw')

    expect(workspace?.isAdmin).toBe(true)
  })

  it('alerts with a distinct "wrong password" message on a 403, and returns null', async () => {
    stubFetch({ ok: false, status: 403 })
    const alertMock = vi.fn().mockResolvedValue(undefined)
    useDialogStore.setState({ alert: alertMock })

    const workspace = await useWorkspaceStore.getState().joinAsMember('11112222', 'band-c', 'Band C', 'p1', 'wrong')

    expect(workspace).toBeNull()
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('Falsches Passwort'))
  })

  it('alerts and returns null for an invalid/expired code', async () => {
    stubFetch({ ok: false, status: 404 })
    const alertMock = vi.fn().mockResolvedValue(undefined)
    useDialogStore.setState({ alert: alertMock })

    const workspace = await useWorkspaceStore.getState().joinAsMember('00000000', 'band-c', 'Band C', 'p1')

    expect(workspace).toBeNull()
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('Code ungültig'))
  })

  it('alerts with a distinct network-failure message when fetch itself throws, not "Code ungültig"', async () => {
    stubFetch(null) // simulates fetch() rejecting, e.g. TypeError: Failed to fetch
    const alertMock = vi.fn().mockResolvedValue(undefined)
    useDialogStore.setState({ alert: alertMock })

    const workspace = await useWorkspaceStore.getState().joinAsMember('11112222', 'band-c', 'Band C', 'p1')

    expect(workspace).toBeNull()
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('nicht erreichbar'))
    expect(alertMock).not.toHaveBeenCalledWith(expect.stringContaining('Code ungültig'))
  })

  it('alerts with a distinct server-error message for a non-404 failure response', async () => {
    stubFetch({ ok: false, status: 500 })
    const alertMock = vi.fn().mockResolvedValue(undefined)
    useDialogStore.setState({ alert: alertMock })

    const workspace = await useWorkspaceStore.getState().joinAsMember('11112222', 'band-c', 'Band C', 'p1')

    expect(workspace).toBeNull()
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('Serverfehler'))
    expect(alertMock).not.toHaveBeenCalledWith(expect.stringContaining('Code ungültig'))
  })
})
