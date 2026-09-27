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
        'min-h-11 rounded-full px-5 text-sm font-medium text-[var(--fg)] transition-colors hover:bg-black/[0.05] data-[state=active]:bg-white data-[state=active]:shadow-[0_1px_3px_rgba(0,0,0,0.12)]',
        className,
      )}
      {...props}
    />
  )
}

export const TabsContent = RadixTabs.Content
