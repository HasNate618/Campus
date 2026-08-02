import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2 py-px text-[11px] font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring/50',
  {
    variants: {
      variant: {
        default: 'border-primary/30 bg-primary/10 text-primary',
        secondary: 'border-border bg-secondary text-secondary-foreground',
        destructive: 'border-destructive/30 bg-destructive/10 text-destructive',
        outline: 'border-border text-muted-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
