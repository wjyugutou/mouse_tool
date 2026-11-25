/** 电量主控仪表台：设备信息头、60 刻度能量环、10 格精密电芯标尺、操控按钮、三联遥测数据仓与折叠诊断抽屉。 */
import { colorScheme, signal, Text, token, View } from "nsh";
import type { Battery } from "yugutou/native";
import { BatteryGauge } from "./BatteryGauge";
import {
  mdiAlertCircleOutline,
  mdiChevronDown,
  mdiFlash,
  mdiHelpCircleOutline,
  mdiPause,
  mdiPlay,
  mdiRefresh,
} from "./icons";
import {
  chargingText,
  clockText,
  connectionText,
  hintText,
  levelFromInfo,
  levelPalette,
  modelUncertainText,
  percentNumber,
  percentText,
  statusText,
  truncate,
} from "./status";
import { type IconData, Icon } from "./vendor/supernsh-icons";

const CELL_INDEXES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

function TelemetryTile(props: {
  label: string;
  value: string;
  accent?: string;
  icon?: IconData;
  dotOn?: boolean;
  tabular?: boolean;
}) {
  const dark = () => colorScheme() === "dark";

  return (
    <View
      class="flex-1 rounded-2xl px-4 py-3"
      style={{
        borderCurve: "continuous",
        backgroundColor: dark() ? "rgba(0, 0, 0, 0.24)" : "rgba(15, 23, 42, 0.032)",
        borderWidth: 1,
        borderColor: dark() ? "rgba(255, 255, 255, 0.065)" : "rgba(15, 23, 42, 0.065)",
      }}
    >
      <View class="flex-row items-center justify-between gap-2">
        <Text class="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground">
          {props.label}
        </Text>
        {props.icon ? (
          <Icon icon={props.icon} size={13} color={props.accent ?? token("muted-foreground")} />
        ) : props.dotOn !== undefined ? (
          <View
            class="size-2 rounded-full"
            style={{
              backgroundColor: props.dotOn
                ? (props.accent ?? (dark() ? "#34d399" : "#059669"))
                : dark()
                  ? "rgba(148, 163, 184, 0.35)"
                  : "rgba(100, 116, 139, 0.35)",
              boxShadow:
                props.dotOn && props.accent
                  ? `0 0 8px ${props.accent}`
                  : undefined,
            }}
          />
        ) : null}
      </View>
      <Text
        class="truncate mt-1.5 text-[14px] font-semibold text-foreground"
        style={props.tabular ? { fontVariant: ["tabular-nums"] } : undefined}
      >
        {props.value}
      </Text>
    </View>
  );
}

