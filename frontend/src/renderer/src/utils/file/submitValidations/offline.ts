import type { FormValue } from "@/hooks/useForm";
import filesystem from "@/services/filesystem";
import type { Workbook } from "exceljs";

// `excel.read()` returns null in the browser (no on-disk dataset) and can
// return a workbook with no worksheets if the file exists but is empty. Both
// mean "start from a fresh template".
function getWritableWorkbook(workbook: Workbook | null) {
  if (!workbook || workbook.worksheets.length === 0) {
    return filesystem.excel.create();
  }

  return workbook;
}

/**
 * Writes the validated data to the filesystem, creating new rows on the already existent dataset
 * In case there is no dataset, we create a new empty one
 * @param validations Validations to write to the filesystem
 * @returns Returns the recently submitted Workbook
 */
export default async function offline(validations: FormValue[][]) {
  const workbook = getWritableWorkbook(await filesystem.excel.read());

  const worksheet = workbook.worksheets[0];
  worksheet.addRows(validations);

  await filesystem.excel.write(workbook);

  return workbook;
}
