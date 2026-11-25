/** 设备侧栏：品牌区（MorphBot）、分类 Tabs、该类设备列表、底部自动刷新状态。对应老版 DeviceList。 */
import { effect, Scroll, signal, Text, token, untracked, View } from "nsh";
import type { Battery, Device } from "yugutou/native";
import { mdiCheckCircle, mdiHeadphones, mdiKeyboard, mdiMouse } from "./icons";
import { MorphBot } from "./morph-bot/MorphBot";
import { CATEGORIES, CATEGORY_LABEL, deviceById, devicesIn, selectedIn, settings, type Category } from "./store";
import { type IconData, Icon } from "./vendor/supernsh-icons";

const CATEGORY_ICON: Record<Category, IconData> = {
  mouse: mdiMouse,
  keyboard: mdiKeyboard,
  headset: mdiHeadphones,
};

function Tab(props: { category: Category; active: boolean; onPress: () => void }) {
  return (
    <View
      role="tab"
      accessibilityLabel={CATEGORY_LABEL[props.category]}
      onPress={props.onPress}
      class={
        props.active
          ? "cursor-pointer flex-1 flex-row items-center justify-center gap-1.5 rounded-lg border border-primary/25 bg-primary/15 px-1.5 py-1.5"
          : "cursor-pointer flex-1 flex-row items-center justify-center gap-1.5 rounded-lg border border-transparent px-1.5 py-1.5 hover:bg-background/40"
      }
    >
      <Icon
        icon={CATEGORY_ICON[props.category]}
        size={14}
        color={props.active ? token("primary") : token("muted-foreground")}
      />
      <Text class={props.active ? "text-[11px] font-medium text-primary" : "text-[11px] font-medium text-muted-foreground"}>
        {CATEGORY_LABEL[props.category]}
      </Text>
    </View>
  );
}

function DeviceItem(props: { device: Device; selected: boolean; onPress: () => void }) {
  return (
    <View
      role="button"
      accessibilityLabel={props.device.name}
      tooltip={props.device.description}
      onPress={props.onPress}
      class={
        props.selected
          ? "cursor-pointer relative flex-row items-center gap-3 rounded-2xl border border-primary/35 bg-primary/10 px-3 py-2.5"
          : "cursor-pointer relative flex-row items-center gap-3 rounded-2xl border border-transparent px-3 py-2.5 hover:border-border/60 hover:bg-accent/50"
      }
    >
      {props.selected ? <View class="absolute bottom-2 left-0 top-2 w-0.5 rounded-full bg-primary" /> : null}
      <View
        class={
          props.selected
            ? "size-9 items-center justify-center rounded-xl bg-primary/15"
            : "size-9 items-center justify-center rounded-xl bg-muted/60"
        }
      >
        <Icon
          icon={CATEGORY_ICON[props.device.category as Category] ?? mdiMouse}
          size={16}
          color={props.selected ? token("primary") : token("muted-foreground")}
        />
      </View>
      <View class="min-w-0 flex-1">
        <View class="flex-row items-center gap-1.5">
          <Text class="truncate shrink text-sm font-medium text-foreground">
            {props.device.name}
          </Text>
          {props.selected ? <Icon icon={mdiCheckCircle} size={14} color={token("primary")} /> : null}
        </View>
        <Text class="truncate mt-0.5 text-[11px] text-muted-foreground">
          {props.device.description}
        </Text>
      </View>
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

  return (
    <View class="w-[280px] border-r border-border/70 bg-card/30">
      <View class="flex-row items-center gap-3 px-5 pt-5 pb-4">
        <MorphBot
          size={52}
          containerSize={64}
          deviceId={props.activeId}
          info={props.deviceInfo ?? null}
          loading={Boolean(props.loading)}
          error={props.error ?? null}
        />
        <View class="min-w-0 flex-1">
          <Text class="text-sm font-semibold text-foreground">外设电量</Text>
          <Text class="mt-0.5 text-[11px] text-muted-foreground">YugutouTool</Text>
        </View>
      </View>

      <View class="px-3">
        <View class="flex-row gap-1 rounded-xl border border-border/60 bg-muted/40 p-1">
          <Each of={CATEGORIES}>
            {(cat) => <Tab category={cat()} active={category() === cat()} onPress={() => category.set(cat())} />}
          </Each>
        </View>
      </View>

      <View class="mt-5 flex-row items-center justify-between px-5 pb-2">
        <Text class="text-[10px] font-medium tracking-[0.18em] text-muted-foreground">设备</Text>
        <Text class="text-[10px] text-muted-foreground">{String(visible().length)}</Text>
      </View>

      <Scroll class="flex-1" contentClass="gap-1.5 px-3 pb-3">
        {visible().length === 0 ? (
          <View class="items-center gap-2 rounded-2xl border border-dashed border-border/60 px-4 py-8">
            <Icon icon={CATEGORY_ICON[category()]} size={24} color={token("muted-foreground")} />
            <Text class="text-xs text-muted-foreground">{`暂无${CATEGORY_LABEL[category()]}`}</Text>
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

      <View class="border-t border-border/60 px-5 py-3.5">
        <View class="flex-row items-center justify-between">
          <Text class="text-[11px] text-muted-foreground">自动刷新</Text>
          <View class="flex-row items-center gap-1.5">
            <View class={settings().autoRefresh ? "size-1.5 rounded-full bg-emerald-500" : "size-1.5 rounded-full bg-muted-foreground/40"} />
            <Text
              class={
                settings().autoRefresh
                  ? "text-[11px] font-medium text-emerald-600 dark:text-emerald-400"
                  : "text-[11px] font-medium text-muted-foreground"
              }
            >
              {settings().autoRefresh ? `${settings().autoIntervalSec}s` : "已暂停"}
            </Text>
          </View>
        </View>
        <Text class="mt-1.5 text-[10px] text-muted-foreground/70">本地 HID 读取 · 不上传</Text>
      </View>
    </View>
  );
}
