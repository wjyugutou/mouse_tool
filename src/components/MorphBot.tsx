/** 首页顶部装饰：随机表情，停留结束后有一半几率换形状并换纯色。 */
import type { MorphBotElement, MorphBotState } from '@/vendor/morph-bot/morph-bot.js'
import { useLayoutEffect, useRef } from 'react'
import {
  MORPH_BOT_SHAPES,
  MORPH_BOT_STATES,
} from '@/vendor/morph-bot/morph-bot.js'

/** 深色底上仍能看清白眼睛的实心身体色。 */
const BODY_COLORS = [
  '#705cff',
  '#3c82f6',
  '#f9705c',
  '#27b98b',
  '#e06ca8',
  '#f08a3e',
  '#38bdf8',
  '#a78bfa',
  '#2dd4bf',
  '#fb7185',
] as const

const HOLD_MIN_MS = 1500
const HOLD_MAX_MS = 4000

function randomHold(): number {
  return HOLD_MIN_MS + Math.random() * (HOLD_MAX_MS - HOLD_MIN_MS)
}

function pickOther<T extends string>(items: readonly T[], current: string): T {
  const pool = items.filter(item => item !== current)
  const source = pool.length > 0 ? pool : items
  const index = Math.floor(Math.random() * source.length)
  return source[index] ?? source[0] as T
}

interface Props {
  /** CSS 像素，默认落在顶栏条里。 */
  size?: number
}

export function MorphBot({ size = 80 }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host)
      return

    const bot: MorphBotElement = document.createElement('morph-bot')
    bot.setAttribute('decorative', '')
    bot.size = size
    bot.shape = pickOther(MORPH_BOT_SHAPES, '')
    bot.setAttribute('eye-color', '#f4f7fb')
    bot.setMaterial('solid', { color: pickOther(BODY_COLORS, '') })
    host.replaceChildren(bot)

    let cancelled = false

    const run = async () => {
      let state: MorphBotState = pickOther(MORPH_BOT_STATES, '')
      while (true) {
        if (cancelled)
          return
        let result: { cancelled: boolean }
        try {
          result = await bot.playSequence([{ state, hold: randomHold() }], { loop: false })
        }
        catch {
          return
        }
        if (cancelled || result.cancelled)
          return
        if (Math.random() < 0.5) {
          bot.setShape(pickOther(MORPH_BOT_SHAPES, bot.shape))
          bot.setMaterial('solid', { color: pickOther(BODY_COLORS, bot.getAttribute('color') ?? '') })
        }
        state = pickOther(MORPH_BOT_STATES, bot.state)
      }
    }

    void run()

    return () => {
      cancelled = true
      bot.stopSequence()
      host.replaceChildren()
    }
  }, [size])

  return (
    <div
      ref={hostRef}
      className="inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    />
  )
}
