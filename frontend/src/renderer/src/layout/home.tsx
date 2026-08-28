import BuiltBy from "@/components/brand/built-by";
import { css, cva } from "@/styled/css";

const background = css({
  display: "flex",
  bg: "bg.primary-highlight",
  height: "screen",
  width: "screen",
  p: "8",
});

const inner = css({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  pos: "relative",
  bg: "bg.secondary",
  border: "primary",
  width: "full",
  height: "full",
  overflowY: "auto",
  pb: "8",
});

const childrenArea = cva({
  base: {
    flex: "1",
    display: "flex",
    width: "full",
  },
  variants: {
    variant: {
      narrow: {
        alignItems: "center",
        justifyContent: "center",
      },
      wide: {
        flexDirection: "column",
        alignItems: "stretch",
        justifyContent: "flex-start",
        gap: "6",
        p: "8",
      },
    },
  },
  defaultVariants: {
    variant: "narrow",
  },
});

interface HomeLayoutProps {
  children?: React.ReactNode;
  variant?: "narrow" | "wide";
}
export default function HomeLayout({
  children,
  variant = "narrow",
}: HomeLayoutProps) {
  return (
    <main className={background}>
      <div className={inner}>
        <div className={childrenArea({ variant })}>{children}</div>
        <BuiltBy />
      </div>
    </main>
  );
}
