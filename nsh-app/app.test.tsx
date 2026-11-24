import { expect, open, test } from "nsh/test";

// 只看页面和导航，不点会改设置 / 注册表的按钮。
test("首页列出设备并显示电量卡片", async () => {
  const app = await open("./App.tsx", { width: 1200, height: 850 });
  // 首次读取（真 HID）结束后按钮才回到「立即刷新」。
  await app.waitFor("text:立即刷新", { timeout: 15000 });
  const texts = app.texts();
  expect(texts).toContain("yugutou_tool");
  expect(texts).toContain("鼠标");
  expect(texts).toContain("连接");
  expect(texts).toContain("采样间隔");
});

test("标题栏切到设置页再回首页", async () => {
  const app = await open("./App.tsx", { width: 1200, height: 850 });
  await app.press("text:设置");
  expect(app.texts()).toContain("自动刷新间隔");
  expect(app.texts()).toContain("关闭窗口时");
  await app.press("text:首页");
  expect(app.texts()).toContain("采样间隔");
});
