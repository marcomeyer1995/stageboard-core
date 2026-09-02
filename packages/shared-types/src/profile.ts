import { z } from 'zod'

/**
 * Closed vocabulary for widget/dashboard relevance (#57). A widget/dashboard author needs
 * something fixed to actually declare against - a profile can hold more than one (e.g. a
 * roadie who also runs sound).
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
 * the band is shared knowledge, not private. Picking which profile a given tablet is
 * currently "signed in" as is a separate, device-local choice (see useActiveProfileStore) and
 * is not authentication: any device can pick any profile, same trust level as the existing
 * workspace switcher.
 *
 * 2026-09-02 sixth follow-up, at Marco's explicit request ("I don't see the necessity for
 * it"): the free-text instrument/function field (`role`) that used to live here is gone -
 * `stageRoles` below is the only classification a profile carries now.
 */
export const ProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Gates widget/dashboard visibility, and (for the 'admin' value) roster admin bookkeeping -
   * see StageRoleSchema above. */
  stageRoles: z.array(StageRoleSchema).default([]),
})
export type Profile = z.infer<typeof ProfileSchema>
