/** 外设控制坞侧栏：MorphBot 电子视窗、三段式分类开关、带实时微电量的设备列表、底部遥测状态栏。 */
import { colorScheme, effect, Scroll, signal, Text, token, untracked, View } from "nsh";
import type { Battery, Device } from "yugutou/native";
import { mdiCheckCircle, mdiFlash, mdiHeadphones, mdiKeyboard, mdiMouse } from "./icons";
import { MorphBot } from "./morph-bot/MorphBot";
import { levelFromInfo, levelPalette, percentNumber } from "./status";
import {
  CATEGORIES,
  CATEGORY_LABEL,
  deviceById,
  devices,
  devicesIn,
  sampleFor,
  selectedIn,
  settings,
  type Category,
} from "./store";
import { type IconData, Icon } from "./vendor/supernsh-icons";

const CATEGORY_ICON: Record<Category, IconData> = {
  mouse: mdiMouse,
  keyboard: mdiKeyboard,
  headset: mdiHeadphones,
};

function CategoryTab(props: { category: Category; active: boolean; onPress: () => void }) {
  const dark = () => colorScheme() === "dark";

  return (
    <View
      role="tab"
      accessibilityLabel={CATEGORY_LABEL[props.category]}
      onPress={props.onPress}
      class={
        props.active
          ? "cursor-pointer flex-1 flex-row items-center justify-center gap-1.5 rounded-[10px] bg-card px-2 py-1.5"
          : "cursor-pointer flex-1 flex-row items-center justify-center gap-1.5 rounded-[10px] px-2 py-1.5"
      }
      style={{
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: props.active
          ? dark()
            ? "rgba(255, 255, 255, 0.10)"
            : "rgba(15, 23, 42, 0.08)"
          : "transparent",
        boxShadow: props.active
          ? dark()
            ? "0 2px 6px rgba(0, 0, 0, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.08)"
            : "0 2px 6px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.9)"
          : undefined,
      }}
      hoverStyle={
        props.active
          ? undefined
          : {
              backgroundColor: dark() ? "rgba(255, 255, 255, 0.05)" : "rgba(15, 23, 42, 0.04)",
            }
      }
      activeStyle={{ opacity: 0.8 }}
    >
      <Icon
        icon={CATEGORY_ICON[props.category]}
        size={13}
        color={props.active ? token("primary") : token("muted-foreground")}
      />
      <Text
        class={
          props.active
            ? "text-[11px] font-semibold text-foreground"
            : "text-[11px] font-medium text-muted-foreground"
        }
      >
        {CATEGORY_LABEL[props.category]}
      </Text>
    </View>
  );
}

