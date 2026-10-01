import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider, createRouter } from "@tanstack/react-router"
import { routeTree } from "./routeTree.gen"
import {
  applyThemeFromStore,
  settingsTauriStore,
  useSettingsStore,
} from "./stores/settings"
import "./index.css"

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

const rootEl = document.getElementById("root")
if (!rootEl) {
  throw new Error("未找到 #root 挂载点")
}

document.documentElement.classList.add("dark")

async function bootstrap(mount: HTMLElement) {
  try {
    await settingsTauriStore.start()
  } catch (error) {
    console.error("settings store start failed", error)
  }
  applyThemeFromStore(useSettingsStore.getState().themeMode)

  createRoot(mount).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  )
}

void bootstrap(rootEl)
