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
import { levelFromInfo, levelPalette } from "./src/status";
import { deviceById, devices, page, pull, sampleFor, samples, settings } from "./src/store";
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

  /** 氛围光随当前页面与设备能量档位柔和过渡，保持低饱和度不喧宾夺主。 */
  function ambientBackground(): string {
    const dark = colorScheme() === "dark";
    if (page() !== "home") {
      return dark
        ? "radial-gradient(circle at 86% 0%, rgba(100, 175, 255, 0.10) 0%, rgba(100, 175, 255, 0) 44%), radial-gradient(circle at 12% 100%, rgba(148, 163, 184, 0.06) 0%, rgba(148, 163, 184, 0) 46%)"
        : "radial-gradient(circle at 86% 0%, rgba(37, 99, 235, 0.06) 0%, rgba(37, 99, 235, 0) 44%), radial-gradient(circle at 12% 100%, rgba(100, 116, 139, 0.05) 0%, rgba(100, 116, 139, 0) 46%)";
    }
    const active = deviceById(settings().trayDeviceId) ?? devices[0];
    const palette = levelPalette(levelFromInfo(sampleFor(active?.id ?? "")), dark);
    return dark
      ? `radial-gradient(circle at 88% 8%, rgba(${palette.rgb}, 0.13) 0%, rgba(${palette.rgb}, 0) 46%), radial-gradient(circle at 24% 96%, rgba(100, 175, 255, 0.06) 0%, rgba(100, 175, 255, 0) 42%)`
      : `radial-gradient(circle at 88% 8%, rgba(${palette.rgb}, 0.08) 0%, rgba(${palette.rgb}, 0) 46%), radial-gradient(circle at 24% 96%, rgba(37, 99, 235, 0.04) 0%, rgba(37, 99, 235, 0) 42%)`;
  }

  return (
    <View
      class="flex-1 bg-background"
      onMouseMove={(e) => setWindowPointer(e.pagePosition.x, e.pagePosition.y)}
      onMouseLeave={clearWindowPointer}
      style={{ backgroundImage: ambientBackground() }}
    >
      <TitleBar />
      <If when={page() === "home"} else={<SettingsPage />}>
        <Home />
      </If>
    </View>
  );
}

mount(App);
