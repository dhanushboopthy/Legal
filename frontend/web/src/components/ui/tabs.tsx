import * as RadixTabs from '@radix-ui/react-tabs'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

export const Tabs = RadixTabs.Root

export function TabsList({ className, ...props }: ComponentProps<typeof RadixTabs.List>) {
  return (
    <RadixTabs.List
      className={cn('inline-flex flex-wrap items-center gap-1 rounded-[1.5rem] bg-black/[0.05] p-1', className)}
      {...props}
    />
  )
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof RadixTabs.Trigger>) {
  return (
    <RadixTabs.Trigger
      className={cn(
        'min-h-11 rounded-full px-5 text-sm font-semibold text-[var(--fg)] transition-colors hover:bg-black/[0.05] data-[state=active]:bg-[var(--fg)] data-[state=active]:text-white',
        className,
      )}
      {...props}
    />
  )
}

export const TabsContent = RadixTabs.Content
