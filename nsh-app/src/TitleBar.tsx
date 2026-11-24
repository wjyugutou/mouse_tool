/** 无边框窗口的标题栏：拖拽区、首页 / 设置 / GitHub。最小化、最大化、关闭按钮由 NSH 画在右侧。 */
import { openUrl, Text, View } from "nsh";
import { titleBar } from "nsh/desktop";
import { Chip } from "./Chip";
import { page } from "./store";

const GITHUB_URL = "https://github.com/wjyugutou/mouse_tool";

export function TitleBar() {
  return (
    <View
      class="flex-row items-center gap-2 border-b border-border bg-card px-3"
      style={{ height: titleBar().height || 40, paddingRight: titleBar().right + 8 }}
      desktop={{ windowDrag: true }}
    >
      <Text class="text-sm font-semibold text-foreground">yugutou_tool</Text>
      <Chip label="首页" selected={page() === "home"} onPress={() => page.set("home")} />
      <Chip label="设置" selected={page() === "settings"} onPress={() => page.set("settings")} />
      <Chip label="GitHub" onPress={() => void openUrl(GITHUB_URL)} />
      <View class="flex-1" />
    </View>
  );
}
