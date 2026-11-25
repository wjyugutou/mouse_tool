/**
 * 入口：Rust 起采样线程；这里只管窗口、托盘和两张页面。
 * Rust 每次出新电量把版本号加一，TSX 每秒看一眼版本号，变了才取快照、重画托盘。
 */
import { colorScheme, effect, mount, setColorScheme, View } from "nsh";
import { Application, currentWindow, Tray } from "nsh/desktop";
import { Mouse } from "yugutou/native";
import { Home } from "./src/Home";
import { clearWindowPointer, setWindowPointer } from "./src/morph-bot/pointer";
import { SettingsPage } from "./src/SettingsPage";
import { page, pull, samples, settings } from "./src/store";
import { TitleBar } from "./src/TitleBar";
import { install as installUpdate, startAutoCheck, update } from "./src/updater";

Mouse.start();
pull();
setInterval(pull, 1000);
startAutoCheck();

function App() {
  const win = currentWindow();

  function showMain() {
    win.show();
    win.focus();
  }

  win.on("closePress", () => {
    if (settings().closeBehavior === "quit") Application.quit();
    else win.hide();
  });

  effect(() => {
    const mode = settings().themeMode;
    setColorScheme(mode === "light" || mode === "dark" ? mode : "system");
  });

  // 托盘：电量或设置变了才重设（signal 只在版本号变化时换新值）。
  effect(() => {
    samples();
    settings();
    const found = update();
    Tray.set({
      icon: Mouse.trayIcon(),
      tooltip: Mouse.trayTooltip(),
      onClick: showMain,
      menu: [
        { label: "打开主界面", onSelect: showMain },
        {
          label: "设置",
          onSelect: () => {
            page.set("settings");
            showMain();
          },
        },
        ...(found
          ? [
              {
                label: `安装更新 ${found.version}`,
                onSelect: () => {
                  page.set("settings");
                  showMain();
                  void installUpdate();
                },
              },
            ]
          : []),
        { type: "separator" },
        { label: "退出", onSelect: () => Application.quit() },
      ],
    });
  });

  // `--autostart` 开机启动只进托盘。
  if (!Mouse.launchedAtLogin()) showMain();

  return (
    <View
      class="flex-1 bg-background"
      onMouseMove={(e) => setWindowPointer(e.pagePosition.x, e.pagePosition.y)}
      onMouseLeave={clearWindowPointer}
      style={{
        // 老版：深蓝黑底（--background）+ 右上 primary/10 大光晕。
        backgroundImage:
          colorScheme() === "dark"
            ? "radial-gradient(circle at 92% 6%, rgba(60, 143, 244, 0.16) 0%, rgba(60, 143, 244, 0) 48%)"
            : "radial-gradient(circle at 92% 6%, rgba(29, 78, 216, 0.08) 0%, rgba(29, 78, 216, 0) 48%)",
      }}
    >
      <TitleBar />
      <If when={page() === "home"} else={<SettingsPage />}>
        <Home />
      </If>
    </View>
  );
}

mount(App);
