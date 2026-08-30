import { beforeEach, describe, expect, it, vi } from 'vitest'

// useProfilesStore transitively imports workspaceDb.ts (via useWorkspaceStore), which
// constructs a real PouchDB at module load time - unavailable under happy-dom (see
// workspaceDb.test.ts's identical mock).
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const putProfile = vi.fn()
const removeProfileDb = vi.fn()
vi.mock('../lib/profilesDb', () => ({
  getAllProfiles: vi.fn().mockResolvedValue([]),
  putProfile: (...args: unknown[]) => putProfile(...args),
  removeProfile: (...args: unknown[]) => removeProfileDb(...args),
  switchProfilesWorkspace: vi.fn(),
  profilesChanges: vi.fn(() => ({ on: () => {}, cancel: () => {} })),
}))

vi.mock('../lib/id', () => ({ randomId: () => 'new-profile-id' }))

const { useProfilesStore } = await import('./useProfilesStore')
const { useWorkspaceStore } = await import('./useWorkspaceStore')

beforeEach(() => {
  putProfile.mockReset().mockResolvedValue(undefined)
  removeProfileDb.mockReset().mockResolvedValue(undefined)
  useWorkspaceStore.setState({
    // username/couchPassword set: these tests exercise the already-server-connected roster
    // path by default (this is the pre-Tier-A-follow-up, already-established behavior) - the
    // "local-only" branch (no server yet) gets its own dedicated tests further below.
    workspaces: [
      {
        id: 'band-a',
        name: 'Band A',
        ownProfileId: 'founder-id',
        isAdmin: true,
        username: 'stageboard-band-a-founder-id',
        couchPassword: 'founder-pw',
      },
    ],
    activeWorkspaceId: 'band-a',
    createMember: vi.fn(),
    setMemberAdmin: vi.fn(),
    removeMember: vi.fn(),
    connectWorkspace: vi.fn(),
  })
  useProfilesStore.setState({ profiles: [], loaded: false })
})

