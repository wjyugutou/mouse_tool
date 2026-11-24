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
  // 侧栏条目带 accessibilityLabel（设备名）；电量卡里的「当前设备」是正文文本，不在此列，
  // 所以用 count 数侧栏条目，而不是 texts() 看整屏——后者会把当前设备也算进来。
  await app.press("label:键盘");
  expect(app.count("label:VGN S99")).toBe(1);
  expect(app.count("label:VT9 AIR")).toBe(0);
  await app.press("label:耳机");
  expect(app.texts()).toContain("暂无耳机");
  expect(app.count("label:VGN S99")).toBe(0);
  // 首次 HID 读取完成后 pull() 会换掉设置快照；等过这一刻，用户选的 Tab 不能被顶回去。
  await app.wait(1200);
  expect(app.texts()).toContain("暂无耳机");
  expect(app.count("label:VT9 AIR")).toBe(0);
});

test("标题栏图标按钮切到设置页再回首页", async () => {
  const app = await open("./App.tsx", { width: 1200, height: 850 });
  await app.press("label:设置");
  expect(app.texts()).toContain("自动刷新间隔");
  expect(app.texts()).toContain("关闭窗口时");
  await app.press("label:首页");
  expect(app.texts()).toContain("当前设备");
});

test("设置页：检查更新（开发运行不连网，只给提示）", async () => {
  const app = await open("./App.tsx", { width: 1200, height: 850 });
  await app.press("label:设置");
  expect(app.texts()).toContain("应用更新");
  await app.press("text:检查更新");
  expect(app.texts()).toContain("开发运行不检查更新，打包安装后才可用");
});
