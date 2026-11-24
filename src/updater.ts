/**
 * 应用更新：`nsh/updater` 读 nsh.json 的 `"updater"`（GitHub Release 的 latest.json，`publicKey` 验签），
 * 下载、按清单校验 SHA-256 与大小，替换安装目录后重启。
 * 启动 15 秒后自动查一次，之后每 6 小时一次；自动检查只在发现新版本时提示，失败不打扰。
 */
import { openUrl, signal } from "nsh";
import { checkForUpdate, downloadUpdate, installAndRestart, shellInfo, type AppUpdate } from "nsh/updater";

export type UpdatePhase = "idle" | "checking" | "latest" | "available" | "downloading" | "installing" | "error";

export const update = signal<AppUpdate | null>(null);
export const phase = signal<UpdatePhase>("idle");
export const message = signal("");
/** 下载进度 0–1；总大小未知时为 null。 */
export const progress = signal<number | null>(null);

const AUTO_DELAY_MS = 15_000;
const AUTO_EVERY_MS = 6 * 60 * 60 * 1000;

let busy = false;

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 只有打包安装的应用能更新；`nsh run` / `nsh test` 下 `shellInfo().version` 为 null。 */
export function canUpdateHere(): boolean {
  return shellInfo().version != null;
}

export function isBusy(): boolean {
  const p = phase();
  return p === "checking" || p === "downloading" || p === "installing";
}

/** 查一次。`manual` 为 true 时把「已是最新」和错误也显示出来。 */
export async function check(manual: boolean): Promise<void> {
  if (busy) return;
  if (!canUpdateHere()) {
    if (manual) {
      phase.set("latest");
      message.set("开发运行不检查更新，打包安装后才可用");
    }
    return;
  }
  busy = true;
  if (manual) {
    phase.set("checking");
    message.set("正在检查…");
  }
  try {
    const found = await checkForUpdate({ locale: "zh-CN" });
    update.set(found);
    if (found) {
      phase.set("available");
      message.set(`发现新版本 ${found.version}`);
    } else if (manual) {
      phase.set("latest");
      message.set("已是最新版本");
    }
  } catch (e) {
    if (manual) {
      phase.set("error");
      message.set(`检查失败：${errorText(e)}`);
    } else {
      console.warn(`auto update check failed: ${errorText(e)}`);
    }
  } finally {
    busy = false;
  }
}

/** 下载并安装上次检查找到的版本，成功后应用自己重启（promise 只在失败时返回）。 */
export async function install(): Promise<void> {
  const found = update();
  if (!found || busy) return;
  if (!found.canInstall) {
    message.set("当前安装目录不可写，已打开下载页手动安装");
    await openUrl(found.url);
    return;
  }
  busy = true;
  phase.set("downloading");
  progress.set(0);
  message.set(`正在下载 ${found.version}…`);
  try {
    await downloadUpdate(({ received, total }) => progress.set(total ? received / total : null));
    phase.set("installing");
    message.set("下载完成，正在安装并重启…");
    await installAndRestart();
  } catch (e) {
    phase.set("error");
    message.set(`更新失败：${errorText(e)}`);
  } finally {
    busy = false;
  }
}

export function startAutoCheck(): void {
  if (!canUpdateHere()) return;
  setTimeout(() => void check(false), AUTO_DELAY_MS);
  setInterval(() => void check(false), AUTO_EVERY_MS);
}
