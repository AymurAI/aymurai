import { css } from "@/styled/css";

export const tableHeadCell = css({
  position: "sticky",
  top: "0",
  zIndex: "[1]",
  bg: "bg.primary",
  px: "3",
  py: "2",
  textAlign: "left",
  whiteSpace: "nowrap",
  textStyle: "label.sm.strong",
  color: "text.lighter",
  borderBottomWidth: "1",
  borderBottomStyle: "solid",
  borderBottomColor: "bg.secondary-highlight",
});

export const stickyFirstHeadCell = css({
  left: "0",
  zIndex: "[3]",
  borderRightWidth: "1",
  borderRightStyle: "solid",
  borderRightColor: "bg.secondary-highlight",
});
