/** 电量 hero 卡：设备名与徽标、电量环、状态与操作、三格统计、可折叠诊断。对应老版 BatteryCard。 */
import { colorScheme, signal, Text, token, View } from "nsh";
import type { Battery } from "yugutou/native";
import { BatteryGauge } from "./BatteryGauge";
import { mdiAlertCircleOutline, mdiChevronDown, mdiFlash, mdiHelpCircleOutline, mdiPause, mdiPlay, mdiRefresh } from "./icons";
import {
  chargingText,
  clockText,
  connectionText,
  hintText,
  levelFromInfo,
  modelUncertainText,
  percentText,
  statusText,
  truncate,
} from "./status";
import { Icon } from "./vendor/supernsh-icons";

function Stat(props: { label: string; value: string; first?: boolean }) {
  return (
    <View class={props.first ? "flex-1 px-4 py-3" : "flex-1 border-l border-border/60 px-4 py-3"}>
      <Text class="text-[10px] font-medium tracking-[0.16em] text-muted-foreground">{props.label}</Text>
      <Text class="truncate mt-1 text-sm font-medium text-foreground">
        {props.value}
      </Text>
    </View>
  );
}

function Dot(props: { on: boolean }) {
  return <View class={props.on ? "size-1.5 rounded-full bg-emerald-500" : "size-1.5 rounded-full bg-muted-foreground/50"} />;
}