function DeviceItem(props: { device: Device; selected: boolean; onPress: () => void }) {
  const dark = () => colorScheme() === "dark";
  const sample = () => sampleFor(props.device.id);
  const level = () => levelFromInfo(sample());
  const pct = () => percentNumber(sample());
  const palette = () => levelPalette(level(), dark());
  const connected = () => Boolean(sample()?.connected);
  const charging = () => Boolean(sample()?.charging);

  return (
    <View
      role="button"
      accessibilityLabel={props.device.name}
      tooltip={props.device.description}
      onPress={props.onPress}
      class={
        props.selected
          ? "cursor-pointer relative flex-row items-center gap-3 rounded-2xl bg-card px-3 py-2.5"
          : "cursor-pointer relative flex-row items-center gap-3 rounded-2xl px-3 py-2.5"
      }
      style={{
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: props.selected
          ? connected()
            ? palette().softBorder
            : dark()
              ? "rgba(125, 211, 252, 0.30)"
              : "rgba(37, 99, 235, 0.25)"
          : "transparent",
        boxShadow: props.selected
          ? dark()
            ? "0 8px 20px -12px rgba(0, 0, 0, 0.72), inset 0 1px 0 rgba(255, 255, 255, 0.07)"
            : "0 6px 16px -10px rgba(15, 23, 42, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.9)"
          : undefined,
      }}
      hoverStyle={
        props.selected
          ? undefined
          : {
              backgroundColor: dark() ? "rgba(255, 255, 255, 0.045)" : "rgba(15, 23, 42, 0.035)",
              borderColor: dark() ? "rgba(255, 255, 255, 0.07)" : "rgba(15, 23, 42, 0.06)",
            }
      }
      activeStyle={{ opacity: 0.84 }}
    >
      {/* 选中态左侧能量光条 */}
      {props.selected ? (
        <View
          class="absolute bottom-2.5 left-0 top-2.5 rounded-r-full"
          style={{
            width: 3,
            backgroundColor: connected() ? palette().accent : token("primary"),
            boxShadow: connected()
              ? `0 0 8px rgba(${palette().rgb}, 0.65)`
              : dark()
                ? "0 0 8px rgba(125, 211, 252, 0.55)"
                : undefined,
          }}
        />
      ) : null}

      {/* 设备类别图标槽 */}
      <View
        class="size-9 shrink-0 items-center justify-center rounded-xl"
        style={{
          borderCurve: "continuous",
          backgroundColor: props.selected
            ? connected()
              ? palette().softBg
              : dark()
                ? "rgba(125, 211, 252, 0.12)"
                : "rgba(37, 99, 235, 0.09)"
            : dark()
              ? "rgba(255, 255, 255, 0.05)"
              : "rgba(15, 23, 42, 0.045)",
          borderWidth: 1,
          borderColor: props.selected
            ? connected()
              ? palette().softBorder
              : dark()
                ? "rgba(125, 211, 252, 0.24)"
                : "rgba(37, 99, 235, 0.18)"
            : "transparent",
        }}
      >
        <Icon
          icon={CATEGORY_ICON[props.device.category as Category] ?? mdiMouse}
          size={16}
          color={
            props.selected
              ? connected()
                ? palette().accent
                : token("primary")
              : token("muted-foreground")
          }
        />
      </View>

      {/* 设备名称与描述 */}
      <View class="min-w-0 flex-1">
        <View class="flex-row items-center gap-1.5">
          <Text
            class={
              props.selected
                ? "truncate shrink text-[13px] font-semibold text-foreground"
                : "truncate shrink text-[13px] font-medium text-foreground/90"
            }
          >
            {props.device.name}
          </Text>
        </View>
        <Text class="truncate mt-0.5 text-[11px] text-muted-foreground">
          {props.device.description}
        </Text>
      </View>

      {/* 右侧实时微电量徽标（直接读取 hub 采样快照，零额外请求） */}
      {connected() && (pct() != null || charging()) ? (
        <View
          class="shrink-0 flex-row items-center gap-1 rounded-full px-2 py-0.5"
          style={{
            backgroundColor: palette().softBg,
            borderWidth: 1,
            borderColor: palette().softBorder,
          }}
        >
          {charging() ? (
            <Icon icon={mdiFlash} size={10} color={palette().accent} />
          ) : (
            <View class="size-1.5 rounded-full" style={{ backgroundColor: palette().accent }} />
          )}
          {pct() != null ? (
            <Text
              class="text-[10px] font-semibold"
              style={{ color: palette().accent, fontVariant: ["tabular-nums"] }}
            >
              {`${pct()}%`}
            </Text>
          ) : null}
        </View>
      ) : props.selected ? (
        <Icon icon={mdiCheckCircle} size={14} color={token("primary")} />
      ) : (
        <View
          class="size-1.5 shrink-0 rounded-full"
          style={{
            backgroundColor: connected()
              ? palette().accent
              : dark()
                ? "rgba(255, 255, 255, 0.14)"
                : "rgba(15, 23, 42, 0.14)",
          }}
        />
      )}
    </View>
  );
}

