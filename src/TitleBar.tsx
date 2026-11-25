/** 无边框窗口标题栏：精密分段导航胶囊 + GitHub 外链 + 拖拽区；系统控制按钮由 NSH 画在右侧。 */
import { colorScheme, openUrl, Text, token, View } from "nsh";
import { titleBar } from "nsh/desktop";
import { mdiCogOutline, mdiGithub, mdiHomeOutline } from "./icons";
import { page } from "./store";
import { update } from "./updater";
import { type IconData, Icon } from "./vendor/supernsh-icons";

const GITHUB_URL = "https://github.com/wjyugutou/mouse_tool";

function NavPill(props: {
  icon: IconData;
  label: string;
  active: boolean;
  badge?: boolean;
  onPress: () => void;
}) {
  const dark = () => colorScheme() === "dark";

  return (
    <View
      role="button"
      accessibilityLabel={props.label}
      tooltip={props.label}
      onPress={props.onPress}
      class={
        props.active
          ? "cursor-pointer relative flex-row items-center gap-1.5 rounded-lg bg-card px-2.5 py-1"
          : "cursor-pointer relative flex-row items-center gap-1.5 rounded-lg px-2.5 py-1"
      }
      style={{
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: props.active
          ? dark()
            ? "rgba(255, 255, 255, 0.10)"
            : "rgba(15, 23, 42, 0.08)"
          : "transparent",
        boxShadow: props.active
          ? dark()
            ? "0 1px 3px rgba(0, 0, 0, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.08)"
            : "0 1px 3px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.9)"
          : undefined,
      }}
      hoverStyle={
        props.active
          ? undefined
          : {
              backgroundColor: dark() ? "rgba(255, 255, 255, 0.06)" : "rgba(15, 23, 42, 0.05)",
            }
      }
      activeStyle={{ opacity: 0.78 }}
    >
      <Icon
        icon={props.icon}
        size={14}
        color={props.active ? token("primary") : token("muted-foreground")}
      />
      <Text
        class={
          props.active
            ? "text-[11px] font-semibold text-foreground"
            : "text-[11px] font-medium text-muted-foreground"
        }
      >
        {props.label}
      </Text>
      {props.badge ? (
        <View
          class="size-1.5 rounded-full bg-primary"
          style={{
            boxShadow: dark() ? "0 0 6px rgba(56, 189, 248, 0.85)" : "0 0 4px rgba(37, 99, 235, 0.5)",
          }}
        />
      ) : null}
    </View>
  );
}

export function TitleBar() {
  const dark = () => colorScheme() === "dark";

  return (
    <View
      class="flex-row items-center border-b border-border/80 bg-sidebar/90"
      style={{
        height: titleBar().height || 38,
        paddingRight: titleBar().right,
        boxShadow: dark()
          ? "inset 0 -1px 0 rgba(255, 255, 255, 0.03)"
          : "inset 0 -1px 0 rgba(255, 255, 255, 0.75)",
      }}
      desktop={{ windowDrag: true }}
    >
      <View class="flex-row items-center gap-2 px-2.5">
        {/* 分段导航轨道 */}
        <View
          class="flex-row items-center gap-0.5 rounded-[10px] p-0.5"
          style={{
            borderCurve: "continuous",
            backgroundColor: dark() ? "rgba(0, 0, 0, 0.28)" : "rgba(15, 23, 42, 0.045)",
            borderWidth: 1,
            borderColor: dark() ? "rgba(255, 255, 255, 0.06)" : "rgba(15, 23, 42, 0.06)",
          }}
        >
          <NavPill
            icon={mdiHomeOutline}
            label="首页"
            active={page() === "home"}
            onPress={() => page.set("home")}
          />
          <NavPill
            icon={mdiCogOutline}
            label="设置"
            active={page() === "settings"}
            badge={Boolean(update())}
            onPress={() => page.set("settings")}
          />
        </View>

        <View
          style={{
            width: 1,
            height: 14,
            backgroundColor: dark() ? "rgba(255, 255, 255, 0.1)" : "rgba(15, 23, 42, 0.1)",
          }}
        />

        <View
          role="button"
          accessibilityLabel="GitHub"
          tooltip="GitHub 仓库"
          onPress={() => void openUrl(GITHUB_URL)}
          class="cursor-pointer size-7 items-center justify-center rounded-lg"
          style={{ borderCurve: "continuous" }}
          hoverStyle={{
            backgroundColor: dark() ? "rgba(255, 255, 255, 0.08)" : "rgba(15, 23, 42, 0.06)",
          }}
          activeStyle={{ opacity: 0.75 }}
        >
          <Icon icon={mdiGithub} size={15} color={token("muted-foreground")} />
        </View>
      </View>

      <View class="flex-1" />
    </View>
  );
}
