import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import type { ComponentPropsWithoutRef, Ref } from "react";

import { css, cx } from "@/styled/css";

const rootStyle = css({
  position: "relative",
  overflow: "hidden",
  width: "full",
  height: "full",
});

const viewportStyle = css({
  width: "full",
  height: "full",
});

const scrollbarStyle = css({
  display: "flex",
  userSelect: "none",
  touchAction: "none",
  p: "[2px]",

  '&[data-orientation="vertical"]': {
    width: "[10px]",
  },
  '&[data-orientation="horizontal"]': {
    flexDirection: "column",
    height: "[10px]",
  },
});

const thumbStyle = css({
  flex: "[1]",
  bg: "[#576171]",
  opacity: "[0.24]",
  rounded: "full",
  position: "relative",
});

type ScrollAreaProps = ComponentPropsWithoutRef<
  typeof ScrollAreaPrimitive.Viewport
> & {
  viewportRef?: Ref<HTMLDivElement>;
  /** Which scrollbar(s) to render. Radix only shows a bar on the axis that
   *  actually overflows, so rendering the horizontal one unconditionally
   *  for `"horizontal"`/`"both"` is safe — it stays invisible otherwise. */
  orientation?: "vertical" | "horizontal" | "both";
};

function ScrollArea({
  className,
  viewportRef,
  children,
  orientation = "vertical",
  ...props
}: ScrollAreaProps) {
  return (
    <ScrollAreaPrimitive.Root className={cx(rootStyle, className)}>
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        className={viewportStyle}
        {...props}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      {(orientation === "vertical" || orientation === "both") && (
        <ScrollAreaPrimitive.Scrollbar
          orientation="vertical"
          className={scrollbarStyle}
        >
          <ScrollAreaPrimitive.Thumb className={thumbStyle} />
        </ScrollAreaPrimitive.Scrollbar>
      )}
      {(orientation === "horizontal" || orientation === "both") && (
        <ScrollAreaPrimitive.Scrollbar
          orientation="horizontal"
          className={scrollbarStyle}
        >
          <ScrollAreaPrimitive.Thumb className={thumbStyle} />
        </ScrollAreaPrimitive.Scrollbar>
      )}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

export default ScrollArea;
