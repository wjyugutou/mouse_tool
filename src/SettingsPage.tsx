/** 分组式桌面偏好设置页：每项改动都交给 Rust（`Mouse.updateSettings` 等），再取回快照。 */
import { colorScheme, Scroll, signal, Text, token, View, type JSX } from "nsh";
import { Mouse } from "yugutou/native";
import { Chip } from "./Chip";
import {
  mdiCheckCircle,
  mdiHeadphones,
  mdiKeyboard,
  mdiMouse,
  mdiRefresh,
} from "./icons";
import { CATEGORIES, CATEGORY_LABEL, pull, settings, type Category } from "./store";
import { check, install, isBusy, message, phase, progress, update } from "./updater";
import { type IconData, Icon } from "./vendor/supernsh-icons";

const INTERVALS = [3, 5, 10, 30, 60, 120, 300];

const CATEGORY_ICON: Record<Category, IconData> = {
  mouse: mdiMouse,
  keyboard: mdiKeyboard,
  headset: mdiHeadphones,
};

const THEME_MODES = [
  { id: "system", label: "跟随系统", desc: "自动匹配系统明暗外观" },
  { id: "light", label: "浅色", desc: "晨雾白陶 · 明亮通透" },
  { id: "dark", label: "深色", desc: "曜石微光 · 低眩深邃" },
] as const;

function GroupHeading(props: { label: string }) {
  return (
    <View class="mt-2 flex-row items-center gap-2 px-1">
      <View class="h-2.5 w-0.5 rounded-full bg-primary/75" />
      <Text class="text-[10px] font-semibold tracking-[0.2em] text-muted-foreground">
        {props.label}
      </Text>
    </View>
  );
}

function Card(props: {
  title: string;
  hint?: string;
  right?: JSX.Element;
  class?: string;
  children?: JSX.Element;
}) {
  const dark = () => colorScheme() === "dark";

  return (
    <View
      class={props.class ? `gap-4 rounded-[22px] bg-card p-5 ${props.class}` : "gap-4 rounded-[22px] bg-card p-5"}
      style={{
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: dark() ? "rgba(255, 255, 255, 0.085)" : "rgba(15, 23, 42, 0.075)",
        boxShadow: dark()
          ? "0 16px 40px -28px rgba(0, 0, 0, 0.78), inset 0 1px 0 rgba(255, 255, 255, 0.06)"
          : "0 14px 32px -24px rgba(15, 23, 42, 0.13), inset 0 1px 0 rgba(255, 255, 255, 0.95)",
      }}
    >
      <View class="flex-row flex-wrap items-start justify-between gap-3">
        <View class="min-w-0 flex-1">
          <Text class="text-[14px] font-semibold text-foreground">{props.title}</Text>
          {props.hint ? (
            <Text class="mt-1 text-xs leading-relaxed text-muted-foreground">{props.hint}</Text>
          ) : null}
        </View>
        {props.right ?? null}
      </View>
      {props.children}
    </View>
  );
}

function SegmentedPair(props: {
  leftLabel: string;
  rightLabel: string;
  isRight: boolean;
  onLeft: () => void;
  onRight: () => void;
}) {
  const dark = () => colorScheme() === "dark";

  const optionStyle = (active: boolean) => ({
    borderCurve: "continuous" as const,
    borderWidth: 1,
    borderColor: active
      ? dark()
        ? "rgba(255, 255, 255, 0.10)"
        : "rgba(15, 23, 42, 0.08)"
      : "transparent",
    boxShadow: active
      ? dark()
        ? "0 2px 6px rgba(0, 0, 0, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.08)"
        : "0 2px 6px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.92)"
      : undefined,
  });

  return (
    <View
      class="flex-row gap-1 rounded-[13px] p-1"
      style={{
        borderCurve: "continuous",
        backgroundColor: dark() ? "rgba(0, 0, 0, 0.28)" : "rgba(15, 23, 42, 0.045)",
        borderWidth: 1,
        borderColor: dark() ? "rgba(255, 255, 255, 0.06)" : "rgba(15, 23, 42, 0.06)",
      }}
    >
      <View
        role="button"
        onPress={props.onLeft}
        class={
          !props.isRight
            ? "cursor-pointer flex-1 items-center justify-center rounded-[10px] bg-card px-3 py-1.5"
            : "cursor-pointer flex-1 items-center justify-center rounded-[10px] px-3 py-1.5"
        }
        style={optionStyle(!props.isRight)}
        hoverStyle={
          !props.isRight
            ? undefined
            : { backgroundColor: dark() ? "rgba(255, 255, 255, 0.05)" : "rgba(15, 23, 42, 0.04)" }
        }
        activeStyle={{ opacity: 0.8 }}
      >
        <Text
          class={
            !props.isRight
              ? "text-xs font-semibold text-foreground"
              : "text-xs font-medium text-muted-foreground"
          }
        >
          {props.leftLabel}
        </Text>
      </View>

      <View
        role="button"
        onPress={props.onRight}
        class={
          props.isRight
            ? "cursor-pointer flex-1 items-center justify-center rounded-[10px] bg-card px-3 py-1.5"
            : "cursor-pointer flex-1 items-center justify-center rounded-[10px] px-3 py-1.5"
        }
        style={optionStyle(props.isRight)}
        hoverStyle={
          props.isRight
            ? undefined
            : { backgroundColor: dark() ? "rgba(255, 255, 255, 0.05)" : "rgba(15, 23, 42, 0.04)" }
        }
        activeStyle={{ opacity: 0.8 }}
      >
        <Text
          class={
            props.isRight
              ? "text-xs font-semibold text-foreground"
              : "text-xs font-medium text-muted-foreground"
          }
        >
          {props.rightLabel}
        </Text>
      </View>
    </View>
  );
}

