import { expect, open, test } from "nsh/test";

// 只看页面和导航，不点会改设置 / 注册表的按钮。
test("首页：侧栏 Tabs、设备列表和居中的电量卡片", async () => {
  const app = await open("./App.tsx", { width: 1200, height: 850 });
  // 首次读取（真 HID）结束后按钮才回到「立即刷新」。
  await app.waitFor("text:立即刷新", { timeout: 15000 });
  const texts = app.texts();
  expect(texts).toContain("鼠标");
  expect(texts).toContain("键盘");
  expect(texts).toContain("耳机");
  expect(texts).toContain("设备");
  expect(texts).toContain("当前设备");
  expect(texts).toContain("最后刷新");
  expect(texts).toContain("诊断详情");
  expect(texts).toContain("本地 HID 读取 · 不上传");
  expect(texts).not.toContain("yugutou_tool");
});

test("分类 Tabs 只列该类设备", async () => {
  const app = await open("./App.tsx", { width: 1200, height: 850 });
  await app.press("label:键盘");
  expect(app.texts()).toContain("VGN S99");
  expect(app.texts()).not.toContain("VT9 AIR");
  await app.press("label:耳机");
  expect(app.texts()).toContain("暂无耳机");
});

test("标题栏图标按钮切到设置页再回首页", async () => {
  const app = await open("./App.tsx", { width: 1200, height: 850 });
  await app.press("label:设置");
  expect(app.texts()).toContain("自动刷新间隔");
  expect(app.texts()).toContain("关闭窗口时");
  await app.press("label:首页");
  expect(app.texts()).toContain("当前设备");
});
