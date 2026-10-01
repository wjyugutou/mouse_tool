/** 路由 `/` → 首页（组件放 pages，避免 Fast Refresh 警告）。 */
import { createFileRoute } from '@tanstack/react-router'
import { HomePage } from '@/pages/HomePage'

export const Route = createFileRoute('/')({
  component: HomePage,
})
