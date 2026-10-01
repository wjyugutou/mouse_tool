import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";

const GITHUB_URL = "https://github.com/wjyugutou/mouse_tool";

interface Props {
  onOpenSettings: () => void;
}

export function TitleBar({ onOpenSettings }: Props) {
  const [maximized, setMaximized] = useState(false);

  const syncMaximized = useCallback(async () => {
    try {
      setMaximized(await getCurrentWindow().isMaximized());
    } catch {
      /* browser preview */
    }
  }, []);

  useEffect(() => {
    void syncMaximized();
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        unlisten = await getCurrentWindow().onResized(() => {
          void syncMaximized();
        });
      } catch {
        /* ignore */
      }
    })();
    return () => unlisten?.();
  }, [syncMaximized]);

  const minimize = () => {
    void getCurrentWindow().minimize();
  };
  const toggleMaximize = () => {
    void getCurrentWindow().toggleMaximize().then(() => syncMaximized());
  };
  const close = () => {
    void getCurrentWindow().close();
  };
  const openGithub = () => {
    void openUrl(GITHUB_URL);
  };

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-left">
        <button
          type="button"
          className="titlebar-icon-btn"
          title="GitHub"
          aria-label="GitHub"
          onClick={openGithub}
        >
          <span className="i-mdi-github text-16px" />
        </button>
        <button
          type="button"
          className="titlebar-icon-btn"
          title="设置"
          aria-label="设置"
          onClick={onOpenSettings}
        >
          <span className="i-mdi-cog-outline text-16px" />
        </button>
      </div>
      <div
        className="titlebar-drag"
        data-tauri-drag-region
        onDoubleClick={toggleMaximize}
      />
      <div className="titlebar-right">
        <button
          type="button"
          className="titlebar-win-btn"
          title="最小化"
          aria-label="最小化"
          onClick={minimize}
        >
          <span className="i-mdi-window-minimize text-14px" />
        </button>
        <button
          type="button"
          className="titlebar-win-btn"
          title={maximized ? "还原" : "最大化"}
          aria-label={maximized ? "还原" : "最大化"}
          onClick={toggleMaximize}
        >
          <span
            className={
              maximized
                ? "i-mdi-window-restore text-14px"
                : "i-mdi-window-maximize text-14px"
            }
          />
        </button>
        <button
          type="button"
          className="titlebar-win-btn titlebar-win-btn-close"
          title="关闭"
          aria-label="关闭"
          onClick={close}
        >
          <span className="i-mdi-close text-14px" />
        </button>
      </div>
    </header>
  );
}
