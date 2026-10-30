import i18n from '../i18n'
import type { StageRole } from 'shared-types'

/** Display labels for StageRoleSchema's fixed vocabulary (#57) - shared between
 * BandManagementView.tsx's role checkboxes and DashboardManager.tsx's Station-owner dropdown,
 * the only two places a StageRole is shown to a person rather than just matched against. */
export const STAGE_ROLE_LABELS: Record<StageRole, string> = {
  get performer() {
    return i18n.t('band:roles.performer')
  },
  get lighttech() {
    return i18n.t('band:roles.lighttech')
  },
  get soundtech() {
    return i18n.t('band:roles.soundtech')
  },
  get crew() {
    return i18n.t('band:roles.crew')
  },
  get admin() {
    return i18n.t('band:roles.admin')
  },
  get showmaster() {
    return i18n.t('band:roles.showmaster')
  },
}
