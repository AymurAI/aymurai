import { Tooltip, TooltipContent, TooltipTrigger } from "@aymurai/ui";
import { css } from "@/styled/css";
import { token } from "@/styled/tokens";

const preview = css({
  width: "full",
  p: "0",
  border: "none",
  bg: "transparent",
  color: "[inherit]",
  textAlign: "left",
  font: "inherit",
  lineClamp: "3",
  overflowWrap: "anywhere",
  textStyle: "paragraph.sm.default",
  cursor: "help",
  _focusVisible: {
    outline: "[2px solid token(colors.action.focus)]",
    outlineOffset: "2",
    borderRadius: "sm",
  },
});

const fullContent = css({
  maxW: "[480px]",
  whiteSpace: "normal",
  overflowWrap: "anywhere",
  textStyle: "paragraph.sm.default",
  p: "3",
  borderRadius: "sm",
});

interface PublishableContentPreviewProps {
  content: string;
  label: string;
}

export default function PublishableContentPreview({
  content,
  label,
}: PublishableContentPreviewProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={preview}
          aria-label={`${label}: ${content}`}
        >
          {content}
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        showArrow={false}
        className={fullContent}
        style={{
          backgroundColor: token("colors.action.hover"),
          color: token("colors.text.onbutton-alternative"),
        }}
      >
        {content}
      </TooltipContent>
    </Tooltip>
  );
}
