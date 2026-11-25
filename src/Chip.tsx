/** 精密胶囊按钮：支持选中态微投影高光、禁用态、可选图标与等宽数字排版。 */
import { colorScheme, Text, token, View } from "nsh";
import { type IconData, Icon } from "./vendor/supernsh-icons";

export function Chip(props: {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  icon?: IconData;
  tabular?: boolean;
  onPress: () => void;
}) {
  const dark = () => colorScheme() === "dark";

  return (
    <View
      role="button"
      onPress={() => {
        if (!props.disabled) props.onPress();
      }}
      class={
        props.selected
          ? "cursor-pointer flex-row items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2"
          : "cursor-pointer flex-row items-center gap-1.5 rounded-xl px-3.5 py-2"
      }
      style={{
        borderCurve: "continuous",
        opacity: props.disabled ? 0.48 : 1,
        borderWidth: 1,
        borderColor: props.selected
          ? "transparent"
          : dark()
            ? "rgba(255, 255, 255, 0.10)"
            : "rgba(15, 23, 42, 0.09)",
        backgroundColor: props.selected
          ? undefined
          : dark()
            ? "rgba(255, 255, 255, 0.04)"
            : "rgba(15, 23, 42, 0.035)",
        boxShadow: props.selected
          ? dark()
            ? "0 6px 16px -6px rgba(56, 189, 248, 0.50), inset 0 1px 0 rgba(255, 255, 255, 0.22)"
            : "0 6px 14px -6px rgba(37, 99, 235, 0.40), inset 0 1px 0 rgba(255, 255, 255, 0.22)"
          : undefined,
      }}
      hoverStyle={
        props.disabled
          ? undefined
          : props.selected
            ? { opacity: 0.92 }
            : {
                backgroundColor: dark()
                  ? "rgba(255, 255, 255, 0.08)"
                  : "rgba(15, 23, 42, 0.065)",
              }
      }
      activeStyle={props.disabled ? undefined : { opacity: 0.78, scale: 0.98 }}
    >
      {props.icon ? (
        <Icon
          icon={props.icon}
          size={14}
          color={props.selected ? token("primary-foreground") : token("muted-foreground")}
        />
      ) : null}
      <Text
        class={
          props.selected
            ? "text-xs font-semibold text-primary-foreground"
            : "text-xs font-medium text-foreground"
        }
        style={props.tabular ? { fontVariant: ["tabular-nums"] } : undefined}
      >
        {props.label}
      </Text>
    </View>
  );
}