export function Sidebar(props: {
  activeId: string;
  onSelect: (id: string) => void;
  deviceInfo?: Battery | null;
  loading?: boolean;
  error?: string | null;
}) {
  const dark = () => colorScheme() === "dark";
  const activeCategory = (): Category => (deviceById(props.activeId)?.category as Category) ?? "mouse";
  const category = signal<Category>(untracked(activeCategory));
  // 托盘 / 设置里换了设备时，侧栏跟着切到对应分类。
  // 只在分类**真的变了**时切：`pull()` 每秒把设置快照换成新对象，
  // 无条件 `set` 会把用户刚点的 Tab 顶回当前设备的分类。
  let followed = untracked(activeCategory);
  effect(() => {
    const next = activeCategory();
    if (next === followed) return;
    followed = next;
    category.set(next);
  });
  const visible = () => devicesIn(category());
  const selectedId = () =>
    selectedIn(settings(), category()) ?? (activeCategory() === category() ? props.activeId : null);
  const onlineCount = () => devices.filter((d) => sampleFor(d.id)?.connected).length;

  return (
    <View
      class="w-[292px] border-r border-sidebar-border bg-sidebar"
      style={{
        boxShadow: dark()
          ? "inset -1px 0 0 rgba(255, 255, 255, 0.03)"
          : "inset -1px 0 0 rgba(255, 255, 255, 0.7)",
      }}
    >
      {/* 品牌与 MorphBot 电子精灵视窗 */}
      <View class="flex-row items-center gap-3.5 px-4 pt-5 pb-4">
        <MorphBot
          size={48}
          containerSize={60}
          deviceId={props.activeId}
          info={props.deviceInfo ?? null}
          loading={Boolean(props.loading)}
          error={props.error ?? null}
        />
        <View class="min-w-0 flex-1">
          <Text class="text-[15px] font-semibold text-foreground" style={{ letterSpacing: -0.2 }}>
            外设电量
          </Text>
          <View class="mt-1 flex-row items-center gap-2">
            <Text class="text-[11px] font-medium text-muted-foreground">YugutouTool</Text>
            <View
              class="flex-row items-center gap-1 rounded-full px-1.5 py-0.5"
              style={{
                backgroundColor:
                  onlineCount() > 0
                    ? dark()
                      ? "rgba(16, 185, 129, 0.14)"
                      : "rgba(5, 150, 105, 0.10)"
                    : dark()
                      ? "rgba(255, 255, 255, 0.06)"
                      : "rgba(15, 23, 42, 0.05)",
              }}
            >
              <View
                class="size-1.5 rounded-full"
                style={{
                  backgroundColor:
                    onlineCount() > 0
                      ? dark()
                        ? "#34d399"
                        : "#059669"
                      : dark()
                        ? "rgba(148, 163, 184, 0.5)"
                        : "rgba(100, 116, 139, 0.5)",
                }}
              />
              <Text
                class="text-[10px] font-medium"
                style={{
                  color:
                    onlineCount() > 0
                      ? dark()
                        ? "#6ee7b7"
                        : "#047857"
                      : token("muted-foreground"),
                  fontVariant: ["tabular-nums"],
                }}
              >
                {onlineCount() > 0 ? `${onlineCount()} 在线` : "待机"}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* 三段式分类凹槽开关 */}
      <View class="px-3.5">
        <View
          class="flex-row gap-1 rounded-[14px] p-1"
          style={{
            borderCurve: "continuous",
            backgroundColor: dark() ? "rgba(0, 0, 0, 0.28)" : "rgba(15, 23, 42, 0.045)",
            borderWidth: 1,
            borderColor: dark() ? "rgba(255, 255, 255, 0.06)" : "rgba(15, 23, 42, 0.06)",
          }}
        >
          <Each of={CATEGORIES}>
            {(cat) => (
              <CategoryTab
                category={cat()}
                active={category() === cat()}
                onPress={() => category.set(cat())}
              />
            )}
          </Each>
        </View>
      </View>

      {/* 设备区块头 */}
      <View class="mt-5 flex-row items-center justify-between px-4 pb-2">
        <View class="flex-row items-center gap-2">
          <View class="h-2.5 w-0.5 rounded-full bg-primary/70" />
          <Text class="text-[10px] font-semibold tracking-[0.2em] text-muted-foreground">设备</Text>
        </View>
        <View
          class="rounded-full px-2 py-0.5"
          style={{
            backgroundColor: dark() ? "rgba(255, 255, 255, 0.06)" : "rgba(15, 23, 42, 0.05)",
          }}
        >
          <Text
            class="text-[10px] font-medium text-muted-foreground"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {String(visible().length)}
          </Text>
        </View>
      </View>

      {/* 设备列表 */}
      <Scroll class="flex-1" contentClass="gap-1.5 px-3 pb-3">
        {visible().length === 0 ? (
          <View
            class="items-center gap-2.5 rounded-2xl border border-dashed border-border/80 px-4 py-9"
            style={{
              borderCurve: "continuous",
              backgroundColor: dark() ? "rgba(255, 255, 255, 0.015)" : "rgba(15, 23, 42, 0.015)",
            }}
          >
            <View
              class="size-10 items-center justify-center rounded-full"
              style={{
                backgroundColor: dark() ? "rgba(255, 255, 255, 0.05)" : "rgba(15, 23, 42, 0.05)",
              }}
            >
              <Icon icon={CATEGORY_ICON[category()]} size={20} color={token("muted-foreground")} />
            </View>
            <Text class="text-xs font-medium text-muted-foreground">{`暂无${CATEGORY_LABEL[category()]}`}</Text>
          </View>
        ) : null}
        <Each of={visible()} key={(d) => d.id}>
          {(device) => (
            <DeviceItem
              device={device()}
              selected={selectedId() === device().id}
              onPress={() => props.onSelect(device().id)}
            />
          )}
        </Each>
      </Scroll>

      {/* 底部遥测状态卡 */}
      <View class="p-3">
        <View
          class="rounded-2xl px-3.5 py-3"
          style={{
            borderCurve: "continuous",
            backgroundColor: dark() ? "rgba(0, 0, 0, 0.24)" : "rgba(15, 23, 42, 0.035)",
            borderWidth: 1,
            borderColor: dark() ? "rgba(255, 255, 255, 0.06)" : "rgba(15, 23, 42, 0.06)",
          }}
        >
          <View class="flex-row items-center justify-between">
            <View class="flex-row items-center gap-2">
              <View
                class="size-2 rounded-full"
                style={{
                  backgroundColor: settings().autoRefresh
                    ? dark()
                      ? "#34d399"
                      : "#059669"
                    : dark()
                      ? "rgba(148, 163, 184, 0.4)"
                      : "rgba(100, 116, 139, 0.45)",
                  boxShadow: settings().autoRefresh
                    ? dark()
                      ? "0 0 8px rgba(52, 211, 153, 0.75)"
                      : "0 0 6px rgba(5, 150, 105, 0.35)"
                    : undefined,
                }}
              />
              <Text class="text-[11px] font-medium text-foreground/85">自动刷新</Text>
            </View>
            <View
              class="rounded-full px-2 py-0.5"
              style={{
                backgroundColor: settings().autoRefresh
                  ? dark()
                    ? "rgba(16, 185, 129, 0.14)"
                    : "rgba(5, 150, 105, 0.10)"
                  : dark()
                    ? "rgba(255, 255, 255, 0.06)"
                    : "rgba(15, 23, 42, 0.05)",
              }}
            >
              <Text
                class="text-[10px] font-semibold"
                style={{
                  color: settings().autoRefresh
                    ? dark()
                      ? "#6ee7b7"
                      : "#047857"
                    : token("muted-foreground"),
                  fontVariant: ["tabular-nums"],
                }}
              >
                {settings().autoRefresh ? `${settings().autoIntervalSec}s` : "已暂停"}
              </Text>
            </View>
          </View>
          <Text class="mt-2 text-[10px] text-muted-foreground/80">本地 HID 读取 · 不上传</Text>
        </View>
      </View>
    </View>
  );
}
