/** 小部件：可点的胶囊按钮。 */
import { Text, View } from "nsh";

export function Chip(props: { label: string; selected?: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <View
      role="button"
      onPress={() => {
        if (!props.disabled) props.onPress();
      }}
      class={
        props.selected
          ? "rounded-full border border-primary bg-primary px-3 py-1.5 active:opacity-70"
          : "rounded-full border border-border bg-card px-3 py-1.5 active:opacity-70"
      }
      style={{ opacity: props.disabled ? 0.5 : 1 }}
    >
      <Text class={props.selected ? "text-xs text-primary-foreground" : "text-xs text-foreground"}>{props.label}</Text>
    </View>
  );
}
