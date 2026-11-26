/**
 * When another admin gives or takes this device's own person's admin rights (#978), the roster arrives by sync but
 * the device's own admin gate (`Workspace.isAdmin`) does not change: the host already upgraded or downgraded this
 * device's login, only the app does not know. Then the app asks the host once, by re-picking its own person
 * without a PIN - the host answers with the rights the login really has, never more.
 *
 * Returns the profile to re-pick, or null when nothing is to do. Only for the person this device's login belongs
 * to (`<band>-<profileId>` or `<band>-<profileId>~<deviceId>`): re-picking someone else would take on that person.
 */
export function ownAdminCheckFor(workspace: { id: string; username?: string; password?: string; isAdmin?: boolean } | undefined, profile: { id: string; stageRoles: string[] } | undefined): string | null {
  if (!workspace?.username || !workspace.password || !profile) return null
  const own = `stageboard-${workspace.id}-${profile.id}`
  if (workspace.username !== own && !workspace.username.startsWith(`${own}~`)) return null
  return profile.stageRoles.includes('admin') === Boolean(workspace.isAdmin) ? null : profile.id
}
