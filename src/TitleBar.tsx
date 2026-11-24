/** 无边框窗口标题栏：首页 / 设置 / GitHub 图标按钮 + 拖拽区；最小化、最大化、关闭由 NSH 画在右侧。 */
import { openUrl, token, View } from "nsh";
import { titleBar } from "nsh/desktop";
import { mdiCogOutline, mdiGithub, mdiHomeOutline } from "./icons";
import { page } from "./store";
import { type IconData, Icon } from "./vendor/supernsh-icons";

const GITHUB_URL = "https://github.com/wjyugutou/mouse_tool";

function IconButton(props: { icon: IconData; label: string; active?: boolean; onPress: () => void }) {
  return (
    <View
      role="button"
      accessibilityLabel={props.label}
      tooltip={props.label}
      onPress={props.onPress}
      class={
        props.active
          ? "cursor-pointer size-7 items-center justify-center rounded-md bg-accent"
          : "cursor-pointer size-7 items-center justify-center rounded-md hover:bg-accent active:opacity-80"
      }
    >
      <Icon icon={props.icon} size={16} color={props.active ? token("primary") : token("muted-foreground")} />
    </View>
  );
}

export function TitleBar() {
  return (
    <View
      class="flex-row items-center border-b border-border bg-card/80"
      style={{ height: titleBar().height || 36, paddingRight: titleBar().right }}
      desktop={{ windowDrag: true }}
    >
      <View class="flex-row items-center gap-0.5 px-2">
        <IconButton icon={mdiGithub} label="GitHub" onPress={() => void openUrl(GITHUB_URL)} />
        <IconButton icon={mdiHomeOutline} label="首页" active={page() === "home"} onPress={() => page.set("home")} />
        <IconButton icon={mdiCogOutline} label="设置" active={page() === "settings"} onPress={() => page.set("settings")} />
      </View>
      <View class="flex-1" />
    </View>
  );
}
