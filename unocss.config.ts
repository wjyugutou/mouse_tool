// 此文件实际不生效，具体生效文件在apps/*/unocss.config.ts
// 此文件仅作为eslint校验使用
import {
  defineConfig,
  presetIcons,
  presetWind4,
  transformerDirectives, // --at-apply: 代替@apply 避免警告信息
  transformerVariantGroup,
} from 'unocss'

export default defineConfig({
  variants: [
    (matcher) => {
      if (!matcher.startsWith('group-hover:'))
        return matcher
      return {
        matcher: matcher.slice(12),
        selector: s => `.group:hover ${s}`,
      }
    },
  ],
  shortcuts: [
    ['flex-center', 'flex justify-center items-center'],
    ['btn', 'px-4 py-1 rounded inline-block bg-teal-600 text-white cursor-pointer hover:bg-teal-700 disabled:cursor-default disabled:bg-gray-600 disabled:opacity-50'],
  ],
  presets: [
    presetWind4({
      preflights: {
        reset: true,
      },
    }),
    presetIcons({
      scale: 1.2,
      warn: true,
    }),
  ],
  transformers: [
    transformerDirectives(),
    transformerVariantGroup(),
  ],
})
