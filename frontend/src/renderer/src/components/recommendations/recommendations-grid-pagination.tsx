import { Button } from "@aymurai/ui";
import { CaretLeft, CaretRight } from "phosphor-react";
import { useTranslation } from "react-i18next";
import { css } from "@/styled/css";
import { HStack, styled } from "@/styled/jsx";

const label = css({
  textStyle: "paragraph.sm.default",
  color: "text.lighter",
});

export default function RecommendationsGridPagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const { t } = useTranslation("recommendations");
  if (total <= pageSize) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return (
    <HStack justify="flex-end" alignItems="center" gap="3">
      <styled.span className={label}>
        {t("grilla.pagination.range", { from: first, to: last, total })}
      </styled.span>
      <Button
        variant="tertiary"
        size="sm"
        aria-label={t("grilla.pagination.previous")}
        disabled={page <= 1}
        onClick={() => onPage(Math.max(1, page - 1))}
      >
        <CaretLeft size={16} aria-hidden="true" />
      </Button>
      <Button
        variant="tertiary"
        size="sm"
        aria-label={t("grilla.pagination.next")}
        disabled={last >= total}
        onClick={() => onPage(page + 1)}
      >
        <CaretRight size={16} aria-hidden="true" />
      </Button>
    </HStack>
  );
}
