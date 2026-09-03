import type { ReactNode } from "react";
import { css, cx } from "@/styled/css";
import { HStack, Stack, styled } from "@/styled/jsx";

const surface = css({
  bg: "bg.primary",
  border: "card",
  borderRadius: "lg",
  p: "4",
  gap: "4",
  minH: "0",
  minW: "0",
});

const scrollArea = css({
  flex: "1",
  minH: "0",
  overflowY: "auto",
  gap: "2",
  pr: "1",
});

interface PanelSurfaceProps {
  /** Panel heading — `subtitle.md.strong`, per the settings design. */
  title: string;
  /** Optional qualifier rendered next to the title (e.g. the selected topic). */
  subtitle?: string;
  /** Right-hand side of the header row: a count caption or an action button. */
  headerAside?: ReactNode;
  /** Fixed above the scroll area (search field). */
  toolbar?: ReactNode;
  /** Fixed below the scroll area (the add-item form). */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * The grey rounded surface both Configuración screens are built from: white
 * rows/cards sit on `bg.primary`, mirroring how `SidePanel` composes its own
 * content in `@aymurai/ui`. Header and footer stay put; only `children` scroll,
 * which matters with the real catalog (242 subtopics, 520 organigram units).
 */
export default function PanelSurface({
  title,
  subtitle,
  headerAside,
  toolbar,
  footer,
  children,
  className,
}: PanelSurfaceProps) {
  return (
    <Stack className={cx(surface, className)}>
      <HStack justify="space-between" gap="2" alignItems="baseline">
        <HStack gap="2" alignItems="baseline" minW="0">
          <styled.h2 textStyle="subtitle.md.strong" color="text.default">
            {title}
          </styled.h2>
          {subtitle && (
            <styled.span
              textStyle="paragraph.sm.default"
              color="text.lighter"
              overflow="hidden"
              textOverflow="ellipsis"
              whiteSpace="nowrap"
            >
              · {subtitle}
            </styled.span>
          )}
        </HStack>
        {headerAside}
      </HStack>

      {toolbar}

      <Stack className={scrollArea}>{children}</Stack>

      {footer}
    </Stack>
  );
}
