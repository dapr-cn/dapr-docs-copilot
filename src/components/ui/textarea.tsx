import * as React from 'react'
import { cn } from '@/lib/utils'

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'min-h-32 w-full rounded-[24px] border border-border bg-background/75 px-4 py-3 text-sm text-foreground shadow-sm outline-none transition placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/60',
          className,
        )}
        ref={ref}
        {...props}
      />
    )
  },
)
Textarea.displayName = 'Textarea'

export { Textarea }
