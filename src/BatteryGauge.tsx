/** 电量圆环：底轨始终画满一圈，填充弧按百分比；等待数据画虚线环。对应老版 BatteryGauge。 */
import { Canvas, colorScheme, Text, View, type CanvasRenderingContext2D, type CanvasSize } from "nsh";
import { mdiFlash } from "./icons";
import { type BatteryLevel, LEVEL_LABEL, LEVEL_STROKE } from "./status";
import { Icon } from "./vendor/supernsh-icons";

const SIZE = 208;
const STROKE = 12;
const RADIUS = (SIZE - STROKE) / 2 - 6;

export function BatteryGauge(props: { level: BatteryLevel; text: string; charging: boolean }) {
  const ratio = () => {
    const n = Number.parseInt(props.text, 10);
    return props.text.endsWith("%") && !Number.isNaN(n) ? n / 100 : 0;
  };

  function draw(cx: CanvasRenderingContext2D, size: CanvasSize) {
    const dark = colorScheme() === "dark";
    const level = props.level;
    const c = Math.min(size.width, size.height) / 2;
    const r = (RADIUS * c * 2) / SIZE;
    const start = -Math.PI / 2;
    const fill = level === "high" || level === "mid" || level === "low" || level === "charging" ? LEVEL_STROKE[level] : null;

    // 光晕（老版 LEVEL_GLOW：*-500/10 + blur）。
    const glowRgb = fill?.rgb ?? (level === "unknown" ? (dark ? "60, 143, 244" : "29, 78, 216") : null);
    if (glowRgb) {
      const g = cx.createRadialGradient(c, c, 0, c, c, r);
      g.addColorStop(0, `rgba(${glowRgb}, ${fill ? 0.16 : 0.06})`);
      g.addColorStop(1, `rgba(${glowRgb}, 0)`);
      cx.fillStyle = g;
      cx.beginPath();
      cx.arc(c, c, r, 0, Math.PI * 2);
      cx.fill();
    }

    // 底轨：无论有没有电量都画完整一圈。
    const faint = level === "unknown" || level === "empty";
    cx.setLineDash([]);
    cx.lineWidth = STROKE;
    cx.strokeStyle = dark
      ? `rgba(255, 255, 255, ${faint ? 0.1 : 0.06})`
      : `rgba(229, 229, 229, ${faint ? 1 : 0.6})`;
    cx.beginPath();
    cx.arc(c, c, r, 0, Math.PI * 2);
    cx.stroke();

    if (level === "unknown") {
      // 虚线周期整除周长，12 点接缝不缺一截。
      const circumference = 2 * Math.PI * r;
      const count = Math.max(1, Math.round(circumference / 13));
      const fitted = circumference / count;
      cx.setLineDash([(fitted * 3) / 13, (fitted * 10) / 13]);
      cx.lineCap = "butt";
      cx.strokeStyle = dark ? "rgba(169, 178, 190, 0.35)" : "rgba(115, 115, 115, 0.35)";
      cx.beginPath();
      cx.arc(c, c, r, start, start + Math.PI * 2);
      cx.stroke();
      cx.setLineDash([]);
      return;
    }

    if (fill && ratio() > 0) {
      cx.lineCap = "round";
      cx.strokeStyle = dark ? fill.dark : fill.light;
      cx.beginPath();
      cx.arc(c, c, r, start, start + Math.PI * 2 * ratio());
      cx.stroke();
    }
  }

  return (
    <View class="relative items-center justify-center" style={{ width: SIZE, height: SIZE }}>
      <Canvas class="absolute inset-0" draw={draw} />
      <View class="absolute inset-0 items-center justify-center">
        <Text class="text-[56px] font-semibold leading-none text-foreground">{props.text}</Text>
        <Text class="mt-2 text-[10px] font-medium tracking-[0.18em] text-muted-foreground">
          {props.charging ? "充电中" : LEVEL_LABEL[props.level]}
        </Text>
      </View>
      {props.charging ? (
        <View class="absolute right-2 top-2 size-8 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/10">
          <Icon icon={mdiFlash} size={16} color={colorScheme() === "dark" ? "#fbbf24" : "#d97706"} />
        </View>
      ) : null}
    </View>
  );
}
