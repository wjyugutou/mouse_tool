import type { BatteryInfo } from "../devices";

type Props = {
  deviceName: string;
  info: BatteryInfo | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
};

function levelFromInfo(info: BatteryInfo | null): string {
  if (!info || !info.connected) return "empty";
  if (info.percent == null) return "unknown";
  const p = info.percent;
  if (p <= 15) return "low";
  if (p <= 40) return "mid";
  return "high";
}

function widthFromInfo(info: BatteryInfo | null): string {
  if (!info || !info.connected) return "0%";
  if (info.percent == null) return "100%";
  const p = Math.max(0, Math.min(100, Math.round(info.percent)));
  return `${p}%`;
}

function percentText(info: BatteryInfo | null): string {
  if (!info || !info.connected) return "--";
  if (info.percent == null) return "?";
  return `${Math.max(0, Math.min(100, Math.round(info.percent)))}%`;
}

function statusText(info: BatteryInfo | null, loading: boolean, error: string | null): string {
  if (error) return "读取失败";
  if (loading && !info) return "读取中…";
  if (!info || !info.connected) return `未找到 ${info?.device ?? "设备"}`;
  if (info.percent == null) return "已连接 · 等待电量报告";
  if (info.charging) return "充电中";
  if (info.percent <= 15) return "电量低";
  return "无线连接";
}

export function BatteryCard({ deviceName, info, loading, error, onRefresh }: Props) {
  const level = levelFromInfo(info);
  const width = widthFromInfo(info);
  const detail =
    error ??
    (info
      ? info.connected
        ? `${info.device}\n${info.detail}`
        : info.detail
      : "");

  return (
    <main className="card">
      <p className="label">{deviceName}</p>
      <div className="battery">
        <div className="shell">
          <div className="fill" data-level={level} style={{ width }} />
        </div>
        <div className="cap" />
      </div>
      <p className="percent">{percentText(info)}</p>
      <p className="status">{statusText(info, loading, error)}</p>
      <p className="detail">{detail}</p>
      <button type="button" onClick={onRefresh} disabled={loading}>
        {loading ? "刷新中…" : "刷新"}
      </button>
    </main>
  );
}
