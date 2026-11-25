/** 精密电量仪表环：60 格外圈表盘刻度、内校准环、渐变能量弧、末端光珠与中央等宽数字读数。 */
import { Canvas, colorScheme, Text, View, type CanvasRenderingContext2D, type CanvasSize } from "nsh";
import { mdiFlash } from "./icons";
import { type BatteryLevel, LEVEL_LABEL, LEVEL_STROKE, levelPalette } from "./status";
import { Icon } from "./vendor/supernsh-icons";

const SIZE = 232;
const STROKE = 11;
const TICK_COUNT = 60;

export function BatteryGauge(props: { level: BatteryLevel; text: string; charging: boolean }) {
  const dark = () => colorScheme() === "dark";
  const palette = () => levelPalette(props.level, dark());
  const hasPercent = () => props.text.endsWith("%");
  const numericText = () => (hasPercent() ? props.text.slice(0, -1) : props.text);
  const ratio = () => {
    const n = Number.parseInt(props.text, 10);
    return hasPercent() && !Number.isNaN(n) ? Math.max(0, Math.min(1, n / 100)) : 0;
  };

  function draw(cx: CanvasRenderingContext2D, size: CanvasSize) {
    const isDark = colorScheme() === "dark";
    const level = props.level;
    const pct = ratio();
    const c = Math.min(size.width, size.height) / 2;
    const scale = (c * 2) / SIZE;
    const start = -Math.PI / 2;

    const tickOuter = c - 4 * scale;
    const ringRadius = c - 24 * scale;
    const innerRingRadius = ringRadius - 15 * scale;
    const strokeW = STROKE * scale;

    const fill =
      level === "high" || level === "mid" || level === "low" || level === "charging"
        ? LEVEL_STROKE[level]
        : null;
    const pal = levelPalette(level, isDark);

    // 1. 底层环境辉光
    const glow = cx.createRadialGradient(c, c, innerRingRadius * 0.25, c, c, tickOuter);
    glow.addColorStop(0, `rgba(${pal.rgb}, ${fill ? (isDark ? 0.16 : 0.09) : isDark ? 0.06 : 0.04})`);
    glow.addColorStop(0.68, `rgba(${pal.rgb}, ${fill ? (isDark ? 0.06 : 0.03) : 0.015})`);
    glow.addColorStop(1, `rgba(${pal.rgb}, 0)`);
    cx.fillStyle = glow;
    cx.beginPath();
    cx.arc(c, c, tickOuter, 0, Math.PI * 2);
    cx.fill();

    // 2. 外圈 60 格精密刻度环
    cx.setLineDash([]);
    cx.lineCap = "round";
    for (let i = 0; i < TICK_COUNT; i += 1) {
      const frac = i / TICK_COUNT;
      const angle = start + frac * Math.PI * 2;
      const major = i % 5 === 0;
      const lit = Boolean(fill && pct > 0 && frac <= pct + 0.001);
      const len = (major ? 7.5 : 4) * scale;
      const r0 = tickOuter - len;
      const r1 = tickOuter;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      cx.lineWidth = (major ? 1.8 : 1.1) * scale;
      if (lit) {
        cx.strokeStyle = `rgba(${pal.rgb}, ${major ? (isDark ? 0.92 : 0.85) : isDark ? 0.48 : 0.42})`;
      } else {
        cx.strokeStyle = isDark
          ? `rgba(255, 255, 255, ${major ? 0.16 : 0.075})`
          : `rgba(15, 23, 42, ${major ? 0.16 : 0.075})`;
      }
      cx.beginPath();
      cx.moveTo(c + cos * r0, c + sin * r0);
      cx.lineTo(c + cos * r1, c + sin * r1);
      cx.stroke();
    }

    // 3. 内侧极细精密校准圆环
    cx.lineWidth = 1 * scale;
    cx.strokeStyle = isDark ? "rgba(255, 255, 255, 0.055)" : "rgba(15, 23, 42, 0.06)";
    cx.beginPath();
    cx.arc(c, c, innerRingRadius, 0, Math.PI * 2);
    cx.stroke();

    // 4. 主能量轨道底槽
    const faint = level === "unknown" || level === "empty";
    cx.lineWidth = strokeW;
    cx.lineCap = "butt";
    cx.strokeStyle = isDark
      ? `rgba(255, 255, 255, ${faint ? 0.085 : 0.065})`
      : `rgba(15, 23, 42, ${faint ? 0.095 : 0.075})`;
    cx.beginPath();
    cx.arc(c, c, ringRadius, 0, Math.PI * 2);
    cx.stroke();

    // 5. 等待数据或充电中无百分比：均匀精密仪表虚线环
    if (level === "unknown" || (level === "charging" && pct === 0)) {
      const circumference = 2 * Math.PI * ringRadius;
      const dashCount = 36;
      const fitted = circumference / dashCount;
      cx.setLineDash([fitted * 0.34, fitted * 0.66]);
      cx.lineCap = "round";
      cx.lineWidth = (level === "charging" ? 4.5 : 3.5) * scale;
      cx.strokeStyle =
        level === "charging"
          ? `rgba(${pal.rgb}, ${isDark ? 0.72 : 0.65})`
          : isDark
            ? "rgba(148, 163, 184, 0.38)"
            : "rgba(100, 116, 139, 0.36)";
      cx.beginPath();
      cx.arc(c, c, ringRadius, start, start + Math.PI * 2);
      cx.stroke();
      cx.setLineDash([]);
      return;
    }

    // 6. 有效电量：柔光底弧 + 渐变能量主弧 + 末端高光能量珠
    if (fill && pct > 0) {
      const endAngle = start + Math.PI * 2 * pct;
      const cStart = isDark ? fill.dark : fill.light;
      const cEnd = isDark ? fill.darkEnd : fill.lightEnd;

      const grad = cx.createConicGradient(start, c, c);
      grad.addColorStop(0, cStart);
      grad.addColorStop(Math.max(0.08, pct * 0.92), cEnd);
      grad.addColorStop(1, cEnd);

      // 光学弥散发光层
      cx.lineCap = "round";
      cx.lineWidth = strokeW + 7 * scale;
      cx.strokeStyle = `rgba(${fill.rgb}, ${isDark ? 0.22 : 0.14})`;
      cx.beginPath();
      cx.arc(c, c, ringRadius, start, endAngle);
      cx.stroke();

      // 锐利渐变主弧
      cx.lineWidth = strokeW;
      cx.strokeStyle = grad;
      cx.beginPath();
      cx.arc(c, c, ringRadius, start, endAngle);
      cx.stroke();

      // 弧线末端高亮能量珠
      const tipX = c + Math.cos(endAngle) * ringRadius;
      const tipY = c + Math.sin(endAngle) * ringRadius;
      const tipGlow = cx.createRadialGradient(tipX, tipY, 0, tipX, tipY, 9 * scale);
      tipGlow.addColorStop(0, `rgba(${fill.rgb}, ${isDark ? 0.75 : 0.45})`);
      tipGlow.addColorStop(1, `rgba(${fill.rgb}, 0)`);
      cx.fillStyle = tipGlow;
      cx.beginPath();
      cx.arc(tipX, tipY, 9 * scale, 0, Math.PI * 2);
      cx.fill();

      cx.fillStyle = isDark ? "#ffffff" : "#f8fafc";
      cx.beginPath();
      cx.arc(tipX, tipY, 2.8 * scale, 0, Math.PI * 2);
      cx.fill();
    }
  }

  return (
    <View class="relative shrink-0 items-center justify-center" style={{ width: SIZE, height: SIZE }}>
      <Canvas class="absolute inset-0" draw={draw} />

      {/* 中央读数与语义铭牌 */}
      <View class="absolute inset-0 items-center justify-center">
        <View class="flex-row items-baseline justify-center">
          <Text
            class={
              hasPercent()
                ? "text-[52px] font-bold leading-none text-foreground"
                : "text-[46px] font-semibold leading-none text-muted-foreground"
            }
            style={{
              letterSpacing: hasPercent() ? -2.2 : 1,
              fontVariant: ["tabular-nums"],
            }}
          >
            {numericText()}
          </Text>
          {hasPercent() ? (
            <Text
              class="ml-0.5 text-[18px] font-semibold leading-none text-muted-foreground"
              style={{ fontVariant: ["tabular-nums"] }}
            >
              %
            </Text>
          ) : null}
        </View>

        <View
          class="mt-3 flex-row items-center gap-1 rounded-full px-2.5 py-0.5"
          style={{
            backgroundColor: palette().softBg,
            borderWidth: 1,
            borderColor: palette().softBorder,
          }}
        >
          {props.charging ? (
            <Icon icon={mdiFlash} size={11} color={palette().accent} />
          ) : (
            <View class="size-1.5 rounded-full" style={{ backgroundColor: palette().accent }} />
          )}
          <Text
            class="text-[10px] font-semibold tracking-[0.14em]"
            style={{ color: palette().accent }}
          >
            {props.charging ? "充电中" : LEVEL_LABEL[props.level]}
          </Text>
        </View>
      </View>
    </View>
  );
}
