/** 首页：左侧按分类列设备，右侧当前设备的电量卡片。数据全部来自 Rust 快照。 */
import { Scroll, signal, Text, View } from "nsh";
import type { Device } from "yugutou/native";
import { Mouse } from "yugutou/native";
import { Chip } from "./Chip";
import {
  clockText,
  hintText,
  LEVEL_BAR,
  LEVEL_LABEL,
  levelFromInfo,
  percentText,
  statusText,
} from "./status";
import {
  CATEGORIES,
  CATEGORY_LABEL,
  deviceById,
  devicesIn,
  pull,
  sampleFor,


  settings,
  type Category,
} from "./store";

function DeviceRow(props: { device: Device; active: boolean; onPress: () => void }) {
  const info = () => sampleFor(props.device.id);
  return (
    <View
      role="button"
      onPress={props.onPress}
      class={
        props.active
          ? "flex-row items-center gap-2 rounded-lg border border-primary bg-accent px-3 py-2"
          : "flex-row items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 active:opacity-70"
      }
    >
      <View class="flex-1 gap-0.5">
        <Text class="text-sm font-medium text-foreground">{props.device.name}</Text>
        <Text class="text-xs text-muted-foreground">{props.device.description}</Text>
      </View>
      <Text class="text-sm text-foreground">{percentText(info())}</Text>
    </View>
  );
}

function CategoryBlock(props: { category: Category; activeId: string; onSelect: (id: string) => void }) {
  const list = devicesIn(props.category);
  return (
    <If when={list.length > 0}>
      <View class="gap-2">
        <Text class="text-xs font-semibold text-muted-foreground">{CATEGORY_LABEL[props.category]}</Text>
        <Each of={list} key={(device) => device.id}>
          {(device) => (
            <DeviceRow
              device={device()}
              active={props.activeId === device().id}
              onPress={() => props.onSelect(device().id)}
            />
          )}
        </Each>
      </View>
    </If>
  );
}

function Stat(props: { label: string; value: string }) {
  return (
    <View class="flex-1 gap-1 rounded-lg border border-border bg-background px-3 py-2">
      <Text class="text-xs text-muted-foreground">{props.label}</Text>
      <Text class="text-sm font-medium text-foreground">{props.value}</Text>
    </View>
  );
}

export function Home() {
  const loading = signal(false);
  const error = signal<string | null>(null);
  const activeId = () => settings().trayDeviceId;
  const device = () => deviceById(activeId());
  const info = () => sampleFor(activeId());
  const level = () => levelFromInfo(info());
  const ratio = () => {
    const i = info();
    if (!i || !i.connected || i.percent == null) return 0;
    return Math.max(0, Math.min(100, i.percent)) / 100;
  };

  async function read(fresh: boolean) {
    const id = activeId();
    loading.set(true);
    error.set(null);
    try {
      await Mouse.read(id, fresh);
    } catch (e) {
      error.set(String(e));
    } finally {
      loading.set(false);
      pull();
    }
  }

  function select(id: string) {
    if (id === activeId()) return;
    Mouse.selectDevice(id);
    pull();
    void read(false);
  }

  // 页面一出现就要一份快照：有新鲜缓存直接用，不额外读 HID。
  void read(false);

  return (
    <View class="flex-1 flex-row">
      <Scroll class="w-72 border-r border-border bg-card">
        <View class="gap-4 p-4">
          <Each of={CATEGORIES}>
            {(category) => <CategoryBlock category={category()} activeId={activeId()} onSelect={select} />}
          </Each>
        </View>
      </Scroll>
      <Scroll class="flex-1">
        <View class="gap-4 p-6">
          <View class="gap-5 rounded-2xl border border-border bg-card p-6">
            <View class="flex-row items-center gap-3">
              <View class="flex-1 gap-1">
                <Text class="text-lg font-semibold text-foreground">{device()?.name ?? "未选择设备"}</Text>
                <Text class="text-xs text-muted-foreground">{info()?.device || device()?.description || ""}</Text>
              </View>
              <Text class="text-sm text-muted-foreground">{LEVEL_LABEL[level()]}</Text>
            </View>
            <View class="flex-row items-end gap-3">
              <Text class="text-6xl font-bold text-foreground">{percentText(info())}</Text>
              <Text class="pb-2 text-sm text-muted-foreground">{statusText(info(), loading(), error())}</Text>
            </View>
            <View class="h-3 overflow-hidden rounded-full bg-muted">
              <View class={`h-3 rounded-full ${LEVEL_BAR[level()]}`} style={{ width: `${ratio() * 100}%` }} />
            </View>
            <Text class="text-sm text-muted-foreground">
              {error() ?? hintText(info(), loading(), error(), settings().autoRefresh)}
            </Text>
            <If when={info()?.modelUncertain === true}>
              <Text class="text-xs text-amber-600">接收器型号未确认，电量可能不准。</Text>
            </If>
            <View class="flex-row gap-2">
              <Chip label={loading() ? "读取中…" : "立即刷新"} disabled={loading()} onPress={() => void read(true)} />
              <Chip
                label={settings().autoRefresh ? "暂停自动刷新" : "开启自动刷新"}
                onPress={() => {
                  Mouse.updateSettings({ autoRefresh: !settings().autoRefresh });
                  pull();
                }}
              />
            </View>
            <View class="flex-row gap-2">
              <Stat label="连接" value={info()?.connected ? "已连接" : "未连接"} />
              <Stat label="充电" value={info()?.charging ? "充电中" : "未充电"} />
              <Stat label="最近更新" value={clockText(info()?.atMs ?? null)} />
              <Stat label="采样间隔" value={`${settings().autoIntervalSec} 秒`} />
            </View>
            <If when={!!info()?.detail}>
              <Text class="text-xs text-muted-foreground">{info()?.detail ?? ""}</Text>
            </If>
          </View>
        </View>
      </Scroll>
    </View>
  );
}
