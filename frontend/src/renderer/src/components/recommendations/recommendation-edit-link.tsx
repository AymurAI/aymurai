import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@aymurai/ui";
import { Link } from "@tanstack/react-router";
import { PencilSimple } from "phosphor-react";
import { css } from "@/styled/css";

const editLink = css({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  w: "8",
  h: "8",
  color: "text.lighter",
  borderRadius: "sm",
  textDecoration: "none",
  _hover: { bg: "bg.primary-alternative", color: "text.default" },
  _focusVisible: { outline: "[2px solid token(colors.text.default)]" },
});

interface RecommendationEditLinkProps {
  recommendationId: string;
  label: string;
}

export default function RecommendationEditLink({
  recommendationId,
  label,
}: RecommendationEditLinkProps) {
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={css({ display: "inline-flex" })}>
            <Link
              to="/home/dataset/$recommendationId"
              params={{ recommendationId }}
              className={editLink}
              aria-label={label}
            >
              <PencilSimple size={16} aria-hidden="true" />
            </Link>
          </span>
        </TooltipTrigger>
        <TooltipContent showArrow={false}>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