/** 10 格精密电芯能量标尺：把百分比具象为硬件电芯矩阵。 */
function CellMatrix(props: { percent: number | null; rgb: string; accent: string }) {
  const dark = () => colorScheme() === "dark";

  return (
    <View class="mt-4">
      <View class="flex-row items-center justify-between">
        <Text class="text-[10px] font-medium tracking-[0.14em] text-muted-foreground">
          能量矩阵
        </Text>
        <Text
          class="text-[10px] font-medium text-muted-foreground/80"
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {props.percent != null ? `${props.percent} / 100` : "-- / 100"}
        </Text>
      </View>
      <View class="mt-2 flex-row gap-1.5">
        <Each of={CELL_INDEXES}>
          {(idx) => {
            const fillRatio = () => {
              const p = props.percent;
              if (p == null) return 0;
              return Math.max(0, Math.min(1, (p - idx() * 10) / 10));
            };
            return (
              <View
                class="h-2 flex-1 rounded-[3px]"
                style={{
                  backgroundColor:
                    fillRatio() > 0
                      ? `rgba(${props.rgb}, ${0.28 + fillRatio() * 0.72})`
                      : dark()
                        ? "rgba(255, 255, 255, 0.065)"
                        : "rgba(15, 23, 42, 0.075)",
                  boxShadow:
                    fillRatio() >= 0.9 && dark()
                      ? `0 0 8px rgba(${props.rgb}, 0.35)`
                      : undefined,
                }}
              />
            );
          }}
        </Each>
      </View>
    </View>
  );
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
  const dark = () => colorScheme() === "dark";
  const level = () => levelFromInfo(props.info);
  const pct = () => percentNumber(props.info);
  const connected = () => Boolean(props.info?.connected);
  const charging = () => Boolean(props.info?.charging);
  const palette = () => levelPalette(level(), dark());

  return (
    <View
      class="relative w-full max-w-[840px] overflow-hidden rounded-[28px] bg-card"
      style={{
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: dark() ? "rgba(255, 255, 255, 0.09)" : "rgba(15, 23, 42, 0.08)",
        boxShadow: dark()
          ? "0 30px 90px -44px rgba(0, 0, 0, 0.85), inset 0 1px 0 rgba(255, 255, 255, 0.08)"
          : "0 24px 64px -36px rgba(15, 23, 42, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.95)",
        backgroundImage: dark()
          ? `radial-gradient(circle at 100% 0%, rgba(${palette().rgb}, 0.14) 0%, rgba(${palette().rgb}, 0) 42%)`
          : `radial-gradient(circle at 100% 0%, rgba(${palette().rgb}, 0.08) 0%, rgba(${palette().rgb}, 0) 42%)`,
      }}
    >
      {/* 顶部细微能量状态灯带 */}
      <View
        style={{
          height: 2,
          width: "100%",
          backgroundImage: `linear-gradient(90deg, rgba(${palette().rgb}, 0) 0%, rgba(${palette().rgb}, ${dark() ? 0.72 : 0.55}) 50%, rgba(${palette().rgb}, 0) 100%)`,
        }}
      />

      <View class="p-7">
        {/* 页眉：当前设备 + 状态胶囊；右上遥测刷新徽标 */}
        <View class="flex-row flex-wrap items-start justify-between gap-4">
          <View class="min-w-0 flex-1">
            <View class="flex-row items-center gap-2">
              <View
                class="rounded-full"
                style={{
                  width: 14,
                  height: 2,
                  backgroundColor: palette().accent,
                }}
              />
              <Text class="text-[10px] font-semibold tracking-[0.22em] text-muted-foreground">
                当前设备
              </Text>
            </View>

            <Text
              class="truncate mt-2 text-[26px] font-semibold text-foreground"
              style={{ letterSpacing: -0.5 }}
            >
              {props.deviceName}
            </Text>

            <View class="mt-2.5 flex-row flex-wrap items-center gap-2">
              <View
                class="flex-row items-center gap-1.5 rounded-full px-2.5 py-0.5"
                style={{
                  backgroundColor: connected()
                    ? dark()
                      ? "rgba(16, 185, 129, 0.14)"
                      : "rgba(5, 150, 105, 0.10)"
                    : dark()
                      ? "rgba(255, 255, 255, 0.05)"
                      : "rgba(15, 23, 42, 0.05)",
                  borderWidth: 1,
                  borderColor: connected()
                    ? dark()
                      ? "rgba(52, 211, 153, 0.30)"
                      : "rgba(5, 150, 105, 0.24)"
                    : dark()
                      ? "rgba(255, 255, 255, 0.08)"
                      : "rgba(15, 23, 42, 0.08)",
                }}
              >
                <View
                  class="size-1.5 rounded-full"
                  style={{
                    backgroundColor: connected()
                      ? dark()
                        ? "#34d399"
                        : "#059669"
                      : dark()
                        ? "rgba(148, 163, 184, 0.5)"
                        : "rgba(100, 116, 139, 0.5)",
                    boxShadow: connected()
                      ? dark()
                        ? "0 0 6px rgba(52, 211, 153, 0.8)"
                        : undefined
                      : undefined,
                  }}
                />
                <Text
                  class="text-[11px] font-medium"
                  style={{
                    color: connected()
                      ? dark()
                        ? "#6ee7b7"
                        : "#047857"
                      : token("muted-foreground"),
                  }}
                >
                  {connectionText(props.info, props.error)}
                </Text>
              </View>

              {charging() ? (
                <View
                  class="flex-row items-center gap-1 rounded-full px-2.5 py-0.5"
                  style={{
                    backgroundColor: dark()
                      ? "rgba(56, 189, 248, 0.14)"
                      : "rgba(2, 132, 199, 0.10)",
                    borderWidth: 1,
                    borderColor: dark()
                      ? "rgba(56, 189, 248, 0.32)"
                      : "rgba(2, 132, 199, 0.24)",
                  }}
                >
                  <Icon icon={mdiFlash} size={12} color={dark() ? "#7dd3fc" : "#0284c7"} />
                  <Text
                    class="text-[11px] font-medium"
                    style={{ color: dark() ? "#7dd3fc" : "#0369a1" }}
                  >
                    充电中
                  </Text>
                </View>
              ) : null}

              {modelUncertainText(props.info) ? (
                <View
                  class="flex-row items-center gap-1 rounded-full px-2.5 py-0.5"
                  tooltip="2.4G 接收器 PID 由同系列多型号共用，无法从 HID 区分具体型号"
                  style={{
                    backgroundColor: dark()
                      ? "rgba(255, 255, 255, 0.05)"
                      : "rgba(15, 23, 42, 0.045)",
                    borderWidth: 1,
                    borderColor: dark()
                      ? "rgba(255, 255, 255, 0.09)"
                      : "rgba(15, 23, 42, 0.08)",
                  }}
                >
                  <Icon icon={mdiHelpCircleOutline} size={12} color={token("muted-foreground")} />
                  <Text class="text-[11px] font-medium text-muted-foreground">
                    {modelUncertainText(props.info) ?? ""}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          <View
            class="flex-row items-center gap-2 rounded-full px-3 py-1.5"
            style={{
              backgroundColor: dark() ? "rgba(0, 0, 0, 0.28)" : "rgba(15, 23, 42, 0.04)",
              borderWidth: 1,
              borderColor: dark() ? "rgba(255, 255, 255, 0.08)" : "rgba(15, 23, 42, 0.07)",
            }}
          >
            <View
              class="size-1.5 rounded-full"
              style={{
                backgroundColor: props.auto
                  ? dark()
                    ? "#34d399"
                    : "#059669"
                  : dark()
                    ? "rgba(148, 163, 184, 0.45)"
                    : "rgba(100, 116, 139, 0.45)",
              }}
            />
            <Text
              class="text-[11px] font-medium text-muted-foreground"
              style={{ fontVariant: ["tabular-nums"] }}
            >
              {props.auto ? `自动刷新 ${props.autoIntervalSec}s` : "自动刷新已暂停"}
            </Text>
          </View>
        </View>

        {/* 核心仪表区：左 60 刻度环 + 右状态、电芯矩阵与操作按钮 */}
        <View class="mt-7 flex-row flex-wrap items-center gap-8">
          <BatteryGauge level={level()} text={percentText(props.info)} charging={charging()} />

          <View class="min-w-[230px] flex-1">
            <Text
              class="text-[20px] font-semibold text-foreground"
              style={{ letterSpacing: -0.3 }}
            >
              {statusText(props.info, props.loading, props.error)}
            </Text>
            <Text class="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
              {hintText(props.info, props.loading, props.error, props.auto)}
            </Text>

            <CellMatrix percent={pct()} rgb={palette().rgb} accent={palette().accent} />

            {/* 操作按钮组 */}
            <View class="mt-6 flex-row flex-wrap items-center gap-2.5">
              <View
                role="button"
                accessibilityLabel="立即刷新"
                onPress={() => {
                  if (!props.loading) props.onRefresh();
                }}
                class="cursor-pointer h-9 flex-row items-center gap-2 rounded-xl bg-primary px-4"
                style={{
                  borderCurve: "continuous",
                  opacity: props.loading ? 0.55 : 1,
                  boxShadow: dark()
                    ? "0 8px 20px -8px rgba(56, 189, 248, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.25)"
                    : "0 8px 18px -8px rgba(37, 99, 235, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.25)",
                }}
                hoverStyle={props.loading ? undefined : { opacity: 0.92 }}
                activeStyle={props.loading ? undefined : { opacity: 0.82, scale: 0.98 }}
              >
                <Icon icon={mdiRefresh} size={15} color={token("primary-foreground")} />
                <Text class="text-[13px] font-semibold text-primary-foreground">
                  {props.loading ? "读取中…" : "立即刷新"}
                </Text>
              </View>

              <View
                role="button"
                accessibilityLabel={props.auto ? "暂停自动刷新" : "开始自动刷新"}
                onPress={props.onToggleAuto}
                class="cursor-pointer h-9 flex-row items-center gap-2 rounded-xl px-4"
                style={{
                  borderCurve: "continuous",
                  backgroundColor: dark()
                    ? "rgba(255, 255, 255, 0.05)"
                    : "rgba(15, 23, 42, 0.04)",
                  borderWidth: 1,
                  borderColor: dark()
                    ? "rgba(255, 255, 255, 0.11)"
                    : "rgba(15, 23, 42, 0.10)",
                }}
                hoverStyle={{
                  backgroundColor: dark()
                    ? "rgba(255, 255, 255, 0.09)"
                    : "rgba(15, 23, 42, 0.075)",
                }}
                activeStyle={{ opacity: 0.8, scale: 0.98 }}
              >
                <Icon icon={props.auto ? mdiPause : mdiPlay} size={15} color={token("foreground")} />
                <Text class="text-[13px] font-medium text-foreground">
                  {props.auto ? "暂停自动刷新" : "开始自动刷新"}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* 错误警示条 */}
        {props.error ? (
          <View
            class="mt-6 flex-row items-start gap-2.5 overflow-hidden rounded-xl px-3.5 py-2.5"
            style={{
              borderCurve: "continuous",
              backgroundColor: dark()
                ? "rgba(244, 63, 94, 0.11)"
                : "rgba(225, 29, 72, 0.07)",
              borderWidth: 1,
              borderColor: dark()
                ? "rgba(244, 63, 94, 0.28)"
                : "rgba(225, 29, 72, 0.22)",
              borderLeftWidth: 3,
              borderLeftColor: token("destructive"),
            }}
          >
            <Icon icon={mdiAlertCircleOutline} size={16} color={token("destructive")} />
            <Text class="min-w-0 flex-1 text-xs leading-relaxed text-destructive">
              {`读取失败：${truncate(props.error ?? "")}`}
            </Text>
          </View>
        ) : null}

        {/* 三联遥测数据仓 */}
        <View class="mt-7 flex-row gap-3">
          <TelemetryTile
            label="连接"
            value={connectionText(props.info, props.error)}
            dotOn={connected()}
            accent={connected() ? (dark() ? "#34d399" : "#059669") : undefined}
          />
          <TelemetryTile
            label="充电"
            value={chargingText(props.info)}
            icon={mdiFlash}
            accent={charging() ? (dark() ? "#7dd3fc" : "#0284c7") : undefined}
          />
          <TelemetryTile
            label="最后刷新"
            value={clockText(props.info?.atMs ?? null)}
            icon={mdiRefresh}
            tabular
          />
        </View>

        {/* 可折叠硬件诊断面板 */}
        <View
          class="mt-4 overflow-hidden rounded-2xl"
          style={{
            borderCurve: "continuous",
            backgroundColor: dark() ? "rgba(0, 0, 0, 0.22)" : "rgba(15, 23, 42, 0.028)",
            borderWidth: 1,
            borderColor: dark() ? "rgba(255, 255, 255, 0.065)" : "rgba(15, 23, 42, 0.065)",
          }}
        >
          <View
            role="button"
            accessibilityLabel="诊断详情"
            onPress={() => open.update((v) => !v)}
            class="cursor-pointer flex-row items-center justify-between gap-3 px-4 py-3"
            hoverStyle={{
              backgroundColor: dark() ? "rgba(255, 255, 255, 0.03)" : "rgba(15, 23, 42, 0.025)",
            }}
          >
            <View class="min-w-0 flex-1 flex-row items-center gap-2.5">
              <Text class="text-xs font-medium text-muted-foreground">诊断详情</Text>
              {!open() && props.info?.device ? (
                <Text
                  class="truncate shrink text-[11px] text-muted-foreground/65"
                  style={{ fontFamily: "monospace" }}
                >
                  {props.info.device}
                </Text>
              ) : null}
            </View>
            <View style={{ transform: [{ rotate: open() ? "180deg" : "0deg" }] }}>
              <Icon icon={mdiChevronDown} size={16} color={token("muted-foreground")} />
            </View>
          </View>

          {open() ? (
            <View
              class="gap-2.5 border-t px-4 py-3.5"
              style={{
                borderTopColor: dark() ? "rgba(255, 255, 255, 0.06)" : "rgba(15, 23, 42, 0.06)",
                backgroundColor: dark() ? "rgba(0, 0, 0, 0.2)" : "rgba(15, 23, 42, 0.02)",
              }}
            >
              <View class="gap-1">
                <Text class="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground/75">
                  硬件标识
                </Text>
                <Text
                  class="text-[11px] leading-relaxed text-foreground/85"
                  style={{ fontFamily: "monospace" }}
                >
                  {props.info?.device || "—"}
                </Text>
              </View>
              <View class="gap-1">
                <Text class="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground/75">
                  协议报文与状态
                </Text>
                <Text
                  class="text-[11px] leading-relaxed text-muted-foreground"
                  style={{ fontFamily: "monospace" }}
                >
                  {props.info?.detail || props.error || "—"}
                </Text>
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}
