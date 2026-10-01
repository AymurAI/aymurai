import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@aymurai/ui";
import { Link } from "@tanstack/react-router";
import { PencilSimple } from "phosphor-react";
import { css } from "@/styled/css";
import type { RecommendationsGridSearch } from "./recommendations-grid-search";

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
  /**
   * The grilla's current URL search, carried to the correction screen so it
   * can send the person back to the same filters, sort, page and tab.
   */
  gridSearch: RecommendationsGridSearch;
}

export default function RecommendationEditLink({
  recommendationId,
  label,
  gridSearch,
}: RecommendationEditLinkProps) {
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={css({ display: "inline-flex" })}>
            <Link
              to="/home/dataset/$recommendationId"
              params={{ recommendationId }}
              search={gridSearch}
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
