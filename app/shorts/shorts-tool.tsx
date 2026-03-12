"use client";

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type DragEvent,
  type ChangeEvent,
} from "react";
import { supabase, type ShortsHistoryRow } from "@/lib/supabase";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface LogEntry {
  time: string;
  msg: string;
  type: "normal" | "success" | "error";
}

interface HourlyData {
  shorted: number;
  found: number;
  lines: number;
}

type HourlyMap = Record<string, HourlyData>;

type FilterRange = "all" | "week" | "month" | "3m" | "6m" | "year";

/* ------------------------------------------------------------------ */
/*  Column mapping + blacklist                                         */
/* ------------------------------------------------------------------ */

const COL_MAP = [
  { out: "Dept", in: "Dept" },
  { out: "Item", in: "Item" },
  { out: "Description", in: "Description" },
  { out: "Slot", in: "Slot" },
  { out: "Route", in: "Route" },
  { out: "Orig Qty", in: "Orig Qty" },
  { out: "Orig Short", in: "Orig Short" },
  { out: "Qty Found", in: "Qty Found" },
  { out: "Shorted", in: "Shorted" },
];

const SLOT_BLACKLIST = [
  "NSR",
  "OFFICE",
  "WARROOM",
  "XDK",
  "D-DOCK",
  "BLANKS",
  "RMR",
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function ts() {
  return new Date().toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function get12(hr: number) {
  return hr % 12 || 12;
}

function hourLabel(d: Date): string {
  const h = d.getHours();
  const nextH = (h + 1) % 24;
  const ap = h >= 12 ? "PM" : "AM";
  if (h === 23) return "11PM - 12AM";
  if (h === 11) return "11AM - 12PM";
  return `${get12(h)}-${get12(nextH)} ${ap}`;
}

function sortHourKeys(keys: string[]) {
  return [...keys].sort((a, b) => {
    const getVal = (s: string) => {
      const m = s.match(/^(\d+)/);
      let h = m ? parseInt(m[1]) : 0;
      if (s.includes("PM") && h !== 12) h += 12;
      if (s.includes("AM") && h === 12) h = 0;
      return h;
    };
    return getVal(a) - getVal(b);
  });
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ShortsTool() {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([
    { time: ts(), msg: "Shorts Tool v2.8 – System Console", type: "normal" },
  ]);
  const [indicator, setIndicator] = useState("waiting for file...");
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [timerDone, setTimerDone] = useState(false);

  const [tab, setTab] = useState<"console" | "history">("console");
  const [historyCache, setHistoryCache] = useState<ShortsHistoryRow[]>([]);
  const [filterRange, setFilterRange] = useState<FilterRange>("all");
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [expandedDays, setExpandedDays] = useState<Set<number>>(new Set());

  const fileInputRef = useRef<HTMLInputElement>(null);
  const logBoxRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const startRef = useRef(0);

  /* ---- logging ---- */
  const log = useCallback(
    (msg: string, type: "normal" | "success" | "error" = "normal") => {
      setLogs((prev) => [...prev, { time: ts(), msg, type }]);
    },
    [],
  );

  useEffect(() => {
    logBoxRef.current?.scrollTo(0, logBoxRef.current.scrollHeight);
  }, [logs]);

  /* ---- timer ---- */
  const startTimer = useCallback(() => {
    startRef.current = performance.now();
    setRunning(true);
    setTimerDone(false);
    const tick = () => {
      setElapsed((performance.now() - startRef.current) / 1000);
      timerRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) cancelAnimationFrame(timerRef.current);
    setRunning(false);
    setTimerDone(true);
  }, []);

  /* ---- file handling ---- */
  const handleFile = useCallback(
    (f: File) => {
      if (!f.name.toLowerCase().endsWith(".xlsx")) {
        log("Only .xlsx allowed", "error");
        return;
      }
      setFile(f);
      log(`File loaded: ${f.name}`, "success");
      setIndicator("ready");
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

  /* ---- history load ---- */
  const loadHistory = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("shorts_history")
        .select("*")
        .order("report_date", { ascending: true });
      if (error) throw error;
      setHistoryCache(data ?? []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "unknown error";
      log("Cannot load history: " + msg, "error");
    }
  }, [log]);

  useEffect(() => {
    if (tab === "history") loadHistory();
  }, [tab, loadHistory]);

  /* ---- filtered records ---- */
  const filtered = historyCache.filter((r) => {
    if (filterRange === "all") return true;
    const now = Date.now();
    const msDay = 86400000;
    const cutoffs: Record<string, number> = {
      week: 7,
      month: 30,
      "3m": 91,
      "6m": 182,
      year: 365,
    };
    return (
      new Date(r.report_date).getTime() >=
      now - (cutoffs[filterRange] ?? 0) * msDay
    );
  });

  /* ---- stats ---- */
  const sumShort = filtered.reduce((a, r) => a + (r.total_shorted ?? 0), 0);
  const sumFound = filtered.reduce((a, r) => a + (r.total_found ?? 0), 0);
  const sumLines = filtered.reduce((a, r) => a + (r.total_lines ?? 0), 0);
  const cnt = filtered.length;

  /* ---- hourly averages ---- */
  const hourlyAvgData = (() => {
    const stats: Record<
      string,
      { shorted: number; found: number; lines: number; count: number }
    > = {};
    filtered.forEach((r) => {
      if (!r.hourly) return;
      Object.entries(r.hourly).forEach(([hour, vals]) => {
        if (!stats[hour])
          stats[hour] = { shorted: 0, found: 0, lines: 0, count: 0 };
        stats[hour].shorted += Number(vals.shorted ?? 0);
        stats[hour].found += Number(vals.found ?? 0);
        stats[hour].lines += Number(vals.lines ?? 0);
        stats[hour].count++;
      });
    });
    return Object.entries(stats).sort(
      ([, a], [, b]) => b.shorted / b.count - a.shorted / a.count,
    );
  })();

  /* ---- hourly totals ---- */
  const hourlyTotalsData = (() => {
    const totals: Record<
      string,
      { shorted: number; found: number; lines: number }
    > = {};
    filtered.forEach((r) => {
      if (!r.hourly) return;
      Object.entries(r.hourly).forEach(([h, v]) => {
        if (!totals[h]) totals[h] = { shorted: 0, found: 0, lines: 0 };
        totals[h].shorted += Number(v.shorted ?? 0);
        totals[h].found += Number(v.found ?? 0);
        totals[h].lines += Number(v.lines ?? 0);
      });
    });
    const grandTotal = Object.values(totals).reduce(
      (a, v) => a + v.shorted,
      0,
    );
    return {
      entries: Object.entries(totals).sort(
        ([, a], [, b]) => b.shorted - a.shorted,
      ),
      grandTotal,
    };
  })();

  /* ---- generate report ---- */
  const handleRun = useCallback(async () => {
    if (!file) {
      log("No file selected – please upload an Excel file first.", "error");
      return;
    }
    log("Starting analysis...");
    startTimer();
    setIndicator("processing...");

    try {
      const ExcelJS = (await import("exceljs")).default;
      const buffer = await file.arrayBuffer();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const ws = wb.worksheets[0];

      const colIndices: Record<string, number> = {};
      ws.getRow(1).eachCell((c, i) => {
        const v = String(c.value ?? "")
          .trim()
          .toLowerCase();
        COL_MAP.forEach((m) => {
          if (v === m.in.toLowerCase()) colIndices[m.out] = i;
        });
      });

      const allData: Record<string, unknown>[] = [];
      ws.eachRow((row, rn) => {
        if (rn === 1) return;
        const obj: Record<string, unknown> = {};
        let hasData = false;
        COL_MAP.forEach((m) => {
          const idx = colIndices[m.out];
          obj[m.out] = idx ? row.getCell(idx).value : null;
          if (obj[m.out] != null) hasData = true;
        });
        if (!hasData) return;
        const slot = String(obj.Slot ?? "").toUpperCase();
        if (slot && !SLOT_BLACKLIST.some((b) => slot.includes(b)))
          allData.push(obj);
      });
      log(`Processed ${allData.length} valid rows`);

      const markoutsExcludedData = allData.filter(
        (r) =>
          r["Qty Found"] != null &&
          String(r["Qty Found"]).trim() !== "",
      );

      const itemCounts: Record<string, number> = {};
      const itemSlots: Record<string, unknown> = {};
      markoutsExcludedData.forEach((r) => {
        const item = r.Item as string;
        if (!item) return;
        itemCounts[item] = (itemCounts[item] ?? 0) + 1;
        itemSlots[item] = r.Slot;
      });
      const freqBins: Record<string, number> = {
        "2": 0,
        "3": 0,
        "4": 0,
        "5": 0,
        ">5": 0,
      };
      Object.values(itemCounts).forEach((c) => {
        if (c === 2) freqBins["2"]++;
        else if (c === 3) freqBins["3"]++;
        else if (c === 4) freqBins["4"]++;
        else if (c === 5) freqBins["5"]++;
        else if (c > 5) freqBins[">5"]++;
      });

      const hourlyGroups: Record<string, Record<string, unknown>[]> = {};
      allData.forEach((r) => {
        let label = "Unknown Time";
        const tsVal = r.Shorted;
        if (tsVal) {
          try {
            const d = new Date(tsVal as string);
            if (!isNaN(d.getTime())) label = hourLabel(d);
          } catch {
            /* ignore */
          }
        }
        if (!hourlyGroups[label]) hourlyGroups[label] = [];
        hourlyGroups[label].push(r);
      });

      const sortedHours = sortHourKeys(Object.keys(hourlyGroups));

      const hourlySummary: HourlyMap = {};
      let grandShorted = 0;
      let grandFound = 0;
      let grandLines = 0;
      sortedHours.forEach((k) => {
        const rows = hourlyGroups[k];
        let s = 0;
        let f = 0;
        rows.forEach((r) => {
          s += parseFloat(String(r["Orig Short"] ?? 0));
          f += parseFloat(String(r["Qty Found"] ?? 0));
        });
        hourlySummary[k] = { shorted: s, found: f, lines: rows.length };
        grandShorted += s;
        grandFound += f;
        grandLines += rows.length;
      });

      /* ---- save to supabase ---- */
      try {
        const { error } = await supabase.from("shorts_history").insert({
          report_date: new Date().toISOString(),
          filename: file.name,
          total_shorted: grandShorted,
          total_found: grandFound,
          total_lines: grandLines,
          bin2: freqBins["2"],
          bin3: freqBins["3"],
          bin4: freqBins["4"],
          bin5: freqBins["5"],
          bin5plus: freqBins[">5"],
          hourly: hourlySummary,
        });
        if (error) throw error;
        log("History saved to database", "success");
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "unknown error";
        log("Cannot save history: " + msg, "error");
      }

      /* ---- build output workbook ---- */
      const outWB = new ExcelJS.Workbook();
      const colsConfig = COL_MAP.map((m) => ({
        header: m.out,
        key: m.out,
        width: 18,
      }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const styleHeader = (sheet: any) => {
        const head = sheet.getRow(1);
        head.eachCell((cell: any) => {
          cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF4472C4" },
          };
          cell.alignment = { horizontal: "center", vertical: "middle" };
          cell.border = {
            top: { style: "thin" },
            left: { style: "thin" },
            bottom: { style: "thin" },
            right: { style: "thin" },
          };
        });
        sheet.autoFilter = {
          from: "A1",
          to: `${String.fromCharCode(65 + colsConfig.length - 1)}1`,
        };
      };

      const addRawSheet = (
        name: string,
        rows: Record<string, unknown>[],
      ) => {
        const sheet = outWB.addWorksheet(name);
        sheet.columns = colsConfig;
        sheet.addRows(rows);
        styleHeader(sheet);
        sheet.eachRow((r, i) => {
          if (i > 1)
            r.eachCell((c) => {
              c.border = {
                top: { style: "thin" },
                left: { style: "thin" },
                bottom: { style: "thin" },
                right: { style: "thin" },
              };
              c.alignment = { horizontal: "center", vertical: "middle" };
            });
        });
        sheet.columns.forEach((col) => {
          let max = 10;
          col.eachCell?.({ includeEmpty: true }, (cell) => {
            const len = String(cell.value ?? "").length;
            if (len > max) max = len;
          });
          col.width = Math.min(max + 3, 50);
        });
        return sheet;
      };

      addRawSheet("Summary", allData);
      addRawSheet("Summary Markouts Excluded", markoutsExcludedData);

      /* Pivot Table Duplicates sheet */
      const pSheet = outWB.addWorksheet("Pivot Table Duplicates");
      pSheet.getCell("A1").value = "Item";
      pSheet.getCell("B1").value = "Slot";
      pSheet.getCell("C1").value = "Count of Item";
      pSheet.getCell("F1").value = "2 Times";
      pSheet.getCell("G1").value = "3 Times";
      pSheet.getCell("H1").value = "4 Times";
      pSheet.getCell("I1").value = "5 Times";
      pSheet.getCell("J1").value = ">5 Times";
      ["A", "B", "C", "F", "G", "H", "I", "J"].forEach((col) => {
        const cell = pSheet.getCell(`${col}1`);
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFED7D31" },
        };
        cell.alignment = { horizontal: "center", vertical: "middle" };
      });
      pSheet.getCell("F2").value = freqBins["2"];
      pSheet.getCell("G2").value = freqBins["3"];
      pSheet.getCell("H2").value = freqBins["4"];
      pSheet.getCell("I2").value = freqBins["5"];
      pSheet.getCell("J2").value = freqBins[">5"];

      const pivotList = Object.entries(itemCounts)
        .map(([item, count]) => ({
          item,
          slot: itemSlots[item],
          count,
        }))
        .sort((a, b) => b.count - a.count);

      pivotList.forEach((p, i) => {
        const r = i + 2;
        pSheet.getCell(`A${r}`).value = p.item;
        pSheet.getCell(`B${r}`).value = p.slot as string;
        pSheet.getCell(`C${r}`).value = p.count;
      });
      pSheet.getColumn(1).width = 20;
      pSheet.getColumn(2).width = 20;
      pSheet.getColumn(3).width = 15;
      [6, 7, 8, 9, 10].forEach((n) => (pSheet.getColumn(n).width = 12));

      /* Hourly sheets */
      sortedHours.forEach((hKey) => {
        const hRows = [...hourlyGroups[hKey]].sort(
          (a, b) =>
            new Date(a.Shorted as string).getTime() -
            new Date(b.Shorted as string).getTime(),
        );
        const sheet = addRawSheet(hKey, hRows);

        sheet.getCell("K1").value = "Row Labels";
        sheet.getCell("L1").value = "Sum of Orig Short";
        sheet.getCell("M1").value = "Sum of Qty Found";
        ["K", "L", "M"].forEach((c) => {
          const cell = sheet.getCell(`${c}1`);
          cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF4472C4" },
          };
          cell.alignment = { horizontal: "center", vertical: "middle" };
        });

        const slotMap: Record<string, { orig: number; found: number }> = {};
        hRows.forEach((row) => {
          const s = (row.Slot as string) || "(Blank)";
          slotMap[s] = slotMap[s] ?? { orig: 0, found: 0 };
          slotMap[s].orig += parseFloat(String(row["Orig Short"] ?? 0));
          slotMap[s].found += parseFloat(String(row["Qty Found"] ?? 0));
        });

        let rIdx = 2;
        Object.keys(slotMap)
          .sort()
          .forEach((slot) => {
            sheet.getCell(`K${rIdx}`).value = slot;
            sheet.getCell(`L${rIdx}`).value = slotMap[slot].orig;
            sheet.getCell(`M${rIdx}`).value = slotMap[slot].found;
            rIdx++;
          });

        sheet.getCell(`K${rIdx}`).value = "Grand Total";
        sheet.getCell(`K${rIdx}`).font = { bold: true };
        sheet.getCell(`L${rIdx}`).value = Object.values(slotMap).reduce(
          (a, b) => a + b.orig,
          0,
        );
        sheet.getCell(`L${rIdx}`).font = { bold: true };
        sheet.getCell(`M${rIdx}`).value = Object.values(slotMap).reduce(
          (a, b) => a + b.found,
          0,
        );
        sheet.getCell(`M${rIdx}`).font = { bold: true };

        sheet.getColumn(10).width = 2;
        sheet.getColumn(11).width = 20;
        sheet.getColumn(12).width = 18;
        sheet.getColumn(13).width = 18;
      });

      /* Shorted vs Found sheet */
      const totalsSheet = outWB.addWorksheet("Shorted vs Found");
      totalsSheet.columns = [
        { header: "Hour", key: "hour", width: 15 },
        { header: "QTY Shorted", key: "qtyShorted", width: 15 },
        { header: "Qty Found", key: "qtyFound", width: 15 },
        { header: "Total Lines", key: "totalLines", width: 15 },
      ];
      const tHead = totalsSheet.getRow(1);
      tHead.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF4472C4" },
        };
        cell.alignment = { horizontal: "center", vertical: "middle" };
      });

      let gShorted = 0;
      let gFound = 0;
      let gLines = 0;
      sortedHours.forEach((hKey) => {
        const rows = hourlyGroups[hKey];
        let hS = 0;
        let hF = 0;
        rows.forEach((r) => {
          hS += parseFloat(String(r["Orig Short"] ?? 0));
          hF += parseFloat(String(r["Qty Found"] ?? 0));
        });
        totalsSheet.addRow({
          hour: hKey,
          qtyShorted: hS,
          qtyFound: hF,
          totalLines: rows.length,
        });
        gShorted += hS;
        gFound += hF;
        gLines += rows.length;
      });
      const totalRow = totalsSheet.addRow({
        hour: "Grand Total",
        qtyShorted: gShorted,
        qtyFound: gFound,
        totalLines: gLines,
      });
      totalRow.font = { bold: true };

      /* ---- download ---- */
      const bufferOut = await outWB.xlsx.writeBuffer();
      const blob = new Blob([bufferOut], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const today = new Date();
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      const fName = `Shorts_${dateStr}.xlsx`;
      const a = document.createElement("a");
      a.href = url;
      a.download = fName;
      a.click();
      URL.revokeObjectURL(url);

      stopTimer();
      log(`Report generated: ${fName}`, "success");
      setIndicator("idle");
    } catch (err: unknown) {
      stopTimer();
      const msg = err instanceof Error ? err.message : String(err);
      log(`Error: ${msg}`, "error");
      setIndicator("error");
    }
  }, [file, log, startTimer, stopTimer]);

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  const timerColor = running
    ? "text-sky-400"
    : timerDone
      ? "text-emerald-400"
      : "text-slate-300";

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 sm:p-6"
      style={{
        background: "linear-gradient(135deg, #0f172a 0%, #0b1120 100%)",
      }}
    >
      <div className="w-full max-w-7xl rounded-3xl p-6 sm:p-8 shadow-2xl bg-slate-900/75 backdrop-blur-2xl border border-slate-700/30">
        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-6 border-b border-slate-700 pb-6 gap-4">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-white mb-1">
              SHORTS<span className="text-sky-400">TOOL</span>
            </h1>
            <p className="text-slate-400 text-xs font-bold tracking-widest uppercase">
              By: Shane Cloonan
            </p>
          </div>
          <div className="hidden sm:flex flex-col items-end">
            <span className="text-[10px] text-emerald-500 font-mono font-bold tracking-widest uppercase mb-1 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              System Ready
            </span>
            <div className={`text-5xl font-black tracking-tight tabular-nums ${timerColor}`}>
              {elapsed.toFixed(2)}
              <span className="text-lg text-slate-500 ml-1 font-medium">s</span>
            </div>
          </div>
        </div>

        {/* ── Two-column grid ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* LEFT: drop zone + button */}
          <div className="flex flex-col gap-4" style={{ minHeight: 520 }}>
            {/* Drop zone */}
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragEnter={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setDragging(false);
              }}
              onDrop={onDrop}
              className={`flex-1 rounded-2xl flex flex-col items-center justify-center cursor-pointer group transition-all p-6 border-2 border-dashed ${
                dragging
                  ? "border-emerald-400 bg-emerald-400/[0.08] scale-[0.985] shadow-[0_0_40px_rgba(52,211,153,0.25)]"
                  : "border-slate-600/60 bg-slate-900/35 hover:border-sky-400 hover:bg-sky-400/[0.05] hover:shadow-[0_0_30px_rgba(56,189,248,0.15)]"
              }`}
            >
              <svg
                className="w-16 h-16 mx-auto text-gray-500 mb-4 group-hover:text-sky-400 transition-colors"
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
              <h3 className="text-2xl font-bold text-white mb-2 pointer-events-none">
                {file ? file.name : "Drop Excel File Here"}
              </h3>
              <p
                className={`text-sm pointer-events-none ${file ? "text-emerald-400 font-medium" : "text-slate-400"}`}
              >
                {file ? "Ready – click GENERATE REPORT" : ".xlsx"}
              </p>
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
              className="h-20 rounded-xl text-white font-black text-xl tracking-widest flex items-center justify-center gap-3 transition-all bg-gradient-to-r from-sky-500 to-sky-600 shadow-[0_6px_20px_rgba(56,189,248,0.35)] hover:shadow-[0_10px_30px_rgba(56,189,248,0.55)] hover:-translate-y-0.5"
            >
              <span>GENERATE REPORT</span>
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </button>
          </div>

          {/* RIGHT: console / history */}
          <div className="bg-[#0b1120] rounded-2xl border border-slate-800/50 shadow-inner overflow-hidden flex flex-col min-h-[520px]">
            {/* Window dots */}
            <div className="bg-gradient-to-r from-slate-950 to-slate-900 px-4 py-2.5 flex items-center border-b border-slate-700/70">
              <div className="flex gap-2.5">
                <div className="w-3.5 h-3.5 rounded-full bg-red-600/40 border border-red-500/40" />
                <div className="w-3.5 h-3.5 rounded-full bg-yellow-500/40 border border-yellow-500/40" />
                <div className="w-3.5 h-3.5 rounded-full bg-emerald-500/40 border border-emerald-500/40" />
              </div>
            </div>

            {/* Tabs */}
            <div className="grid grid-cols-2 border-b border-slate-700/70 bg-gradient-to-r from-slate-950 to-slate-900">
              {(["console", "history"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`py-3.5 text-sm font-semibold uppercase tracking-wider transition-all border-b-[3px] ${
                    tab === t
                      ? "text-sky-400 border-sky-400 bg-sky-400/[0.08]"
                      : "text-slate-300 border-transparent hover:text-white hover:bg-white/[0.04]"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* ── Console tab ── */}
            {tab === "console" && (
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Mobile timer */}
                <div className="sm:hidden flex flex-col items-end p-4 border-b border-slate-700/70">
                  <span className="text-[10px] text-emerald-500 font-mono font-bold tracking-widest uppercase mb-1 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    System Ready
                  </span>
                  <div className={`text-4xl font-black tracking-tight tabular-nums ${timerColor}`}>
                    {elapsed.toFixed(2)}
                    <span className="text-base text-slate-500 ml-1 font-medium">
                      s
                    </span>
                  </div>
                </div>
                <div
                  ref={logBoxRef}
                  className="flex-1 overflow-y-auto p-5 font-mono text-sm text-slate-300 space-y-2"
                >
                  {logs.map((l, i) => {
                    const color =
                      l.type === "success"
                        ? "text-emerald-400"
                        : l.type === "error"
                          ? "text-red-400"
                          : "text-slate-300";
                    const border =
                      l.type === "success"
                        ? "#34d399"
                        : l.type === "error"
                          ? "#f87171"
                          : "transparent";
                    const prefix =
                      l.type === "success"
                        ? "OKAY"
                        : l.type === "error"
                          ? "FAIL"
                          : "INFO";
                    return (
                      <div
                        key={i}
                        className="py-1.5 pl-3.5"
                        style={{ borderLeft: `3px solid ${border}` }}
                      >
                        <span className="text-slate-600 mr-2">[{l.time}]</span>
                        <span className="font-bold mr-2 text-xs opacity-70">
                          {prefix}
                        </span>
                        <span className={color}>{l.msg}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="p-3 px-5 bg-slate-950/70 text-sm text-red-400 font-mono border-t border-slate-700/70 flex items-center shrink-0">
                  <span className="mr-2.5">➜</span>
                  <span className="animate-pulse">{indicator}</span>
                </div>
              </div>
            )}

            {/* ── History tab ── */}
            {tab === "history" && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="bg-gradient-to-b from-slate-950/90 to-slate-900/80 p-5 border-b border-slate-700/60 shrink-0">
                  {/* Filters */}
                  <div className="flex flex-wrap gap-2.5 justify-center mb-5">
                    {(
                      ["all", "week", "month", "3m", "6m", "year"] as const
                    ).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setFilterRange(r)}
                        className={`text-xs font-medium px-4 py-2 rounded-lg transition-all ${
                          filterRange === r
                            ? "bg-sky-400 text-white shadow-[0_0_12px_rgba(56,189,248,0.4)]"
                            : "bg-slate-800/80 hover:bg-slate-700/90 text-slate-300"
                        }`}
                      >
                        {r === "all"
                          ? "All"
                          : r === "week"
                            ? "Week"
                            : r === "month"
                              ? "Month"
                              : r === "3m"
                                ? "3mo"
                                : r === "6m"
                                  ? "6mo"
                                  : "Year"}
                      </button>
                    ))}
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 text-center mb-6">
                    {[
                      { label: "Total Reports", value: cnt || "—" },
                      {
                        label: "Total Shorted",
                        value: cnt ? sumShort.toFixed(0) : "—",
                      },
                      {
                        label: "Total Found",
                        value: cnt ? sumFound.toFixed(0) : "—",
                      },
                      {
                        label: "Avg Shorted",
                        value: cnt ? (sumShort / cnt).toFixed(1) : "—",
                      },
                      {
                        label: "Avg Found",
                        value: cnt ? (sumFound / cnt).toFixed(1) : "—",
                      },
                      {
                        label: "Total Lines",
                        value: cnt ? sumLines.toFixed(0) : "—",
                      },
                      {
                        label: "Avg Lines",
                        value: cnt ? (sumLines / cnt).toFixed(1) : "—",
                      },
                    ].map((s) => (
                      <div
                        key={s.label}
                        className="bg-slate-800/60 p-2 rounded-xl shadow-inner border border-slate-700/40"
                      >
                        <div className="text-slate-400 text-[10px] uppercase tracking-widest mb-0.5">
                          {s.label}
                        </div>
                        <div className="text-base font-black text-white">
                          {s.value}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Section toggles */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {[
                      { id: "averages", label: "Hourly Averages", color: "text-sky-300" },
                      { id: "totals", label: "Hourly Totals", color: "text-sky-300" },
                      { id: "daily", label: "Daily Reports", color: "text-purple-300" },
                    ].map((sec) => (
                      <button
                        key={sec.id}
                        type="button"
                        onClick={() =>
                          setExpandedSection(
                            expandedSection === sec.id ? null : sec.id,
                          )
                        }
                        className={`bg-gradient-to-br from-slate-900 to-slate-800 hover:from-slate-800 hover:to-slate-700 p-4 rounded-xl ${sec.color} font-semibold transition-all flex items-center justify-between shadow-lg border border-slate-700/50`}
                      >
                        <span className="text-base">{sec.label}</span>
                        <span
                          className={`text-lg transition-transform ${expandedSection === sec.id ? "rotate-180" : ""}`}
                        >
                          ▼
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* ── Hourly Averages ── */}
                {expandedSection === "averages" && (
                  <div className="bg-gradient-to-b from-slate-950/90 to-slate-900/80 border-b border-slate-700/60 p-5 overflow-auto max-h-80">
                    <h4 className="text-sky-300 font-bold uppercase tracking-wider mb-4 text-center text-sm">
                      (highest → lowest average shorts)
                    </h4>
                    <div className="overflow-x-auto rounded-xl border border-slate-700/50 shadow-inner bg-slate-950/40">
                      <table className="w-full text-sm text-left border-collapse">
                        <thead className="bg-slate-900/80 sticky top-0 z-10">
                          <tr>
                            <th className="p-3 border-b border-slate-700/70">
                              Hour
                            </th>
                            <th className="p-3 text-center border-b border-slate-700/70">
                              Avg Short
                            </th>
                            <th className="p-3 text-center border-b border-slate-700/70">
                              Avg Found
                            </th>
                            <th className="p-3 text-center border-b border-slate-700/70">
                              Avg Lines
                            </th>
                            <th className="p-3 text-center border-b border-slate-700/70">
                              Count
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-700/50">
                          {hourlyAvgData.length === 0 ? (
                            <tr>
                              <td
                                colSpan={5}
                                className="text-center py-8 text-slate-600"
                              >
                                No data
                              </td>
                            </tr>
                          ) : (
                            hourlyAvgData.map(([hour, data]) => (
                              <tr
                                key={hour}
                                className="hover:bg-slate-800/40 transition-colors"
                              >
                                <td className="p-3">{hour}</td>
                                <td className="p-3 text-center text-sky-300">
                                  {(data.shorted / data.count).toFixed(1)}
                                </td>
                                <td className="p-3 text-center text-emerald-300">
                                  {(data.found / data.count).toFixed(1)}
                                </td>
                                <td className="p-3 text-center text-sky-300">
                                  {(data.lines / data.count).toFixed(1)}
                                </td>
                                <td className="p-3 text-center">
                                  {data.count}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* ── Hourly Totals ── */}
                {expandedSection === "totals" && (
                  <div className="bg-gradient-to-b from-slate-950/90 to-slate-900/80 border-b border-slate-700/60 p-5 overflow-auto max-h-80">
                    <h4 className="text-sky-400 font-bold uppercase tracking-wider mb-4 text-center text-sm">
                      (highest → lowest)
                    </h4>
                    <div className="space-y-4">
                      {hourlyTotalsData.entries.length === 0 ? (
                        <div className="text-slate-600 text-center py-8 text-sm">
                          No data
                        </div>
                      ) : (
                        hourlyTotalsData.entries.map(([hour, data]) => {
                          const pct = hourlyTotalsData.grandTotal
                            ? (
                                (data.shorted / hourlyTotalsData.grandTotal) *
                                100
                              ).toFixed(0)
                            : "0";
                          return (
                            <div
                              key={hour}
                              className="bg-slate-900/60 p-4 rounded-xl border border-slate-700/50 shadow-inner"
                            >
                              <div className="flex justify-between items-center mb-3">
                                <span className="font-semibold text-slate-100">
                                  {hour}
                                </span>
                                <span className="text-sky-400 font-bold text-lg">
                                  {data.shorted.toFixed(0)}
                                </span>
                              </div>
                              <div className="grid grid-cols-3 gap-4 text-sm text-center">
                                <div>
                                  <div className="text-slate-400 text-xs uppercase mb-1">
                                    Found
                                  </div>
                                  <div className="text-emerald-400 font-semibold">
                                    {data.found.toFixed(0)}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-slate-400 text-xs uppercase mb-1">
                                    Lines
                                  </div>
                                  <div className="text-white font-semibold">
                                    {data.lines}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-slate-400 text-xs uppercase mb-1">
                                    Share
                                  </div>
                                  <div className="mt-2 h-3 bg-slate-800 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-gradient-to-r from-sky-600 to-sky-700 transition-all duration-500"
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}

                {/* ── Daily Reports ── */}
                {expandedSection === "daily" && (
                  <div className="bg-gradient-to-b from-slate-950/90 to-slate-900/80 p-5 overflow-auto max-h-[500px]">
                    <h4 className="text-purple-300 font-bold uppercase tracking-wider mb-4 text-center text-sm">
                      (newest → oldest)
                    </h4>
                    {filtered.length === 0 ? (
                      <div className="text-slate-600 text-center py-20 italic">
                        No reports in selected range
                      </div>
                    ) : (
                      <div className="space-y-5">
                        {[...filtered].reverse().map((r, idx) => {
                          const dayOpen = expandedDays.has(idx);
                          return (
                            <div
                              key={r.id ?? idx}
                              className="p-5 border border-slate-700/50 rounded-xl bg-gradient-to-b from-slate-900/80 to-slate-950/80 shadow-lg"
                            >
                              <div className="flex justify-between items-center mb-4">
                                <div>
                                  <div className="text-sm text-slate-400">
                                    {new Date(r.report_date).toLocaleString(
                                      [],
                                      {
                                        month: "short",
                                        day: "numeric",
                                        year: "numeric",
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      },
                                    )}
                                  </div>
                                  <div className="text-base font-semibold text-slate-100 truncate max-w-[280px]">
                                    {r.filename}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setExpandedDays((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(idx)) next.delete(idx);
                                      else next.add(idx);
                                      return next;
                                    });
                                  }}
                                  className="bg-gradient-to-r from-sky-900/60 to-sky-800/60 hover:from-sky-800/70 hover:to-sky-700/70 text-sky-200 px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 shadow-md"
                                >
                                  Hours {dayOpen ? "▲" : "▼"}
                                </button>
                              </div>
                              <div className="grid grid-cols-3 gap-4 text-sm mb-4">
                                <div className="bg-slate-800/50 p-3 rounded-lg text-center border border-slate-700/40">
                                  <div className="text-slate-400 text-xs uppercase mb-1">
                                    Shorted
                                  </div>
                                  <div className="font-bold text-sky-400 text-xl">
                                    {(r.total_shorted ?? 0).toFixed(0)}
                                  </div>
                                </div>
                                <div className="bg-slate-800/50 p-3 rounded-lg text-center border border-slate-700/40">
                                  <div className="text-slate-400 text-xs uppercase mb-1">
                                    Found
                                  </div>
                                  <div className="font-bold text-emerald-400 text-xl">
                                    {(r.total_found ?? 0).toFixed(0)}
                                  </div>
                                </div>
                                <div className="bg-slate-800/50 p-3 rounded-lg text-center border border-slate-700/40">
                                  <div className="text-slate-400 text-xs uppercase mb-1">
                                    Lines
                                  </div>
                                  <div className="font-bold text-white text-xl">
                                    {r.total_lines ?? 0}
                                  </div>
                                </div>
                              </div>
                              <div className="grid grid-cols-5 gap-2 text-xs text-center mb-4">
                                {[
                                  { label: "2×", val: r.bin2 },
                                  { label: "3×", val: r.bin3 },
                                  { label: "4×", val: r.bin4 },
                                  { label: "5×", val: r.bin5 },
                                  { label: ">5×", val: r.bin5plus },
                                ].map((b) => (
                                  <div
                                    key={b.label}
                                    className={`bg-slate-900/60 p-2 rounded ${(b.val ?? 0) > 0 ? "border border-sky-600/40" : ""}`}
                                  >
                                    {b.label}{" "}
                                    <b>{b.val ?? 0}</b>
                                  </div>
                                ))}
                              </div>
                              {dayOpen && r.hourly && (
                                <div className="mt-5 bg-slate-950/90 p-4 rounded-xl border border-slate-700/50">
                                  <h5 className="text-sky-300 font-semibold mb-3 pb-2 border-b border-slate-700/60">
                                    Hourly Breakdown – {r.filename}
                                  </h5>
                                  {Object.entries(r.hourly)
                                    .sort(
                                      ([, a], [, b]) =>
                                        (b.lines ?? 0) - (a.lines ?? 0),
                                    )
                                    .map(([h, v]) => (
                                      <div
                                        key={h}
                                        className="flex justify-between items-center py-2.5 border-b border-slate-800/70 last:border-b-0 hover:bg-slate-900/40 transition-colors"
                                      >
                                        <span className="font-medium text-slate-100">
                                          {h}
                                        </span>
                                        <div className="flex gap-8 text-sm">
                                          <span className="text-sky-400">
                                            {(v.shorted ?? 0).toFixed(0)}
                                          </span>
                                          <span className="text-emerald-400">
                                            {(v.found ?? 0).toFixed(0)}
                                          </span>
                                          <span className="text-white">
                                            {v.lines ?? 0}
                                          </span>
                                        </div>
                                      </div>
                                    ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
