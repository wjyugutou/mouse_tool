import { useCallback, useEffect, useState } from "react"
import { Icon } from "@iconify/react"
import { useNavigate, useRouterState } from "@tanstack/react-router"
import { openUrl } from "@tauri-apps/plugin-opener"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const GITHUB_URL = "https://github.com/wjyugutou/mouse_tool"

export function TitleBar() {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [maximized, setMaximized] = useState(false)

  const syncMaximized = useCallback(async () => {
    try {
      setMaximized(await getCurrentWindow().isMaximized())
    } catch {
      /* browser preview */
    }
  }, [])

  useEffect(() => {
    void syncMaximized()
    let unlisten: (() => void) | undefined
    void (async () => {
      try {
        unlisten = await getCurrentWindow().onResized(() => {
          void syncMaximized()
        })
      } catch {
        /* ignore */
      }
    })()
    return () => unlisten?.()
  }, [syncMaximized])

  const minimize = () => {
    void getCurrentWindow().minimize()
  }
  const toggleMaximize = () => {
    void getCurrentWindow().toggleMaximize().then(() => syncMaximized())
  }
  const close = () => {
    void getCurrentWindow().close()
  }

  return (
    <header
      className="bg-card/80 flex h-9 shrink-0 items-stretch border-b border-border backdrop-blur"
      data-tauri-drag-region
    >
      <div className="flex items-center gap-0.5 px-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="GitHub"
          aria-label="GitHub"
          onClick={() => void openUrl(GITHUB_URL)}
        >
          <Icon icon="mdi:github" className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="设置"
          aria-label="设置"
          onClick={() => {
            if (pathname !== "/settings") void navigate({ to: "/settings" })
          }}
        >
          <Icon icon="mdi:cog-outline" className="size-4" />
        </Button>
      </div>
      <div
        className="min-w-6 flex-1"
        data-tauri-drag-region
        onDoubleClick={toggleMaximize}
      />
      <div className="flex items-stretch">
        <button
          type="button"
          className="text-muted-foreground hover:bg-accent hover:text-accent-foreground inline-flex w-11 items-center justify-center"
          title="最小化"
          aria-label="最小化"
          onClick={minimize}
        >
          <Icon icon="mdi:window-minimize" className="size-3.5" />
        </button>
        <button
          type="button"
          className="text-muted-foreground hover:bg-accent hover:text-accent-foreground inline-flex w-11 items-center justify-center"
          title={maximized ? "还原" : "最大化"}
          aria-label={maximized ? "还原" : "最大化"}
          onClick={toggleMaximize}
        >
          <Icon
            icon={maximized ? "mdi:window-restore" : "mdi:window-maximize"}
            className="size-3.5"
          />
        </button>
        <button
          type="button"
          className={cn(
            "text-muted-foreground inline-flex w-11 items-center justify-center",
            "hover:bg-destructive hover:text-white",
          )}
          title="关闭"
          aria-label="关闭"
          onClick={close}
        >
          <Icon icon="mdi:close" className="size-3.5" />
        </button>
      </div>
    </header>
  )
}
