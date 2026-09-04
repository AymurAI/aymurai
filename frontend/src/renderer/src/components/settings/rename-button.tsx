import { PencilSimple } from "phosphor-react";
import { css } from "@/styled/css";
import { styled } from "@/styled/jsx";

/** The quiet 32px icon button the holder cards already use for corrections. */
const button = css({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  w: "8",
  h: "8",
  p: "0",
  flexShrink: "0",
  border: "[none]",
  bg: "[transparent]",
  color: "text.lighter",
  borderRadius: "sm",
  cursor: "pointer",
  transition: "[background-color 150ms cubic-bezier(0.4, 0, 0.2, 1)]",
  _hover: { bg: "bg.primary-alternative", color: "text.default" },
  _focusVisible: { outline: "[2px solid token(colors.text.default)]" },
});

interface RenameButtonProps {
  /** Must identify the row: several of these sit in one list. */
  label: string;
  onClick: () => void;
}

export default function RenameButton({ label, onClick }: RenameButtonProps) {
  return (
    <styled.button
      type="button"
      className={button}
      aria-label={label}
      onClick={onClick}
    >
      <PencilSimple size={16} />
    </styled.button>
  );
}
