import { z } from 'zod'

/**
 * Closed vocabulary for widget/dashboard relevance (#57) - deliberately separate from `role`
 * below. `role` is free text a band types in ("Gitarre", "Licht") and stays that way for
 * display; a widget/dashboard author needs something fixed to actually declare against, which
 * free text structurally can't provide (no way to check "is this person on lights" from an
 * arbitrary string). A profile can hold more than one (e.g. a roadie who also runs sound).
 *
 * `admin` (roster-admin follow-up) lives in this same list, not a separate field - by request,
 * simplicity over precision: it's edited through the exact same "Stage-Rollen anpassen"
 * checkbox dialog as everything else here, not a bespoke credential-handoff flow. It's a
 * roster-visible label, not a technical grant - actually writing any `profiles:*` doc (checking
 * this box included) is still restricted server-side to whichever device holds the workspace's
 * real CouchDB admin credential (`_design/roster`, workspaceProvisioning.ts), same as it always
 * was. Marking someone admin here doesn't hand their device that credential - that still only
 * happens the way it always has (the founding device has it; anyone else needs it shared with
 * them manually, e.g. via JoinBandView's "Passwort direkt eingeben").
 */
export const STAGE_ROLES = ['performer', 'lighttech', 'soundtech', 'crew', 'admin'] as const
export const StageRoleSchema = z.enum(STAGE_ROLES)
export type StageRole = z.infer<typeof StageRoleSchema>

/**
 * One entry in a band's roster. Replicated band-wide like Dashboard/Setlist - who's in
 * the band and what they play is shared knowledge, not private. Picking which profile a
 * given tablet is currently "signed in" as is a separate, device-local choice (see
 * useActiveProfileStore) and is not authentication: any device can pick any profile,
 * same trust level as the existing workspace switcher.
 */
export const ProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Open string, same philosophy as CapabilityId - bands name their own roles. */
  role: z.string().min(1),
  /** See StageRoleSchema above - unrelated to `role`, gates widget/dashboard visibility, and
   * (for the 'admin' value) roster admin bookkeeping. */
  stageRoles: z.array(StageRoleSchema).default([]),
})
export type Profile = z.infer<typeof ProfileSchema>
