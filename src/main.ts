import { invoke } from "@tauri-apps/api/core";

type BatteryInfo = {
  percent: number | null;
  charging: boolean | null;
  connected: boolean;
  device: string;
  detail: string;
};

const el = {
  percent: null as HTMLElement | null,
  status: null as HTMLElement | null,
  fill: null as HTMLElement | null,
  detail: null as HTMLElement | null,
};

function paint(info: BatteryInfo) {
  if (!el.percent || !el.status || !el.fill || !el.detail) return;

  if (!info.connected) {
    el.percent.textContent = "--";
    el.status.textContent = "未找到 VT9 AIR";
    el.fill.style.width = "0%";
    el.fill.dataset.level = "empty";
    el.detail.textContent = info.detail;
    return;
  }

  if (info.percent == null) {
    el.percent.textContent = "?";
    el.status.textContent = "已连接 · 等待电量报告";
    el.fill.style.width = "100%";
    el.fill.dataset.level = "unknown";
    el.detail.textContent = `${info.device}\n${info.detail}`;
    return;
  }

  const p = Math.max(0, Math.min(100, Math.round(info.percent)));
  el.percent.textContent = `${p}%`;
  el.status.textContent = info.charging
    ? "充电中"
    : p <= 15
      ? "电量低"
      : "无线连接";
  el.fill.style.width = `${p}%`;
  el.fill.dataset.level = p <= 15 ? "low" : p <= 40 ? "mid" : "high";
  el.detail.textContent = `${info.device}\n${info.detail}`;
}

async function refresh() {
  try {
    const info = await invoke<BatteryInfo>("get_battery");
    paint(info);
  } catch (e) {
    paint({
      percent: null,
      charging: null,
      connected: false,
      device: "VT9 AIR",
      detail: String(e),
    });
  }
}

window.addEventListener("DOMContentLoaded", () => {
  el.percent = document.querySelector("#percent");
  el.status = document.querySelector("#status");
  el.fill = document.querySelector("#fill");
  el.detail = document.querySelector("#detail");
  document.querySelector("#refresh")?.addEventListener("click", () => {
    void refresh();
  });
  void refresh();
  window.setInterval(() => {
    void refresh();
  }, 3000);
});
