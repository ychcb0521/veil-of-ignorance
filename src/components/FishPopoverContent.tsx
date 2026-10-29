import * as React from 'react';
import { PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/** Fish-only viewport bounds; dynamic content must scroll inside its Radix collision area. */
export const FishPopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverContent>,
  React.ComponentPropsWithoutRef<typeof PopoverContent>
>(({ className, collisionPadding = 12, ...props }, ref) => (
  <PopoverContent ref={ref} collisionPadding={collisionPadding} {...props} className={cn(
    'max-w-[calc(100vw-1.5rem)] max-h-[min(85dvh,var(--radix-popover-content-available-height))] overflow-y-auto overscroll-contain',
    className,
  )}/>
));
FishPopoverContent.displayName = 'FishPopoverContent';
