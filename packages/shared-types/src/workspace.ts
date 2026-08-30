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
 * Body an admin's device POSTs to mint a short-lived join code (see #21). Carries whichever
 * specific person's already-provisioned account (see `CreateMemberRequestSchema` below) the
 * code should hand over - every invite is for one specific person now, not "the" shared member
 * secret. `workspaceName` travels here (not stored anywhere server-side otherwise) purely so
 * the resolving device can show a real name instead of an opaque id.
 */
export const WorkspaceInviteRequestSchema = AdminProofSchema.extend({
  memberUsername: z.string().min(1),
  memberPassword: z.string().min(1),
  workspaceName: z.string().min(1),
  /** Whether the account being handed over holds the admin role - purely informational
   * passthrough to the resolving device (see `ResolvedInviteSchema` below), so it knows to set
   * its own `Workspace.isAdmin` locally. Real enforcement is CouchDB's roster validator, not
   * this flag - a wrong value here can't grant unearned access, just mis-show/hide UI. */
  isAdmin: z.boolean().optional(),
})
export type WorkspaceInviteRequest = z.infer<typeof WorkspaceInviteRequestSchema>

export const WorkspaceInviteSchema = z.object({
  code: z.string().min(1),
  expiresAt: z.number().int().nonnegative(),
})
export type WorkspaceInvite = z.infer<typeof WorkspaceInviteSchema>

/** What `POST /invites/:code/resolve` hands back to a joining device - everything it needs to
 * add and activate the workspace locally, syncing as whichever specific person's account this
 * invite was minted for. */
export const ResolvedInviteSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  isAdmin: z.boolean(),
})
export type ResolvedInvite = z.infer<typeof ResolvedInviteSchema>

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
