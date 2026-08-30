import type { StageRole } from 'shared-types'

/** Display labels for StageRoleSchema's fixed vocabulary (#57) - shared between
 * BandManagementView.tsx's role checkboxes and DashboardManager.tsx's Station-owner dropdown,
 * the only two places a StageRole is shown to a person rather than just matched against. */
export const STAGE_ROLE_LABELS: Record<StageRole, string> = {
  performer: 'Musiker:in',
  lighttech: 'Lichttechnik',
  soundtech: 'Tontechnik',
  crew: 'Crew',
  admin: 'Admin',
}
