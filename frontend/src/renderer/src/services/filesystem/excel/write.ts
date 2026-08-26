import type { Workbook } from "exceljs";
import { downloadBlob } from "@/services/export/download-blob";
import filesystemAPI from "../utils";

const DATASET_FILENAME = "set_de_datos.xlsx";
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Writes the `.xlsx` in Buffer format to the filesystem
 * @param workbook Workbook to persist
 */
export default async function write(workbook: Workbook) {
  const buffer = await workbook.xlsx.writeBuffer();

  // Electron owns a real dataset file on disk and appends to it. The browser
  // has no such file, so each submission hands the user a fresh download.
  if (window.filesystem) {
    return filesystemAPI().excel.write(buffer);
  }

  downloadBlob(new Blob([buffer], { type: XLSX_MIME }), DATASET_FILENAME);
}
