import { css } from "@/styled/css";
import { GCBA_MACRO_SECTOR_CODE, type MacroSector } from "@/types/catalogs";
import type { RecipientDetail } from "@/types/dataExtraction";

export function recipientSector(
  recipient: RecipientDetail,
  catalogs: MacroSector[],
): string | null {
  if (recipient.sector_id && recipient.sector_name)
    return recipient.sector_name;
  const macro = catalogs.find(
    (item) =>
      item.name === recipient.macro_sector ||
      item.code === recipient.macro_sector,
  );
  if (
    macro?.code === GCBA_MACRO_SECTOR_CODE ||
    recipient.macro_sector === GCBA_MACRO_SECTOR_CODE
  ) {
    return recipient.sector_id ? recipient.sector_name : null;
  }
  return macro?.name ?? recipient.macro_sector;
}

export function primaryRecipient(
  recipients: RecipientDetail[],
): RecipientDetail | null {
  return (
    recipients.find((recipient) => recipient.is_primary) ??
    recipients[0] ??
    null
  );
}

const recipientText = css({
  display: "block",
  overflowWrap: "anywhere",
  fontSize: "[clamp(13px, 1vw, 14px)]",
  lineHeight: "[1.25]",
});

export function RecipientDisplay({
  recipient,
  catalogs,
}: {
  recipient: RecipientDetail;
  catalogs: MacroSector[];
}) {
  return (
    <div>
      <strong
        className={css({
          display: "block",
          overflowWrap: "anywhere",
          fontSize: "[clamp(13px, 1vw, 14px)]",
          lineHeight: "[1.25]",
          fontWeight: "semibold",
        })}
      >
        {recipientSector(recipient, catalogs) ?? "—"}
      </strong>
      <span className={recipientText}>
        {recipient.name ?? recipient.position ?? "—"}
      </span>
    </div>
  );
}
