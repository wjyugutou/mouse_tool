/** 设置页：每项改动都交给 Rust（`Mouse.updateSettings` 等），再取回快照。 */
import { Scroll, signal, Text, View, type JSX } from "nsh";
import { Mouse } from "yugutou/native";
import { Chip } from "./Chip";
import { CATEGORIES, CATEGORY_LABEL, pull, settings } from "./store";

const INTERVALS = [3, 5, 10, 30, 60, 120, 300];

function Section(props: { title: string; hint?: string; children?: JSX.Element }) {
  return (
    <View class="gap-3 rounded-2xl border border-border bg-card p-5">
      <Text class="text-sm font-semibold text-foreground">{props.title}</Text>
      {props.hint ? <Text class="text-xs text-muted-foreground">{props.hint}</Text> : null}
      {props.children}
    </View>
  );
}

function patch(p: Parameters<typeof Mouse.updateSettings>[0]) {
  Mouse.updateSettings(p);
  pull();
}

export function SettingsPage() {
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
    <Scroll class="flex-1">
      <View class="gap-4 p-6">
        <Section title="自动刷新间隔" hint="后台按这个间隔读一次电量，托盘和首页共用这次结果。">
          <View class="flex-row flex-wrap gap-2">
            <Each of={INTERVALS}>
              {(sec) => (
                <Chip
                  label={sec() >= 60 ? `${sec() / 60} 分钟` : `${sec()} 秒`}
                  selected={settings().autoIntervalSec === sec()}
                  onPress={() => patch({ autoIntervalSec: sec() })}
                />
              )}
            </Each>
          </View>
          <View class="flex-row gap-2">
            <Chip
              label="自动刷新开启"
              selected={settings().autoRefresh}
              onPress={() => patch({ autoRefresh: true })}
            />
            <Chip
              label="自动刷新暂停"
              selected={!settings().autoRefresh}
              onPress={() => patch({ autoRefresh: false })}
            />
          </View>
        </Section>

        <Section title="关闭窗口时">
          <View class="flex-row gap-2">
            <Chip
              label="隐藏到托盘"
              selected={settings().closeBehavior !== "quit"}
              onPress={() => patch({ closeBehavior: "tray" })}
            />
            <Chip
              label="退出程序"
              selected={settings().closeBehavior === "quit"}
              onPress={() => patch({ closeBehavior: "quit" })}
            />
          </View>
        </Section>

        <Section title="托盘显示" hint="托盘图标按分类各画一格电量，至少保留一个分类。">
          <View class="flex-row gap-2">
            <Each of={CATEGORIES}>
              {(cat) => (
                <Chip
                  label={CATEGORY_LABEL[cat()]}
                  selected={settings().trayCategories.includes(cat())}
                  onPress={() => toggleCategory(cat())}
                />
              )}
            </Each>
          </View>
        </Section>

        <Section title="主题">
          <View class="flex-row gap-2">
            <Chip label="跟随系统" selected={settings().themeMode === "system"} onPress={() => patch({ themeMode: "system" })} />
            <Chip label="浅色" selected={settings().themeMode === "light"} onPress={() => patch({ themeMode: "light" })} />
            <Chip label="深色" selected={settings().themeMode === "dark"} onPress={() => patch({ themeMode: "dark" })} />
          </View>
        </Section>

        <Section title="开机自启" hint="开机启动时只进托盘，不弹出主窗口。">
          <View class="flex-row gap-2">
            <Chip label="开启" selected={autostart()} onPress={() => setAutostart(true)} />
            <Chip label="关闭" selected={!autostart()} onPress={() => setAutostart(false)} />
          </View>
          {autostartError() ? <Text class="text-xs text-destructive">{autostartError() ?? ""}</Text> : null}
        </Section>

        <Section title="日志与数据">
          <Text class="text-xs text-muted-foreground">{`日志：${logPath}`}</Text>
          <Text class="text-xs text-muted-foreground">{`设置：${settingsPath}`}</Text>
          <View class="flex-row gap-2">
            <Chip label="打开日志目录" onPress={() => void Mouse.openLogDir()} />
          </View>
        </Section>

        <Section title="关于">
          <Text class="text-xs text-muted-foreground">{`版本 ${Mouse.appVersion()}（NSH 原生版）`}</Text>
        </Section>
      </View>
    </Scroll>
  );
}
