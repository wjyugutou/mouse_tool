import { Separator as SeparatorPrimitive } from 'radix-ui'
import * as React from 'react'
import { cn } from '@/lib/utils'
import css from './style.module.css'

function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(css.root, className)}
      {...props}
    />
  )
}

export { Separator }
