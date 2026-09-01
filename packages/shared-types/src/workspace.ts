import { z } from 'zod'

/**
 * Body a tablet POSTs to provision a brand-new workspace (see per-person-accounts follow-up).
 * `workspaceId` is the client-generated local id (`useWorkspaceStore`'s `randomId()`) - the
 * server derives the database name from it, it never invents its own id. `founderId` is the
 * profile id the founding device will use for its *own* first roster entry - generated
 * client-side up front so the founder's personal CouchDB account (provisioned here) and their
 * later `profiles:<founderId>` roster doc share the same id, without a round trip in between.
 */
export const WorkspaceProvisionRequestSchema = z.object({
  workspaceId: z.string().min(1),
  founderId: z.string().min(1),
})
export type WorkspaceProvisionRequest = z.infer<typeof WorkspaceProvisionRequestSchema>

export const WorkspaceCredentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})
export type WorkspaceCredentials = z.infer<typeof WorkspaceCredentialsSchema>

/**
 * Every admin-only route needs the caller to prove it genuinely holds *some* admin account for
 * this workspace (see per-person-accounts follow-up - there's no longer one fixed, derivable
 * admin username to check a password against, so the caller has to say which account it is).
 * Verified server-side via `verifyUser` (couch.ts), which also returns that account's roles -
 * the actual authorization check is "does it hold `'admin'`", not just "did the password match".
 */
export const AdminProofSchema = z.object({
  adminUsername: z.string().min(1),
  adminPassword: z.string().min(1),
})
export type AdminProof = z.infer<typeof AdminProofSchema>

/**
 * Body an admin's device POSTs to mint a short-lived, workspace-level join code (2026-09-01
 * redesign, at Marco's request - see #21 for the original per-person version this replaces).
 * The code is *not* tied to any one person: anyone holding it can look up the roster
 * (`POST /invites/:code/roster`) and self-service-join as whichever entry is theirs
 * (`POST /invites/:code/join/:profileId`). `workspaceName` travels here (not stored anywhere
 * server-side otherwise) purely so the resolving device can show a real name instead of an
 * opaque id.
 */
export const WorkspaceInviteRequestSchema = AdminProofSchema.extend({
  workspaceName: z.string().min(1),
})
export type WorkspaceInviteRequest = z.infer<typeof WorkspaceInviteRequestSchema>

export const WorkspaceInviteSchema = z.object({
  code: z.string().min(1),
  expiresAt: z.number().int().nonnegative(),
})
export type WorkspaceInvite = z.infer<typeof WorkspaceInviteSchema>

/** One roster entry as shown to a device that's mid-join (`POST /invites/:code/roster`) -
 * deliberately just enough to render a picker, no credentials. `requiresPassword` is whether
 * this person's CouchDB account already exists (`userExists` in couch.ts): if not, picking
 * them auto-provisions a fresh account on the spot (nothing to check yet); if it does, the
 * device must supply the correct password before `POST /invites/:code/join/:profileId` hands
 * over real credentials. */
export const RosterMemberSchema = z.object({
  profileId: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  requiresPassword: z.boolean(),
})
export type RosterMember = z.infer<typeof RosterMemberSchema>

/** What `POST /invites/:code/roster` hands back - the workspace's roster, for a joining device
 * to render a "who are you" picker before ever touching real credentials. */
export const WorkspaceRosterSchema = z.object({
  workspaceId: z.string().min(1),
  workspaceName: z.string().min(1),
  members: z.array(RosterMemberSchema),
})
export type WorkspaceRoster = z.infer<typeof WorkspaceRosterSchema>

/** Body a joining device POSTs to `POST /invites/:code/join/:profileId` once it's picked who it
 * is - `password` is required only when that roster entry's account already exists
 * (`RosterMember.requiresPassword`); omitted for a brand-new entry being auto-provisioned. */
export const JoinAsMemberRequestSchema = z.object({
  password: z.string().optional(),
})
export type JoinAsMemberRequest = z.infer<typeof JoinAsMemberRequestSchema>

/** What a successful join hands back - real credentials for the picked person's account,
 * freshly provisioned or verified against what the device supplied. `isAdmin` reflects that
 * account's actual CouchDB role (never true for a freshly auto-provisioned account - self-service
 * join can never grant admin), so the resolving device knows to set `Workspace.isAdmin` locally. */
export const JoinAsMemberResultSchema = WorkspaceCredentialsSchema.extend({
  isAdmin: z.boolean(),
})
export type JoinAsMemberResult = z.infer<typeof JoinAsMemberResultSchema>

/**
 * Body the admin's device sends `DELETE /workspaces/:id` with - irreversibly destroys the
 * workspace's database and every member's personal CouchDB account (see
 * workspaceProvisioning.ts's `deprovisionWorkspace`).
 */
export const WorkspaceDeleteRequestSchema = AdminProofSchema
export type WorkspaceDeleteRequest = z.infer<typeof WorkspaceDeleteRequestSchema>

/**
 * Body to provision one new roster member's personal CouchDB account (see
 * per-person-accounts follow-up). `profileId` is client-generated (`randomId()`, same as any
 * other new `Profile.id`) so the caller can write the `profiles:<id>` roster doc itself via its
 * own existing admin sync connection, right after this call returns - core-backend's only job
 * here is the account, never the roster doc. `password` is the admin's optional choice of a
 * short PIN for this person; omitted means the server generates a long random one instead
 * (returned in the response either way, since a random one can never be read back out again).
 */
export const CreateMemberRequestSchema = AdminProofSchema.extend({
  profileId: z.string().min(1),
  password: z.string().min(1).optional(),
  isAdmin: z.boolean().optional(),
})
export type CreateMemberRequest = z.infer<typeof CreateMemberRequestSchema>

/** Grants or revokes admin for one already-provisioned member. The server rejects a revoke that
 * would leave the workspace with zero admins (see workspaceProvisioning.ts) - this is real
 * enforcement, not just a UI nicety, since there is no shared fallback admin account to fall
 * back on anymore. */
export const SetMemberAdminRequestSchema = AdminProofSchema.extend({
  isAdmin: z.boolean(),
})
export type SetMemberAdminRequest = z.infer<typeof SetMemberAdminRequestSchema>

/** Body to deprovision one member's personal CouchDB account (roster doc removal is a separate,
 * ordinary sync write the caller already has rights to do itself). Same last-admin rejection as
 * `SetMemberAdminRequestSchema` if the target is the sole remaining admin. */
export const RemoveMemberRequestSchema = AdminProofSchema
export type RemoveMemberRequest = z.infer<typeof RemoveMemberRequestSchema>

/** Body to reset one already-provisioned member's password to a fresh random one (2026-08-31,
 * BandManagementView.tsx's "Einladen" - see workspaceProvisioning.ts's resetMemberPassword).
 * No last-admin rejection needed here, unlike remove/demote - resetting a password can't
 * reduce the admin count. */
export const ResetMemberPasswordRequestSchema = AdminProofSchema
export type ResetMemberPasswordRequest = z.infer<typeof ResetMemberPasswordRequestSchema>
