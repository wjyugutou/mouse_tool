/** 首页：左侧设备侧栏，右侧居中的电量 hero 卡。电量来自 Rust 同一次采样，不自己再读 HID。 */
import { Scroll, signal, View } from "nsh";
import { Mouse } from "yugutou/native";
import { BatteryCard } from "./BatteryCard";
import { Sidebar } from "./Sidebar";
import { deviceById, devices, pull, sampleFor, settings } from "./store";

export function Home() {
  const loading = signal(false);
  const error = signal<string | null>(null);
  const activeId = () => settings().trayDeviceId;
  const device = () => deviceById(activeId()) ?? devices[0];
  const info = () => sampleFor(device()?.id ?? "");

  async function read(fresh: boolean) {
    const id = device()?.id;
    if (!id) return;
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
      <Sidebar
        activeId={activeId()}
        onSelect={select}
        deviceInfo={info()}
        loading={loading()}
        error={error()}
      />
      <Scroll class="flex-1" contentClass="grow items-center justify-center px-10 py-8">
        <BatteryCard
          deviceName={device()?.name ?? "尚未注册任何设备"}
          info={info()}
          loading={loading()}
          auto={settings().autoRefresh}
          autoIntervalSec={settings().autoIntervalSec}
          error={error()}
          onRefresh={() => void read(true)}
          onToggleAuto={() => {
            Mouse.updateSettings({ autoRefresh: !settings().autoRefresh });
            pull();
          }}
        />
      </Scroll>
    </View>
  );
}
