/** 路由 `/settings` → 设置页。 */
import { createFileRoute } from '@tanstack/react-router'
import { SettingsPage } from '@/pages/SettingsPage'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})