/** 迷你外观色卡预览，直观呈现浅色 / 深色 / 跟随系统视觉材质。 */
function ThemeSwatch(props: { mode: "system" | "light" | "dark" }) {
  const lightCanvas = "#eef1f5";
  const lightCard = "#ffffff";
  const lightBar = "#3b82f6";
  const darkCanvas = "#131720";
  const darkCard = "#1e2433";
  const darkBar = "#38bdf8";

  if (props.mode === "system") {
    return (
      <View
        class="h-12 w-full flex-row overflow-hidden rounded-xl"
        style={{
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: "rgba(148, 163, 184, 0.25)",
        }}
      >
        <View class="flex-1 justify-between p-2" style={{ backgroundColor: lightCanvas }}>
          <View class="h-1.5 w-7 rounded-full" style={{ backgroundColor: lightBar }} />
          <View class="h-4 rounded-md" style={{ backgroundColor: lightCard }} />
        </View>
        <View class="flex-1 justify-between p-2" style={{ backgroundColor: darkCanvas }}>
          <View class="h-1.5 w-7 rounded-full" style={{ backgroundColor: darkBar }} />
          <View class="h-4 rounded-md" style={{ backgroundColor: darkCard }} />
        </View>
      </View>
    );
  }

  const isLight = props.mode === "light";
  return (
    <View
      class="h-12 w-full justify-between overflow-hidden rounded-xl p-2"
      style={{
        borderCurve: "continuous",
        backgroundColor: isLight ? lightCanvas : darkCanvas,
        borderWidth: 1,
        borderColor: isLight ? "rgba(15, 23, 42, 0.10)" : "rgba(255, 255, 255, 0.10)",
      }}
    >
      <View class="flex-row items-center gap-1.5">
        <View
          class="size-2 rounded-full"
          style={{ backgroundColor: isLight ? lightBar : darkBar }}
        />
        <View
          class="h-1.5 w-10 rounded-full"
          style={{
            backgroundColor: isLight ? "rgba(15, 23, 42, 0.16)" : "rgba(255, 255, 255, 0.22)",
          }}
        />
      </View>
      <View
        class="h-4 w-full rounded-md"
        style={{ backgroundColor: isLight ? lightCard : darkCard }}
      />
    </View>
  );
}

function patch(p: Parameters<typeof Mouse.updateSettings>[0]) {
  Mouse.updateSettings(p);
  pull();
}