export function BatteryCard(props: {
  deviceName: string;
  info: Battery | null;
  loading: boolean;
  auto: boolean;
  autoIntervalSec: number;
  error: string | null;
  onRefresh: () => void;
  onToggleAuto: () => void;
}) {
  const open = signal(false);
  const level = () => levelFromInfo(props.info);
  const connected = () => Boolean(props.info?.connected);
  const charging = () => Boolean(props.info?.charging);
  const dark = () => colorScheme() === "dark";

  return (
    <View
      class="w-full max-w-[860px] overflow-hidden rounded-[28px] border border-border/70 bg-card/80 p-8"
      style={{
        boxShadow: "0 24px 80px -48px rgba(0, 0, 0, 0.55)",
        backgroundImage: dark()
          ? "radial-gradient(circle at 100% 0%, rgba(60, 143, 244, 0.12) 0%, rgba(60, 143, 244, 0) 38%)"
          : "radial-gradient(circle at 100% 0%, rgba(29, 78, 216, 0.08) 0%, rgba(29, 78, 216, 0) 38%)",
      }}
    >
      {/* 头部：当前设备 + 徽标；右上自动刷新状态 */}
      <View class="flex-row flex-wrap items-start justify-between gap-4">
        <View class="min-w-0 flex-1">
          <Text class="text-[10px] font-medium tracking-[0.2em] text-muted-foreground">当前设备</Text>
          <Text class="truncate mt-1.5 text-2xl font-semibold text-foreground">
            {props.deviceName}
          </Text>
          <View class="mt-2.5 flex-row flex-wrap items-center gap-2">
            <View
              class={
                connected()
                  ? "flex-row items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-0.5"
                  : "flex-row items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-2.5 py-0.5"
              }
            >
              <Dot on={connected()} />
              <Text
                class={
                  connected()
                    ? "text-[11px] font-medium text-emerald-600 dark:text-emerald-400"
                    : "text-[11px] font-medium text-muted-foreground"
                }
              >
                {connectionText(props.info, props.error)}
              </Text>
            </View>
            {charging() ? (
              <View class="flex-row items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-0.5">
                <Icon icon={mdiFlash} size={12} color={dark() ? "#fbbf24" : "#d97706"} />
                <Text class="text-[11px] font-medium text-amber-600 dark:text-amber-400">充电中</Text>
              </View>
            ) : null}
            {modelUncertainText(props.info) ? (
              <View
                class="flex-row items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2.5 py-0.5"
                tooltip="2.4G 接收器 PID 由同系列多型号共用，无法从 HID 区分具体型号"
              >
                <Icon icon={mdiHelpCircleOutline} size={12} color={token("muted-foreground")} />
                <Text class="text-[11px] font-medium text-muted-foreground">{modelUncertainText(props.info) ?? ""}</Text>
              </View>
            ) : null}
          </View>
        </View>
        <View class="flex-row items-center gap-1.5 rounded-full border border-border/60 bg-background/40 px-3 py-1.5">
          <Dot on={props.auto} />
          <Text class="text-[11px] text-muted-foreground">
            {props.auto ? `自动刷新 ${props.autoIntervalSec}s` : "自动刷新已暂停"}
          </Text>
        </View>
      </View>

      {/* 电量环 + 状态与操作 */}
      <View class="mt-7 flex-row items-center gap-7">
        <BatteryGauge level={level()} text={percentText(props.info)} charging={charging()} />
        <View class="min-w-0 flex-1">
          <Text class="text-lg font-medium text-foreground">{statusText(props.info, props.loading, props.error)}</Text>
          <Text class="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {hintText(props.info, props.loading, props.error, props.auto)}
          </Text>
          <View class="mt-6 flex-row flex-wrap gap-2">
            <View
              role="button"
              accessibilityLabel="立即刷新"
              onPress={() => {
                if (!props.loading) props.onRefresh();
              }}
              class="cursor-pointer h-8 flex-row items-center gap-2 rounded-full bg-primary px-4 hover:opacity-90 active:opacity-80"
              style={{ opacity: props.loading ? 0.5 : 1 }}
            >
              <Icon icon={mdiRefresh} size={16} color={token("primary-foreground")} />
              <Text class="text-sm font-medium text-primary-foreground">{props.loading ? "读取中…" : "立即刷新"}</Text>
            </View>
            <View
              role="button"
              accessibilityLabel={props.auto ? "暂停自动刷新" : "开始自动刷新"}
              onPress={props.onToggleAuto}
              class="cursor-pointer h-8 flex-row items-center gap-2 rounded-full border border-border px-4 hover:bg-accent active:opacity-80"
            >
              <Icon icon={props.auto ? mdiPause : mdiPlay} size={16} color={token("foreground")} />
              <Text class="text-sm font-medium text-foreground">{props.auto ? "暂停自动刷新" : "开始自动刷新"}</Text>
            </View>
          </View>
        </View>
      </View>

      {props.error ? (
        <View class="mt-6 flex-row items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2">
          <Icon icon={mdiAlertCircleOutline} size={16} color={token("destructive")} />
          <Text class="min-w-0 flex-1 text-xs text-destructive">{`读取失败：${truncate(props.error ?? "")}`}</Text>
        </View>
      ) : null}

      {/* 三格统计 */}
      <View class="mt-6 flex-row overflow-hidden rounded-2xl border border-border/60 bg-background/40">
        <Stat first label="连接" value={connectionText(props.info, props.error)} />
        <Stat label="充电" value={chargingText(props.info)} />
        <Stat label="最后刷新" value={clockText(props.info?.atMs ?? null)} />
      </View>

      {/* 可折叠诊断详情：设备描述与协议信息 */}
      <View class="mt-4 rounded-xl border border-border/60 bg-background/30 px-4 py-3">
        <View
          role="button"
          accessibilityLabel="诊断详情"
          onPress={() => open.update((v) => !v)}
          class="cursor-pointer flex-row items-center justify-between"
        >
          <Text class="text-xs text-muted-foreground">诊断详情</Text>
          <View style={{ transform: [{ rotate: open() ? "180deg" : "0deg" }] }}>
            <Icon icon={mdiChevronDown} size={16} color={token("muted-foreground")} />
          </View>
        </View>
        {open() ? (
          <View class="mt-3 gap-2">
            <Text class="text-[11px] leading-relaxed text-muted-foreground">{props.info?.device || "—"}</Text>
            <Text class="text-[11px] leading-relaxed text-muted-foreground">{props.info?.detail || props.error || "—"}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
