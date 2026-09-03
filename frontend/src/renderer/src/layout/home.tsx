import BuiltBy from "@/components/brand/built-by";
import Header from "@/components/layout/header";
import { useConnectedHost } from "@/hooks/useConnectedHost";
import { css, cva } from "@/styled/css";

/**
 * The header is full-bleed above the violet frame, exactly as it is on every
 * feature screen — the frame belongs to the page, not to the app chrome.
 */
const page = css({
  display: "flex",
  flexDirection: "column",
  height: "[100dvh]",
  width: "full",
});

const background = css({
  display: "flex",
  bg: "bg.primary-highlight",
  flex: "1",
  minH: "0",
  width: "full",
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
        // A flex child defaults to `min-height: auto`, so without this the
        // area grows past its `flex: 1` track and `inner` scrolls the whole
        // page — the wide screens (Configuración) instead scroll inside their
        // own panels, which is what keeps their add-forms pinned in view.
        minH: "0",
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
  // The header is the way back into the app, so it only makes sense once there
  // is an app to go back to: on a first run the Servidor screen is the whole
  // product, and its logo would lead to a route `APIProtected` bounces off.
  const isConnected = useConnectedHost() !== null;

  return (
    <div className={page}>
      {isConnected && <Header />}
      <main className={background}>
        <div className={inner}>
          <div className={childrenArea({ variant })}>{children}</div>
          <BuiltBy />
        </div>
      </main>
    </div>
  );
}
