import { z } from 'zod'

/**
 * Body a tablet POSTs to provision a brand-new workspace (see per-person-accounts follow-up).
 * `workspaceId` is the client-generated local id (`useWorkspaceStore`'s `randomId()`) - the
 * server derives the database name from it, it never invents its own id. `founderId` is the
 * profile id the founding device will use for its *own* first roster entry - generated
 * client-side up front so the founder's personal CouchDB account (provisioned here) and their
 * later `profiles:<founderId>` roster doc share the same id, without a round trip in between.
 * `workspaceName` is stored server-side now too (2026-09-01 WiFi-style redesign) - previously
 * the server never learned a workspace's human name at all, only ever told one ephemerally by
 * whichever admin device minted an invite; `GET /workspaces` needs a durable one to list.
 */
export const WorkspaceProvisionRequestSchema = z.object({
  workspaceId: z.string().min(1),
  founderId: z.string().min(1),
  workspaceName: z.string().min(1),
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
 * 2026-09-01 redesign, at Marco's explicit request after being locked out of every device at
 * once (his own words: "the only proper way" - modeled directly on WiFi: you see the network
 * name, then either type its password or scan a QR carrying both). Replaces the previous
 * short-lived, admin-minted invite code (#21's original design, then a 2026-09-01 workspace-
 * level version) with one *standing* access code per workspace - generated once (workspace
 * founding, or lazily on first use for a workspace that predates this), persisted inside the
 * workspace's own CouchDB database (`workspaceProvisioning.ts`'s `workspace:access` doc), never
 * expiring on its own. The critical property the old design lacked: getting a working code
 * never depends on any admin device being currently online, logged in, or even still existing -
 * the Stage-Server itself is the sole source of truth, and it's already physically at the gig.
 *
 * Every workspace the Stage-Server hosts is listed via `GET /workspaces` with no code needed at
 * all (the SSID-list equivalent) - only the next step, seeing the roster or actually joining,
 * needs the code (the password equivalent).
 */
export const WorkspaceSummarySchema = z.object({
  workspaceId: z.string().min(1),
  workspaceName: z.string().min(1),
})
export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>

export const AccessCodeSchema = z.object({
  code: z.string().min(1),
})
export type AccessCode = z.infer<typeof AccessCodeSchema>

/** Body a joining device POSTs to `POST /workspaces/:workspaceId/roster` - just the workspace's
 * current standing code (the WiFi "password" step, scoped to a specific "network" picked from
 * `GET /workspaces`). */
export const RosterRequestSchema = z.object({
  code: z.string().min(1),
})
export type RosterRequest = z.infer<typeof RosterRequestSchema>

/** One roster entry as shown to a device that's mid-join (`POST /workspaces/:id/roster`) -
 * deliberately just enough to render a picker, no credentials.
 *
 * 2026-09-02 second follow-up, at Marco's explicit request (after locking himself out a second
 * time testing the *first* follow-up's admin-only-recovery design): only admin accounts have a
 * code at all now. A non-admin roster entry has no password concept whatsoever - nobody, not
 * even the admin who created it, ever sets one - so picking one always just works, silently
 * (re)issuing that account fresh every time (`resolveOutcome` in `index.ts`). There is
 * deliberately no `requiresPassword` field anymore; `isAdmin` alone tells the client whether to
 * prompt at all.
 *
 * An admin entry needs a 4-digit code to activate - either that person's own self-assigned PIN
 * (`POST /workspaces/:id/members/:profileId/set-pin`, self-service, requires already being
 * logged in as that exact profile), or the *universal* recovery code that always works for
 * *any* admin account in this workspace: the last 4 digits of the workspace's own standing
 * access code (`AccessCodeSchema`). Marco's own reasoning: you already had to know the full
 * access code just to reach this roster at all, so requiring 4 more of the same digits to
 * become admin adds a deliberate, memorable extra step without inventing a second secret to
 * lose - and, crucially, it can never depend on any other device or session existing. This
 * intentionally reopens the exact trust boundary the *first* 2026-09-02 follow-up had closed
 * (anyone who knows the band code can reach admin) - a conscious tradeoff Marco made after
 * hitting the friction of the stricter version twice in one day. */
export const RosterMemberSchema = z.object({
  profileId: z.string().min(1),
  name: z.string().min(1),
  isAdmin: z.boolean(),
})
export type RosterMember = z.infer<typeof RosterMemberSchema>

/** What `POST /workspaces/:id/roster` hands back - the workspace's roster, for a joining device
 * to render a "who are you" picker before ever touching real credentials. */
export const WorkspaceRosterSchema = z.object({
  workspaceId: z.string().min(1),
  workspaceName: z.string().min(1),
  members: z.array(RosterMemberSchema),
})
export type WorkspaceRoster = z.infer<typeof WorkspaceRosterSchema>

/** Body a joining device POSTs to `POST /workspaces/:workspaceId/join/:profileId` once it's
 * picked who it is - `code` is always required (the workspace's standing access code).
 * `password` is only meaningful for an *admin* target (see `RosterMemberSchema`'s doc comment):
 * that person's own self-assigned 4-digit PIN, or the universal recovery code (the workspace
 * access code's own last 4 digits). Ignored entirely for a non-admin target - there's nothing
 * to check. */
export const JoinAsMemberRequestSchema = z.object({
  code: z.string().min(1),
  password: z.string().optional(),
})
export type JoinAsMemberRequest = z.infer<typeof JoinAsMemberRequestSchema>

/** What a successful join hands back - real credentials for the picked person's account,
 * freshly provisioned, verified against what the device supplied, or freshly reset via the
 * code-based recovery path. `isAdmin` reflects that account's actual CouchDB role (never true
 * for a freshly auto-provisioned account - self-service join can never grant admin on its own),
 * so the resolving device knows to set `Workspace.isAdmin` locally. */
export const JoinAsMemberResultSchema = WorkspaceCredentialsSchema.extend({
  isAdmin: z.boolean(),
})
export type JoinAsMemberResult = z.infer<typeof JoinAsMemberResultSchema>

/** Body to fetch a workspace's *current* standing access code (admin-only) - for
 * BandManagementView.tsx's "Einladen" to display/re-display it (lazily creating one first if
 * this workspace predates the 2026-09-01 redesign), without changing it. */
export const GetAccessCodeRequestSchema = AdminProofSchema
export type GetAccessCodeRequest = z.infer<typeof GetAccessCodeRequestSchema>

/** Body to rotate a workspace's standing access code (admin-only, e.g. "the code leaked, or
 * just clean up after a tour") - generates and persists a fresh one, immediately invalidating
 * the old one for anyone who only knew that. */
export const RotateAccessCodeRequestSchema = AdminProofSchema
export type RotateAccessCodeRequest = z.infer<typeof RotateAccessCodeRequestSchema>

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

/** Body to reset another admin's PIN to a fresh random 4-digit one (2026-08-31,
 * BandManagementView.tsx's "Passwort zurücksetzen" - see workspaceProvisioning.ts's
 * resetMemberPassword). 2026-09-02 second follow-up: only meaningful for an admin target now -
 * a non-admin has no PIN to reset at all (`RosterMemberSchema`'s doc comment) - `index.ts`
 * rejects a non-admin target outright. No last-admin rejection needed here, unlike
 * remove/demote - resetting a PIN can't reduce the admin count. */
export const ResetMemberPasswordRequestSchema = AdminProofSchema
export type ResetMemberPasswordRequest = z.infer<typeof ResetMemberPasswordRequestSchema>

/** Body an already-connected device POSTs to `POST /workspaces/:id/members/:profileId/activate`
 * to become a *different* roster member within the *same* already-joined workspace (2026-09-02
 * follow-up, at Marco's explicit request - replaces the old always-anonymous
 * `ProfileSwitcher.tsx`, which let any device silently display as any profile with zero
 * credential check at all; band/profile switching now lives entirely in
 * BandManagementView.tsx's "Band" tab instead). `callerUsername`/`callerPassword` are the
 * calling device's own *current* credentials for this exact workspace - proof it already holds
 * some valid account here, the same trust level as knowing the workspace's own access code
 * (both really just mean "already inside this band"), checked server-side by username prefix so
 * a credential from a *different* workspace can't be reused here. `password` is only meaningful
 * for an admin target - same semantics as `JoinAsMemberRequestSchema` (see
 * `RosterMemberSchema`'s doc comment). */
export const ActivateProfileRequestSchema = z.object({
  callerUsername: z.string().min(1),
  callerPassword: z.string().min(1),
  password: z.string().optional(),
})
export type ActivateProfileRequest = z.infer<typeof ActivateProfileRequestSchema>

/** What a successful activation hands back - same shape as `JoinAsMemberResultSchema`, since
 * it's the exact same outcomes (verified / auto-provisioned / recovery-reissued), just reached
 * via the calling device's own credentials instead of the workspace's shared code. */
export const ActivateProfileResultSchema = JoinAsMemberResultSchema
export type ActivateProfileResult = z.infer<typeof ActivateProfileResultSchema>

/** Body an already-logged-in admin device POSTs to
 * `POST /workspaces/:id/members/:profileId/set-pin` to self-assign or change *its own* 4-digit
 * admin PIN (2026-09-02 second follow-up, at Marco's explicit request: "Bei Admins ... [ein] 4
 * stelliger Code, der selbst vergeben werden kann" - admins choose their own PIN, nobody else
 * assigns it for them). `callerUsername`/`callerPassword` must verify as - and match - the
 * *exact* profile being changed (checked server-side): this is strictly self-service, not a way
 * to set someone else's PIN (that's still `ResetMemberPasswordRequestSchema`'s "Passwort
 * zurücksetzen", for when a locked-out admin needs another admin's help instead). `newPin` must
 * be exactly 4 digits. */
export const SetOwnPinRequestSchema = z.object({
  callerUsername: z.string().min(1),
  callerPassword: z.string().min(1),
  newPin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
})
export type SetOwnPinRequest = z.infer<typeof SetOwnPinRequestSchema>

/** What a successful PIN change hands back - same shape as `JoinAsMemberResultSchema`. */
export const SetOwnPinResultSchema = JoinAsMemberResultSchema
export type SetOwnPinResult = z.infer<typeof SetOwnPinResultSchema>
