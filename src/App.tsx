import { useCallback, useEffect, useMemo, useState } from "react";
import { BatteryCard } from "./components/BatteryCard";
import { DeviceList } from "./components/DeviceList";
import {
  deviceRegistry,
  getDeviceById,
  type BatteryInfo,
} from "./devices";
import "./App.css";

const POLL_MS = 3000;

export default function App() {
  const [selectedId, setSelectedId] = useState(
    () => deviceRegistry[0]?.id ?? "",
  );
  const [info, setInfo] = useState<BatteryInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => getDeviceById(selectedId) ?? deviceRegistry[0],
    [selectedId],
  );

  const refresh = useCallback(async () => {
    if (!selected) return;
    setLoading(true);
    setError(null);
    try {
      const next = await selected.readBattery();
      setInfo(next);
    } catch (e) {
      setInfo(null);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => {
    setInfo(null);
    setError(null);
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  if (!selected) {
    return (
      <div className="app-shell">
        <p className="empty-state">尚未注册任何设备</p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <DeviceList
        devices={deviceRegistry}
        selectedId={selected.id}
        onSelect={setSelectedId}
      />
      <BatteryCard
        deviceName={selected.name}
        info={info}
        loading={loading}
        error={error}
        onRefresh={() => {
          void refresh();
        }}
      />
    </div>
  );
}