export function SettingsPage() {
  const dark = () => colorScheme() === "dark";
  const autostart = signal(Mouse.autostartEnabled());
  const autostartError = signal<string | null>(null);
  const logPath = Mouse.logPath();
  const settingsPath = Mouse.settingsPath();

  function setAutostart(on: boolean) {
    try {
      autostart.set(Mouse.setAutostart(on));
      autostartError.set(null);
    } catch (e) {
      autostartError.set(String(e));
      autostart.set(Mouse.autostartEnabled());
    }
  }

  function toggleCategory(key: string) {
    const now = settings().trayCategories;
    const next = now.includes(key) ? now.filter((k) => k !== key) : [...now, key];
    if (next.length === 0) return; // 至少保留一个分类
    patch({ trayCategories: next });
  }

  return (
    <Scroll class="flex-1" contentClass="items-center px-8 py-7">
      <View class="w-full max-w-[820px] gap-4">
        {/* 页头概览 */}
        <View class="flex-row flex-wrap items-end justify-between gap-3 px-1 pb-1">
          <View class="min-w-0 flex-1">
            <Text class="text-[22px] font-semibold text-foreground" style={{ letterSpacing: -0.4 }}>
              偏好设置
            </Text>
            <Text class="mt-1 text-xs text-muted-foreground">
              自定义外设轮询频率、托盘分类展示、窗口行为与外观主题
            </Text>
          </View>
          <View
            class="flex-row items-center gap-1.5 rounded-full px-3 py-1"
            style={{
              backgroundColor: dark() ? "rgba(255, 255, 255, 0.05)" : "rgba(15, 23, 42, 0.045)",
              borderWidth: 1,
              borderColor: dark() ? "rgba(255, 255, 255, 0.08)" : "rgba(15, 23, 42, 0.07)",
            }}
          >
            <View class="size-1.5 rounded-full bg-primary" />
            <Text
              class="text-[11px] font-medium text-muted-foreground"
              style={{ fontVariant: ["tabular-nums"] }}
            >
              {`v${Mouse.appVersion()} · NSH`}
            </Text>
          </View>
        </View>

        {/* 分组一：采样与刷新 */}
        <GroupHeading label="采样与刷新" />

        <Card
          title="自动刷新间隔"
          hint="后台按这个间隔读一次电量，托盘和首页共用这次结果。"
          right={
            <View class="w-[228px]">
              <SegmentedPair
                leftLabel="自动刷新开启"
                rightLabel="自动刷新暂停"
                isRight={!settings().autoRefresh}
                onLeft={() => patch({ autoRefresh: true })}
                onRight={() => patch({ autoRefresh: false })}
              />
            </View>
          }
        >
          <View class="flex-row flex-wrap gap-2">
            <Each of={INTERVALS}>
              {(sec) => (
                <Chip
                  label={sec() >= 60 ? `${sec() / 60} 分钟` : `${sec()} 秒`}
                  selected={settings().autoIntervalSec === sec()}
                  tabular
                  onPress={() => patch({ autoIntervalSec: sec() })}
                />
              )}
            </Each>
          </View>
        </Card>

        {/* 分组二：窗口、启动与托盘 */}
        <GroupHeading label="窗口与系统托盘" />

        <View class="flex-row flex-wrap gap-4">
          <Card
            title="关闭窗口时"
            hint="点击窗口关闭按钮时的默认动作。"
            class="min-w-[280px] flex-1"
          >
            <SegmentedPair
              leftLabel="隐藏到托盘"
              rightLabel="退出程序"
              isRight={settings().closeBehavior === "quit"}
              onLeft={() => patch({ closeBehavior: "tray" })}
              onRight={() => patch({ closeBehavior: "quit" })}
            />
          </Card>

          <Card
            title="开机自启"
            hint="开机启动时只进托盘，不弹出主窗口。"
            class="min-w-[280px] flex-1"
          >
            <SegmentedPair
              leftLabel="开启"
              rightLabel="关闭"
              isRight={!autostart()}
              onLeft={() => setAutostart(true)}
              onRight={() => setAutostart(false)}
            />
            {autostartError() ? (
              <Text class="text-xs text-destructive">{autostartError() ?? ""}</Text>
            ) : null}
          </Card>
        </View>

        <Card title="托盘显示" hint="托盘图标按分类各画一格电量，至少保留一个分类。">
          <View class="flex-row flex-wrap gap-3">
            <Each of={CATEGORIES}>
              {(cat) => {
                const selected = () => settings().trayCategories.includes(cat());
                return (
                  <View
                    role="button"
                    onPress={() => toggleCategory(cat())}
                    class="cursor-pointer min-w-[140px] flex-1 flex-row items-center justify-between gap-2.5 rounded-2xl px-3.5 py-3"
                    style={{
                      borderCurve: "continuous",
                      backgroundColor: selected()
                        ? dark()
                          ? "rgba(56, 189, 248, 0.11)"
                          : "rgba(37, 99, 235, 0.08)"
                        : dark()
                          ? "rgba(0, 0, 0, 0.22)"
                          : "rgba(15, 23, 42, 0.03)",
                      borderWidth: 1,
                      borderColor: selected()
                        ? dark()
                          ? "rgba(56, 189, 248, 0.35)"
                          : "rgba(37, 99, 235, 0.30)"
                        : dark()
                          ? "rgba(255, 255, 255, 0.07)"
                          : "rgba(15, 23, 42, 0.07)",
                    }}
                    hoverStyle={{
                      backgroundColor: selected()
                        ? dark()
                          ? "rgba(56, 189, 248, 0.15)"
                          : "rgba(37, 99, 235, 0.11)"
                        : dark()
                          ? "rgba(255, 255, 255, 0.05)"
                          : "rgba(15, 23, 42, 0.05)",
                    }}
                    activeStyle={{ opacity: 0.82, scale: 0.99 }}
                  >
                    <View class="flex-row items-center gap-2.5">
                      <View
                        class="size-8 items-center justify-center rounded-xl"
                        style={{
                          borderCurve: "continuous",
                          backgroundColor: selected()
                            ? dark()
                              ? "rgba(56, 189, 248, 0.16)"
                              : "rgba(37, 99, 235, 0.12)"
                            : dark()
                              ? "rgba(255, 255, 255, 0.06)"
                              : "rgba(15, 23, 42, 0.05)",
                        }}
                      >
                        <Icon
                          icon={CATEGORY_ICON[cat()]}
                          size={15}
                          color={selected() ? token("primary") : token("muted-foreground")}
                        />
                      </View>
                      <Text
                        class={
                          selected()
                            ? "text-xs font-semibold text-foreground"
                            : "text-xs font-medium text-muted-foreground"
                        }
                      >
                        {CATEGORY_LABEL[cat()]}
                      </Text>
                    </View>
                    {selected() ? (
                      <Icon icon={mdiCheckCircle} size={15} color={token("primary")} />
                    ) : (
                      <View
                        class="size-3.5 rounded-full"
                        style={{
                          borderWidth: 1.5,
                          borderColor: dark()
                            ? "rgba(255, 255, 255, 0.18)"
                            : "rgba(15, 23, 42, 0.18)",
                        }}
                      />
                    )}
                  </View>
                );
              }}
            </Each>
          </View>
        </Card>

        {/* 分组三：外观 */}
        <GroupHeading label="外观主题" />

        <Card title="主题" hint="切换深浅色界面材质，即时生效。">
          <View class="flex-row flex-wrap gap-3">
            <Each of={THEME_MODES}>
              {(mode) => {
                const selected = () => settings().themeMode === mode().id;
                return (
                  <View
                    role="button"
                    onPress={() => patch({ themeMode: mode().id })}
                    class="cursor-pointer min-w-[160px] flex-1 gap-2.5 rounded-2xl p-3"
                    style={{
                      borderCurve: "continuous",
                      backgroundColor: selected()
                        ? dark()
                          ? "rgba(56, 189, 248, 0.10)"
                          : "rgba(37, 99, 235, 0.07)"
                        : dark()
                          ? "rgba(0, 0, 0, 0.22)"
                          : "rgba(15, 23, 42, 0.028)",
                      borderWidth: 1,
                      borderColor: selected()
                        ? dark()
                          ? "rgba(56, 189, 248, 0.38)"
                          : "rgba(37, 99, 235, 0.34)"
                        : dark()
                          ? "rgba(255, 255, 255, 0.07)"
                          : "rgba(15, 23, 42, 0.07)",
                    }}
                    hoverStyle={{
                      borderColor: selected()
                        ? undefined
                        : dark()
                          ? "rgba(255, 255, 255, 0.16)"
                          : "rgba(15, 23, 42, 0.16)",
                    }}
                    activeStyle={{ opacity: 0.85, scale: 0.99 }}
                  >
                    <ThemeSwatch mode={mode().id} />
                    <View class="flex-row items-center justify-between gap-2 px-0.5">
                      <View class="min-w-0 flex-1">
                        <Text
                          class={
                            selected()
                              ? "text-xs font-semibold text-foreground"
                              : "text-xs font-medium text-foreground/85"
                          }
                        >
                          {mode().label}
                        </Text>
                        <Text class="truncate mt-0.5 text-[10px] text-muted-foreground">
                          {mode().desc}
                        </Text>
                      </View>
                      {selected() ? (
                        <Icon icon={mdiCheckCircle} size={15} color={token("primary")} />
                      ) : null}
                    </View>
                  </View>
                );
              }}
            </Each>
          </View>
        </Card>

        {/* 分组四：更新与诊断 */}
        <GroupHeading label="更新与系统维护" />

        <Card
          title="应用更新"
          hint="从 GitHub Releases 检查新版本；启动后和每 6 小时也会自动检查一次。"
          right={
            <View class="flex-row flex-wrap items-center gap-2">
              <Chip
                icon={mdiRefresh}
                label={phase() === "checking" ? "检查中…" : "检查更新"}
                disabled={isBusy()}
                onPress={() => void check(true)}
              />
              {update() ? (
                <Chip
                  label={`下载并安装 ${update()?.version ?? ""}`}
                  selected
                  disabled={isBusy()}
                  onPress={() => void install()}
                />
              ) : null}
            </View>
          }
        >
          {phase() === "downloading" && progress() != null ? (
            <View
              class="h-1.5 w-full overflow-hidden rounded-full"
              style={{
                backgroundColor: dark()
                  ? "rgba(255, 255, 255, 0.08)"
                  : "rgba(15, 23, 42, 0.08)",
              }}
            >
              <View
                class="h-full rounded-full bg-primary"
                style={{ width: `${Math.max(4, Math.min(100, Math.round((progress() ?? 0) * 100)))}%` }}
              />
            </View>
          ) : null}

          {message() ? (
            <View
              class="rounded-xl px-3.5 py-2.5"
              style={{
                borderCurve: "continuous",
                backgroundColor:
                  phase() === "error"
                    ? dark()
                      ? "rgba(244, 63, 94, 0.11)"
                      : "rgba(225, 29, 72, 0.07)"
                    : dark()
                      ? "rgba(0, 0, 0, 0.24)"
                      : "rgba(15, 23, 42, 0.035)",
                borderWidth: 1,
                borderColor:
                  phase() === "error"
                    ? dark()
                      ? "rgba(244, 63, 94, 0.28)"
                      : "rgba(225, 29, 72, 0.22)"
                    : dark()
                      ? "rgba(255, 255, 255, 0.06)"
                      : "rgba(15, 23, 42, 0.06)",
              }}
            >
              <Text
                class={
                  phase() === "error"
                    ? "text-xs leading-relaxed text-destructive"
                    : "text-xs leading-relaxed text-muted-foreground"
                }
                style={{ fontVariant: ["tabular-nums"] }}
              >
                {phase() === "downloading" && progress() != null
                  ? `${message()} ${Math.round((progress() ?? 0) * 100)}%`
                  : message()}
              </Text>
            </View>
          ) : null}

          {update()?.notes ? (
            <View
              class="rounded-xl px-3.5 py-3"
              style={{
                borderCurve: "continuous",
                backgroundColor: dark() ? "rgba(0, 0, 0, 0.22)" : "rgba(15, 23, 42, 0.03)",
                borderWidth: 1,
                borderColor: dark() ? "rgba(255, 255, 255, 0.06)" : "rgba(15, 23, 42, 0.06)",
              }}
            >
              <Text class="text-xs leading-relaxed text-muted-foreground">
                {update()?.notes ?? ""}
              </Text>
            </View>
          ) : null}
        </Card>

        <Card
          title="日志与数据"
          hint="本地日志与设置文件的存放位置，仅保存在本机。"
          right={<Chip label="打开日志目录" onPress={() => void Mouse.openLogDir()} />}
        >
          <View
            class="gap-2 rounded-2xl px-4 py-3"
            style={{
              borderCurve: "continuous",
              backgroundColor: dark() ? "rgba(0, 0, 0, 0.24)" : "rgba(15, 23, 42, 0.032)",
              borderWidth: 1,
              borderColor: dark() ? "rgba(255, 255, 255, 0.06)" : "rgba(15, 23, 42, 0.06)",
            }}
          >
            <Text
              class="text-[11px] leading-relaxed text-muted-foreground"
              style={{ fontFamily: "monospace" }}
            >
              {`日志：${logPath}`}
            </Text>
            <Text
              class="text-[11px] leading-relaxed text-muted-foreground"
              style={{ fontFamily: "monospace" }}
            >
              {`设置：${settingsPath}`}
            </Text>
          </View>
        </Card>

        <Card title="关于">
          <View class="flex-row flex-wrap items-center justify-between gap-2">
            <Text
              class="text-xs text-muted-foreground"
              style={{ fontVariant: ["tabular-nums"] }}
            >
              {`版本 ${Mouse.appVersion()}（NSH 原生版）`}
            </Text>
            <Text class="text-[11px] text-muted-foreground/75">本地 HID 外设电量工具</Text>
          </View>
        </Card>
      </View>
    </Scroll>
  );
}
