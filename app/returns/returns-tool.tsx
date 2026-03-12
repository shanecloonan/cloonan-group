"use client";

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type DragEvent,
  type ChangeEvent,
} from "react";

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

const LEFT_HEADERS = [
  "Item",
  "Dept",
  "Item Desc",
  "Rtn Cd",
  "Normal Qty",
  "Driver",
  "Selector",
  "Cust No",
  "Cust Name",
  "Cust Order",
  "Route",
  "Stop",
  "Memo",
];

const RAW_REASONS = [
  "Overlooked and Returned",
  "Damage on Truck",
  "Short on Truck",
  "Mispick Refused",
];

const WEEK_TAG = "FW27";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface LogEntry {
  msg: string;
  type: "normal" | "success" | "error";
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/* ================================================================== */
/*  COMPONENT                                                          */
/* ================================================================== */

export default function ReturnsTool() {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([
    { msg: "Waiting for file input...", type: "normal" },
  ]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const logBoxRef = useRef<HTMLDivElement>(null);

  const log = useCallback(
    (msg: string, type: LogEntry["type"] = "normal") => {
      setLogs((prev) => [...prev, { msg, type }]);
    },
    [],
  );

  useEffect(() => {
    logBoxRef.current?.scrollTo(0, logBoxRef.current.scrollHeight);
  }, [logs]);

  /* ---- file handling ---- */
  const handleFile = useCallback(
    (f: File) => {
      if (!f.name.toLowerCase().endsWith(".xlsx")) {
        log("Invalid file type. Please upload .xlsx", "error");
        return;
      }
      setFile(f);
      log(`File loaded: ${f.name}`, "success");
    },
    [log],
  );

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    },
    [handleFile],
  );

  const onFileInput = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) handleFile(e.target.files[0]);
    },
    [handleFile],
  );

  /* ================================================================ */
  /*  Main processing                                                  */
  /* ================================================================ */

  const handleRun = useCallback(async () => {
    if (!file) {
      log("Please select a file first.", "error");
      return;
    }
    log("Processing file...");

    try {
      const ExcelJS = (await import("exceljs")).default;
      const buffer = await file.arrayBuffer();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const ws = wb.worksheets[0];

      /* ---- header mapping ---- */
      const headerRow = ws.getRow(1);
      const headerMap: Record<string, number> = {};
      headerRow.eachCell((cell, col) => {
        if (cell.value) headerMap[String(cell.value).trim()] = col;
      });

      const missing = LEFT_HEADERS.filter((h) => !headerMap[h]);
      if (missing.length) {
        log(`Missing columns: ${missing.join(", ")}`, "error");
        return;
      }

      /* ---- extract rows ---- */
      const allRows: Record<string, unknown>[] = [];
      ws.eachRow((row, rNum) => {
        if (rNum === 1) return;
        const obj: Record<string, unknown> = {};
        let hasData = false;
        LEFT_HEADERS.forEach((h) => {
          const val = row.getCell(headerMap[h]).value;
          obj[h] = val;
          if (val != null && val !== "") hasData = true;
        });
        if (hasData) allRows.push(obj);
      });
      log(`Extracted ${allRows.length} return lines.`);

      /* ---- group by reason ---- */
      const groups: Record<string, Record<string, unknown>[]> = {
        "Overlooked and Returned": [],
        "Damage on Truck": [],
        "Short on Truck": [],
        "Mispick-Refused": [],
      };

      allRows.forEach((row) => {
        const rtn = row["Rtn Cd"];
        if (!rtn) return;
        const match = String(rtn).match(/[-–—]\s*(.+)$/);
        if (!match) return;
        const reason = match[1].trim();
        if (reason === "Mispick Refused") {
          groups["Mispick-Refused"].push(row);
        } else if (RAW_REASONS.includes(reason)) {
          if (reason === "Overlooked and Returned") groups["Overlooked and Returned"].push(row);
          else if (reason === "Damage on Truck") groups["Damage on Truck"].push(row);
          else if (reason === "Short on Truck") groups["Short on Truck"].push(row);
        }
      });

      /* ---- styling helpers ---- */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const applyHeaderStyle = (cell: any) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const applyDataStyle = (cell: any, isTextLeft = false) => {
        cell.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
        cell.alignment = { horizontal: isTextLeft ? "left" : "center", vertical: "middle" };
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const autoSizeColumns = (sheet: any) => {
        sheet.columns.forEach((col: any) => {
          let max = 10;
          col.eachCell?.({ includeEmpty: true }, (cell: any) => {
            const len = cell.value ? String(cell.value).length : 0;
            if (len > max) max = len;
          });
          col.width = Math.min(max + 4, 60);
        });
      };

      /* ---- add sheet function ---- */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const addSheet = (workbook: any, rows: Record<string, unknown>[], sheetName: string, isOverDamage: boolean) => {
        if (rows.length === 0) return;
        const summaryField = isOverDamage ? "Driver" : "Selector";
        const hasDetailed = isOverDamage;

        const sheet = workbook.addWorksheet(sheetName);
        const detailColsCount = LEFT_HEADERS.length;
        const itemStart = detailColsCount + 3;
        const rlStart = itemStart + 4;
        const detailedStart = rlStart + 4;

        /* blue headers (left data) */
        LEFT_HEADERS.forEach((h, i) => {
          const cell = sheet.getCell(1, i + 1);
          cell.value = h;
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } };
          applyHeaderStyle(cell);
        });

        /* orange pivot headers: Item pivot */
        ["Item", "Item Desc", "Sum of Normal Qty"].forEach((txt, i) => {
          const cell = sheet.getCell(1, itemStart + i);
          cell.value = txt;
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFED7D31" } };
          applyHeaderStyle(cell);
        });

        /* orange: Row Labels pivot */
        sheet.getCell(1, rlStart).value = "Row Labels";
        sheet.getCell(1, rlStart + 1).value = "Sum of Normal Qty";
        [rlStart, rlStart + 1].forEach((col) => {
          const cell = sheet.getCell(1, col);
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFED7D31" } };
          applyHeaderStyle(cell);
        });

        /* orange: Detailed pivot (Over/Damage only) */
        if (hasDetailed) {
          ["Driver", "Item", "Item Desc", "Sum of Normal Qty"].forEach((txt, i) => {
            const cell = sheet.getCell(1, detailedStart + i);
            cell.value = txt;
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFED7D31" } };
            applyHeaderStyle(cell);
          });
        }

        /* write detail data rows */
        rows.forEach((row, idx) => {
          const r = idx + 2;
          LEFT_HEADERS.forEach((h, i) => {
            const cell = sheet.getCell(r, i + 1);
            cell.value = (row[h] as string | number | null) ?? "";
            applyDataStyle(cell, i === 2 || i === 8);
          });
        });

        /* ---- calculations ---- */
        const grandTotal = rows.reduce((sum, r) => sum + (Number(r["Normal Qty"]) || 0), 0);

        const itemMap: Record<string, { desc: string; qty: number }> = {};
        const summaryMap: Record<string, number> = {};
        const summaryItems: Record<string, Record<string, { desc: string; qty: number }>> = {};

        rows.forEach((row) => {
          const qty = Number(row["Normal Qty"]) || 0;
          const itm = row["Item"] as string;
          const desc = (row["Item Desc"] as string) || "";
          let sumVal = String(row[summaryField] ?? "").trim() || "(blank)";

          if (itm) {
            if (!itemMap[itm]) itemMap[itm] = { desc, qty: 0 };
            if (itemMap[itm].desc === "") itemMap[itm].desc = desc;
            itemMap[itm].qty += qty;
          }

          summaryMap[sumVal] = (summaryMap[sumVal] || 0) + qty;
          if (!summaryItems[sumVal]) summaryItems[sumVal] = {};
          if (itm) {
            if (!summaryItems[sumVal][itm]) summaryItems[sumVal][itm] = { desc, qty: 0 };
            summaryItems[sumVal][itm].desc = desc;
            summaryItems[sumVal][itm].qty += qty;
          }
        });

        const itemKeys = Object.keys(itemMap).sort(
          (a, b) => itemMap[b].qty - itemMap[a].qty || a.localeCompare(b),
        );
        const summaryKeys = Object.keys(summaryMap).sort((a, b) => {
          if (a === "(blank)") return 1;
          if (b === "(blank)") return -1;
          return summaryMap[b] - summaryMap[a] || a.localeCompare(b);
        });

        /* Item pivot */
        let r = 2;
        itemKeys.forEach((k) => {
          const { desc, qty } = itemMap[k];
          sheet.getCell(r, itemStart).value = k;
          sheet.getCell(r, itemStart + 1).value = desc;
          sheet.getCell(r, itemStart + 2).value = qty;
          [itemStart, itemStart + 1, itemStart + 2].forEach((c) =>
            applyDataStyle(sheet.getCell(r, c), c === itemStart + 1),
          );
          r++;
        });
        if (grandTotal > 0) {
          sheet.getCell(r, itemStart).value = "Grand Total";
          sheet.getCell(r, itemStart + 2).value = grandTotal;
          [itemStart, itemStart + 2].forEach((c) => (sheet.getCell(r, c).font = { bold: true }));
          r += 2;
        }

        /* Row Labels pivot */
        r = 2;
        summaryKeys.forEach((k) => {
          const display = k === "(blank)" ? "" : k;
          sheet.getCell(r, rlStart).value = display;
          sheet.getCell(r, rlStart + 1).value = summaryMap[k];
          [rlStart, rlStart + 1].forEach((c) =>
            applyDataStyle(sheet.getCell(r, c), c === rlStart),
          );
          r++;
        });
        if (grandTotal > 0) {
          sheet.getCell(r, rlStart).value = "Grand Total";
          sheet.getCell(r, rlStart + 1).value = grandTotal;
          [rlStart, rlStart + 1].forEach((c) => (sheet.getCell(r, c).font = { bold: true }));
        }

        /* Detailed outline pivot (Over/Damage only) */
        if (hasDetailed) {
          r = 2;
          summaryKeys.forEach((k) => {
            const display = k === "(blank)" ? "" : k;
            const items = summaryItems[k] || {};
            const itemKs = Object.keys(items).sort(
              (a, b) => items[b].qty - items[a].qty || a.localeCompare(b),
            );

            itemKs.forEach((itm) => {
              const { desc, qty } = items[itm];
              sheet.getCell(r, detailedStart).value = "";
              sheet.getCell(r, detailedStart + 1).value = itm;
              sheet.getCell(r, detailedStart + 2).value = desc;
              sheet.getCell(r, detailedStart + 3).value = qty;
              [detailedStart, detailedStart + 1, detailedStart + 2, detailedStart + 3].forEach(
                (c) => applyDataStyle(sheet.getCell(r, c), c === detailedStart + 2),
              );
              r++;
            });

            sheet.getCell(r, detailedStart).value = display;
            sheet.getCell(r, detailedStart + 3).value = summaryMap[k];
            [detailedStart, detailedStart + 3].forEach((c) => {
              applyDataStyle(sheet.getCell(r, c));
              sheet.getCell(r, c).font = { bold: true };
            });
            r++;
          });

          if (grandTotal > 0) {
            sheet.getCell(r, detailedStart).value = "Grand Total";
            sheet.getCell(r, detailedStart + 3).value = grandTotal;
            [detailedStart, detailedStart + 3].forEach(
              (c) => (sheet.getCell(r, c).font = { bold: true }),
            );
          }
        }

        /* column widths */
        sheet.getColumn(3).width = 45;
        sheet.getColumn(9).width = 40;
        sheet.getColumn(itemStart + 1).width = 45;
        sheet.getColumn(rlStart).width = 40;
        if (hasDetailed) sheet.getColumn(detailedStart + 2).width = 45;
        autoSizeColumns(sheet);
      };

      /* ---- create two workbooks ---- */
      const wbOverDamage = new ExcelJS.Workbook();
      const wbShortMispick = new ExcelJS.Workbook();

      addSheet(wbOverDamage, groups["Overlooked and Returned"], "Overlooked and Returned", true);
      addSheet(wbOverDamage, groups["Damage on Truck"], "Damage on Truck", true);
      addSheet(wbShortMispick, groups["Short on Truck"], "Short on Truck", false);
      addSheet(wbShortMispick, groups["Mispick-Refused"], "Mispick-Refused", false);

      /* ---- download ---- */
      const buf1 = await wbOverDamage.xlsx.writeBuffer();
      const buf2 = await wbShortMispick.xlsx.writeBuffer();

      downloadBlob(
        new Blob([buf1], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        `Overlooked and Returned and Damage on Truck ${WEEK_TAG}.xlsx`,
      );
      log(`Downloaded: Overlooked and Returned and Damage on Truck ${WEEK_TAG}.xlsx`, "success");

      downloadBlob(
        new Blob([buf2], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        `Short on Truck and Mispick-Refused ${WEEK_TAG}.xlsx`,
      );
      log(`Downloaded: Short on Truck and Mispick-Refused ${WEEK_TAG}.xlsx`, "success");

      log("All reports generated successfully!", "success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`ERROR: ${msg}`, "error");
    }
  }, [file, log]);

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 sm:p-10"
      style={{ background: "#0f172a" }}
    >
      <div className="w-full max-w-[1000px] bg-[#1e293b] rounded-2xl p-6 sm:p-10 border border-[#334155] shadow-[0_10px_15px_-3px_rgba(0,0,0,0.5)]">
        {/* Header */}
        <h1
          className="text-4xl font-extrabold text-center mb-2"
          style={{
            background: "linear-gradient(to right, #38bdf8, #818cf8)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Returns Report
        </h1>
        <p className="text-center text-gray-400 mb-8">
          Custom software by Shane Cloonan
        </p>

        {/* Drop zone */}
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
          onDrop={onDrop}
          className={`rounded-xl py-14 px-6 text-center cursor-pointer transition-all mb-8 border-[3px] border-dashed ${
            dragging
              ? "border-emerald-400 bg-[#14532d]"
              : file
                ? "border-emerald-400 bg-[#0f172a]"
                : "border-[#475569] bg-[#0f172a] hover:border-sky-400 hover:bg-[#162a45]"
          }`}
        >
          {file ? (
            <>
              <p className="text-xl text-emerald-400 font-bold">{file.name}</p>
              <p className="text-sm text-gray-400 mt-2">Ready to process</p>
            </>
          ) : (
            <>
              <svg
                className="w-16 h-16 mx-auto text-gray-500 mb-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
              <p className="text-xl text-gray-300 pointer-events-none">
                Drop Excel File Here
              </p>
              <p className="text-sm text-gray-500 mt-2 pointer-events-none">
                Supports .xlsx
              </p>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={onFileInput}
          />
        </div>

        {/* Run button */}
        <button
          type="button"
          onClick={handleRun}
          className="w-full py-4 rounded-lg text-white font-bold text-xl transition-all hover:-translate-y-0.5 active:translate-y-0.5"
          style={{
            background: "linear-gradient(to right, #0ea5e9, #2563eb)",
            boxShadow: "0 4px 12px rgba(14,165,233,0.3)",
          }}
        >
          GENERATE REPORTS
        </button>

        {/* Log */}
        <div
          ref={logBoxRef}
          className="mt-5 p-5 rounded-lg h-[250px] overflow-y-auto font-mono text-sm border border-[#334155]"
          style={{ background: "#000", color: "#22d3ee" }}
        >
          {logs.map((l, i) => (
            <div
              key={i}
              className={`mb-1 pb-0.5 border-b border-[#1e293b] ${
                l.type === "success"
                  ? "text-emerald-400 font-bold"
                  : l.type === "error"
                    ? "text-red-400 font-bold"
                    : "text-[#22d3ee]"
              }`}
            >
              &gt; {l.msg}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
