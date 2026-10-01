/** 根路由：挂载 RootLayout。 */
import { createRootRoute } from '@tanstack/react-router'
import { RootLayout } from '@/Layout/RootLayout'

export const Route = createRootRoute({
  component: RootLayout,
})
