import { useEffect } from "react"
import { Outlet, createRootRoute } from "@tanstack/react-router"
import { TitleBar } from "@/components/TitleBar"
import { applyThemeFromStore, useSettingsStore } from "@/stores/settings"

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  const themeMode = useSettingsStore((s) => s.themeMode)

  useEffect(() => {
    applyThemeFromStore(themeMode)
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => applyThemeFromStore(themeMode)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [themeMode])

  return (
    <div className="bg-background text-foreground flex h-full flex-col">
      <TitleBar />
      <Outlet />
    </div>
  )
}