describe('useProfilesStore', () => {
  describe('create', () => {
    it('for the very first profile, reuses the workspace\'s own already-provisioned account - no backend call', async () => {
      const createMember = vi.fn()
      useWorkspaceStore.setState({ createMember })

      const result = await useProfilesStore.getState().create('Marco', 'Gitarre')

      expect(createMember).not.toHaveBeenCalled()
      expect(result).toEqual({
        profile: { id: 'founder-id', name: 'Marco', role: 'Gitarre', stageRoles: ['admin'] },
        credentials: null,
      })
      expect(putProfile).toHaveBeenCalledWith({ id: 'founder-id', name: 'Marco', role: 'Gitarre', stageRoles: ['admin'] })
    })

    it('for a 2nd+ profile, provisions a real account via createMember before writing the roster doc', async () => {
      useProfilesStore.setState({ profiles: [{ id: 'p1', name: 'Marco', role: 'Gitarre', stageRoles: ['admin'] }] })
      const credentials = { username: 'stageboard-band-a-new-profile-id', password: 'secret' }
      const createMember = vi.fn().mockResolvedValue(credentials)
      useWorkspaceStore.setState({ createMember })

      const result = await useProfilesStore.getState().create('Chris', 'Bass', { password: '4711' })

      expect(createMember).toHaveBeenCalledWith('band-a', { profileId: 'new-profile-id', password: '4711', isAdmin: undefined })
      expect(result).toEqual({
        profile: { id: 'new-profile-id', name: 'Chris', role: 'Bass', stageRoles: [] },
        credentials,
      })
      expect(putProfile).toHaveBeenCalledWith({ id: 'new-profile-id', name: 'Chris', role: 'Bass', stageRoles: [] })
    })

    it('returns null and never writes a roster doc when provisioning the account fails', async () => {
      useProfilesStore.setState({ profiles: [{ id: 'p1', name: 'Marco', role: 'Gitarre', stageRoles: ['admin'] }] })
      useWorkspaceStore.setState({ createMember: vi.fn().mockResolvedValue(null) })

      const result = await useProfilesStore.getState().create('Chris', 'Bass')

      expect(result).toBeNull()
      expect(putProfile).not.toHaveBeenCalled()
    })

    it('for a 2nd+ profile on a local-only workspace (no server yet), stays a plain local write - no backend call', async () => {
      useWorkspaceStore.setState({
        workspaces: [{ id: 'band-a', name: 'Band A', ownProfileId: 'founder-id', isAdmin: true }],
      })
      useProfilesStore.setState({ profiles: [{ id: 'founder-id', name: 'Marco', role: 'Gitarre', stageRoles: ['admin'] }] })
      const createMember = vi.fn()
      useWorkspaceStore.setState({ createMember })

      const result = await useProfilesStore.getState().create('Chris', 'Bass', { password: '4711' })

      expect(createMember).not.toHaveBeenCalled()
      expect(result).toEqual({
        profile: { id: 'new-profile-id', name: 'Chris', role: 'Bass', stageRoles: [] },
        credentials: null,
      })
      expect(putProfile).toHaveBeenCalledWith({ id: 'new-profile-id', name: 'Chris', role: 'Bass', stageRoles: [] })
    })
  })

  describe('updateStageRoles', () => {
    it('when the admin bit is unchanged, writes the roster doc directly - no backend call', async () => {
      useProfilesStore.setState({ profiles: [{ id: 'p1', name: 'Marco', role: 'Gitarre', stageRoles: ['performer'] }] })
      const setMemberAdmin = vi.fn()
      useWorkspaceStore.setState({ setMemberAdmin })

      const ok = await useProfilesStore.getState().updateStageRoles('p1', ['performer', 'soundtech'])

      expect(setMemberAdmin).not.toHaveBeenCalled()
      expect(ok).toBe(true)
      expect(putProfile).toHaveBeenCalledWith({ id: 'p1', name: 'Marco', role: 'Gitarre', stageRoles: ['performer', 'soundtech'] })
    })

    it('when granting admin, calls setMemberAdmin(true) first, then writes the roster doc', async () => {
      useProfilesStore.setState({ profiles: [{ id: 'p1', name: 'Marco', role: 'Gitarre', stageRoles: [] }] })
      const setMemberAdmin = vi.fn().mockResolvedValue(true)
      useWorkspaceStore.setState({ setMemberAdmin })

      const ok = await useProfilesStore.getState().updateStageRoles('p1', ['admin'])

      expect(setMemberAdmin).toHaveBeenCalledWith('band-a', 'p1', true)
      expect(ok).toBe(true)
      expect(putProfile).toHaveBeenCalledWith({ id: 'p1', name: 'Marco', role: 'Gitarre', stageRoles: ['admin'] })
    })

    it('when the profile being changed is this device\'s own (ownProfileId), also syncs the local isAdmin UI flag via setLocalAdminFlag', async () => {
      useProfilesStore.setState({ profiles: [{ id: 'founder-id', name: 'Marco', role: 'Gitarre', stageRoles: ['admin'] }] })
      const setMemberAdmin = vi.fn().mockResolvedValue(true)
      const setLocalAdminFlag = vi.fn()
      useWorkspaceStore.setState({ setMemberAdmin, setLocalAdminFlag })

      const ok = await useProfilesStore.getState().updateStageRoles('founder-id', [])

      expect(ok).toBe(true)
      expect(setLocalAdminFlag).toHaveBeenCalledWith('band-a', false)
    })

    it('does not touch the local isAdmin flag when the profile being changed is someone else\'s', async () => {
      useProfilesStore.setState({
        profiles: [
          { id: 'founder-id', name: 'Marco', role: 'Gitarre', stageRoles: ['admin'] },
          { id: 'p2', name: 'Chris', role: 'Bass', stageRoles: [] },
        ],
      })
      const setMemberAdmin = vi.fn().mockResolvedValue(true)
      const setLocalAdminFlag = vi.fn()
      useWorkspaceStore.setState({ setMemberAdmin, setLocalAdminFlag })

      await useProfilesStore.getState().updateStageRoles('p2', ['admin'])

      expect(setLocalAdminFlag).not.toHaveBeenCalled()
    })

    it('when revoking the sole remaining admin, setMemberAdmin rejects and the roster doc is never written', async () => {
      useProfilesStore.setState({ profiles: [{ id: 'p1', name: 'Marco', role: 'Gitarre', stageRoles: ['admin'] }] })
      const setMemberAdmin = vi.fn().mockResolvedValue(false)
      useWorkspaceStore.setState({ setMemberAdmin })

      const ok = await useProfilesStore.getState().updateStageRoles('p1', [])

      expect(setMemberAdmin).toHaveBeenCalledWith('band-a', 'p1', false)
      expect(ok).toBe(false)
      expect(putProfile).not.toHaveBeenCalled()
    })

    it('on a local-only workspace (no server yet), toggling admin is a plain local edit - no backend call', async () => {
      useWorkspaceStore.setState({
        workspaces: [{ id: 'band-a', name: 'Band A', ownProfileId: 'founder-id', isAdmin: true }],
      })
      useProfilesStore.setState({ profiles: [{ id: 'p1', name: 'Marco', role: 'Gitarre', stageRoles: [] }] })
      const setMemberAdmin = vi.fn()
      useWorkspaceStore.setState({ setMemberAdmin })

      const ok = await useProfilesStore.getState().updateStageRoles('p1', ['admin'])

      expect(setMemberAdmin).not.toHaveBeenCalled()
      expect(ok).toBe(true)
      expect(putProfile).toHaveBeenCalledWith({ id: 'p1', name: 'Marco', role: 'Gitarre', stageRoles: ['admin'] })
    })
  })

  describe('remove', () => {
    it('deprovisions the account first, then removes the roster doc', async () => {
      const removeMember = vi.fn().mockResolvedValue(true)
      useWorkspaceStore.setState({ removeMember })

      const ok = await useProfilesStore.getState().remove('p1')

      expect(removeMember).toHaveBeenCalledWith('band-a', 'p1')
      expect(ok).toBe(true)
      expect(removeProfileDb).toHaveBeenCalledWith('p1')
    })

    it('never removes the roster doc when deprovisioning fails (e.g. sole remaining admin)', async () => {
      useWorkspaceStore.setState({ removeMember: vi.fn().mockResolvedValue(false) })

      const ok = await useProfilesStore.getState().remove('p1')

      expect(ok).toBe(false)
      expect(removeProfileDb).not.toHaveBeenCalled()
    })

    it('on a local-only workspace (no server yet), removes the roster doc directly - no backend call', async () => {
      useWorkspaceStore.setState({
        workspaces: [{ id: 'band-a', name: 'Band A', ownProfileId: 'founder-id', isAdmin: true }],
      })
      const removeMember = vi.fn()
      useWorkspaceStore.setState({ removeMember })

      const ok = await useProfilesStore.getState().remove('p1')

      expect(removeMember).not.toHaveBeenCalled()
      expect(ok).toBe(true)
      expect(removeProfileDb).toHaveBeenCalledWith('p1')
    })
  })

  describe('connectToServer', () => {
    it('provisions the founder via connectWorkspace, then every other existing profile via createMember, skipping the founder itself', async () => {
      useWorkspaceStore.setState({
        workspaces: [{ id: 'band-a', name: 'Band A', ownProfileId: 'founder-id', isAdmin: true }],
      })
      useProfilesStore.setState({
        profiles: [
          { id: 'founder-id', name: 'Marco', role: 'Gitarre', stageRoles: ['admin'] },
          { id: 'p2', name: 'Chris', role: 'Bass', stageRoles: [] },
          { id: 'p3', name: 'Alex', role: 'Schlagzeug', stageRoles: ['admin'] },
        ],
      })
      const connectWorkspace = vi.fn().mockResolvedValue(true)
      const chrisCreds = { username: 'stageboard-band-a-p2', password: 'pw2' }
      const alexCreds = { username: 'stageboard-band-a-p3', password: 'pw3' }
      const createMember = vi.fn().mockImplementation((_wsId, { profileId }) =>
        Promise.resolve(profileId === 'p2' ? chrisCreds : alexCreds),
      )
      useWorkspaceStore.setState({ connectWorkspace, createMember })

      const results = await useProfilesStore.getState().connectToServer('https://stage-server:3001')

      expect(connectWorkspace).toHaveBeenCalledWith('band-a', 'https://stage-server:3001')
      expect(createMember).toHaveBeenCalledWith('band-a', { profileId: 'p2', isAdmin: false })
      expect(createMember).toHaveBeenCalledWith('band-a', { profileId: 'p3', isAdmin: true })
      expect(createMember).not.toHaveBeenCalledWith('band-a', expect.objectContaining({ profileId: 'founder-id' }))
      expect(results).toEqual([
        { profile: { id: 'p2', name: 'Chris', role: 'Bass', stageRoles: [] }, credentials: chrisCreds },
        { profile: { id: 'p3', name: 'Alex', role: 'Schlagzeug', stageRoles: ['admin'] }, credentials: alexCreds },
      ])
    })

    it('returns null without provisioning anyone when connectWorkspace itself fails', async () => {
      useWorkspaceStore.setState({
        workspaces: [{ id: 'band-a', name: 'Band A', ownProfileId: 'founder-id', isAdmin: true }],
      })
      useProfilesStore.setState({
        profiles: [
          { id: 'founder-id', name: 'Marco', role: 'Gitarre', stageRoles: ['admin'] },
          { id: 'p2', name: 'Chris', role: 'Bass', stageRoles: [] },
        ],
      })
      const createMember = vi.fn()
      useWorkspaceStore.setState({ connectWorkspace: vi.fn().mockResolvedValue(false), createMember })

      const results = await useProfilesStore.getState().connectToServer('https://stage-server:3001')

      expect(results).toBeNull()
      expect(createMember).not.toHaveBeenCalled()
    })
  })
})
