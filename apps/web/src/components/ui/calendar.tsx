"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker } from "react-day-picker"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      showWeekNumber={false}
      className={cn("p-3", className)}
      classNames={{
        months: "relative flex flex-col sm:flex-row gap-2",
        month: "flex flex-col gap-3",
        // The caption row and the nav row share one height and both center
        // vertically, so the chevrons sit level with the month label. The
        // caption is pointer-events-none (it's not interactive) so its
        // full-width flex box never sits on top of the nav buttons and
        // silently eats their clicks — that was why Prev/Next did nothing.
        month_caption: "pointer-events-none flex h-8 items-center justify-center px-8",
        caption_label: "text-sm font-medium",
        nav: "absolute inset-x-0 top-0 z-10 flex h-8 items-center justify-between pointer-events-none",
        button_previous: cn(
          buttonVariants({ variant: "outline" }),
          "pointer-events-auto size-7 !rounded-[6px] bg-transparent p-0 opacity-70 hover:opacity-100"
        ),
        button_next: cn(
          buttonVariants({ variant: "outline" }),
          "pointer-events-auto size-7 !rounded-[6px] bg-transparent p-0 opacity-70 hover:opacity-100"
        ),
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday:
          "text-muted-foreground w-8 font-normal text-[0.72rem]",
        week: "flex w-full mt-1.5",
        day: "relative p-0 text-center text-[0.8rem]",
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "size-8 !rounded-[6px] p-0 font-normal"
        ),
        // Square-with-rounded-edges highlight for the selected day.
        selected:
          "[&>button]:!rounded-[6px] [&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary [&>button]:hover:text-primary-foreground",
        today: "[&>button]:!rounded-[6px] [&>button]:bg-accent [&>button]:text-accent-foreground",
        outside: "text-muted-foreground/50",
        disabled: "text-muted-foreground opacity-40",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === "left" ? (
            <ChevronLeft className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          ),
      }}
      {...props}
    />
  )
}
Calendar.displayName = "Calendar"

export { Calendar }
