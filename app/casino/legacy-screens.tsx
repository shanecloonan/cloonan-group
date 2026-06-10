"use client";

import { useEffect } from "react";

/* ===========================================================================
 *  Legacy full-screen "easter egg" overlays for the blackjack table.
 *
 *  These are pixel-faithful HTML/CSS recreations of two pieces of software
 *  used at Greco & Sons:
 *    - BfcScreen   → "BFCDakota - Syntrax Telnet" 5250 green-screen
 *                    (PO Receiving / List Display)
 *    - EntreeScreen → "entrée by NECS" food-distributor app home screen
 *
 *  Each renders as a fixed, full-viewport overlay that completely covers the
 *  game, with a small × in the top-right corner (the window's close button)
 *  to dismiss. Esc also closes.
 * ========================================================================= */

function useEscToClose(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
}

/* ---------- Shared fake window chrome ---------- */

function WindowControls({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center gap-0 select-none">
      <button
        type="button"
        tabIndex={-1}
        className="w-[46px] h-[26px] flex items-center justify-center text-black/70 hover:bg-black/10 transition-colors text-[13px] cursor-default"
      >
        &#x2013;
      </button>
      <button
        type="button"
        tabIndex={-1}
        className="w-[46px] h-[26px] flex items-center justify-center text-black/70 hover:bg-black/10 transition-colors text-[11px] cursor-default"
      >
        &#x25A1;
      </button>
      {/* Functional close button — small × in the top-right */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="w-[46px] h-[26px] flex items-center justify-center text-black/80 hover:bg-[#e81123] hover:text-white transition-colors text-[15px] cursor-pointer"
      >
        &#x2715;
      </button>
    </div>
  );
}

/* ===========================================================================
 *  BFC — Syntrax Telnet 5250 green screen
 * ========================================================================= */

const PO_ROWS: { po: string; name: string; date: string; status: string }[] = [
  { po: "662596", name: "BELLISSIMO/SANDERSON", date: "061026", status: "Open" },
  { po: "662597", name: "TYSON FOODS,INC. FRE", date: "060826", status: "Open" },
  { po: "662598", name: "KOCH-GEORGIA CAGLES", date: "061026", status: "Open" },
  { po: "662599", name: "NEW S.B.L.", date: "061126", status: "Open" },
  { po: "662603", name: "KOCH-MISSISSIPPI", date: "061026", status: "Open" },
  { po: "662606", name: "KOCH POULTRY CO.,INC", date: "061026", status: "Open" },
  { po: "662608", name: "KOCH POULTRY CO.,INC", date: "061126", status: "Open" },
  { po: "662624", name: "CHEESE MERCHANTS OF", date: "061026", status: "Open" },
  { po: "662626", name: "CHEESE MERCHANTS OF", date: "061126", status: "Open" },
  { po: "662638", name: "CHEESE MERCHANTS OF", date: "061026", status: "Open" },
];

const TOOLBAR_BTNS = [
  "Sys\nReq",
  "Attn",
  "Roll\nUp",
  "Roll\nDwn",
  "Erase",
  "Clear",
  "PA1",
  "PA2",
  "PA3",
  "Print",
  "Help",
];

export function BfcScreen({ onClose }: { onClose: () => void }) {
  useEscToClose(onClose);
  return (
    <div className="fixed inset-0 z-[120] bg-[#0b0d10] flex flex-col font-sans">
      {/* Title bar */}
      <div className="flex items-center justify-between bg-gradient-to-b from-[#f4f4f4] to-[#dcdcdc] border-b border-[#b5b5b5] h-[26px] pl-2">
        <div className="flex items-center gap-1.5 text-[12px] text-black/80">
          <span className="inline-block w-3.5 h-3.5 rounded-[2px] bg-gradient-to-br from-sky-400 to-blue-700" />
          <span>BFCDakota - Syntrax Telnet</span>
        </div>
        <WindowControls onClose={onClose} />
      </div>

      {/* Menu bar */}
      <div className="flex items-center justify-between bg-[#ece9d8] border-b border-[#c8c4ad] h-[24px] px-2 text-[12px] text-black/85">
        <div className="flex items-center gap-3">
          <span>File</span>
          <span>Edit</span>
          <span>View</span>
          <span>Connection</span>
          <span>Parameters</span>
          <span>?</span>
        </div>
        <div className="flex items-center gap-1 pr-1">
          <span className="inline-block w-4 h-4 rounded-full bg-gradient-to-br from-sky-300 to-blue-600" />
          <span className="inline-block w-4 h-4 rounded-[2px] bg-gradient-to-br from-rose-500 to-red-700 text-white text-[10px] leading-4 text-center font-bold">
            ?
          </span>
        </div>
      </div>

      {/* Body: left toolbar + terminal */}
      <div className="flex flex-1 min-h-0">
        {/* Left toolbar */}
        <div className="w-[44px] bg-[#d4d0c8] border-r border-[#9d9d9d] flex flex-col items-center gap-[3px] py-2">
          <div className="w-[34px] h-[20px] rounded-[2px] bg-gradient-to-b from-[#fafafa] to-[#cfcfcf] border border-[#9d9d9d] flex items-center justify-center mb-1">
            <span className="w-3 h-3 rounded-[1px] bg-rose-600" />
          </div>
          {TOOLBAR_BTNS.map((b, i) => (
            <button
              key={i}
              type="button"
              tabIndex={-1}
              className="w-[34px] h-[26px] rounded-[2px] bg-gradient-to-b from-[#fafafa] to-[#cfcfcf] border border-[#9d9d9d] text-[8px] leading-[8px] text-black/80 whitespace-pre text-center flex items-center justify-center cursor-default hover:from-white"
            >
              {b}
            </button>
          ))}
        </div>

        {/* Terminal area */}
        <div className="relative flex-1 bg-black overflow-hidden">
          {/* faint globe watermark */}
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[340px] h-[340px] rounded-full opacity-[0.06]"
            style={{
              background:
                "radial-gradient(circle at 40% 35%, #bdbdbd 0%, #6b6b6b 40%, transparent 70%)",
            }}
          />
          <pre className="relative z-10 m-0 p-4 text-[clamp(10px,1.45vw,17px)] leading-[1.32] font-mono whitespace-pre tracking-tight">
            <span className="text-[#2fe23b] font-bold">  PO110A.01</span>
            {"                        "}
            <span className="text-white">PO Receiving</span>
            {"                      "}
            <span className="text-[#46d6e6]">6/10/26</span>
            {"\n"}
            {"                                "}
            <span className="text-white">List Display</span>
            {"\n\n"}
            <span className="text-[#2fe23b]">   1 - Greco and Sons Production</span>
            {"           "}
            <span className="text-[#2fe23b]">Change to warehouse . .</span>
            {"\n"}
            {"                                          "}
            <span className="text-[#2fe23b]">Position to PO  . . . . :</span>
            <span className="bg-white text-black"> </span>
            {"\n"}
            <span className="text-[#46d6e6]"> Type options, press Enter.</span>
            {"\n"}
            <span className="text-[#46d6e6]"> 2=Change   4=Delete   5=View   6=Receipt   8=Mark/export    9=Unmark 11=HACCP</span>
            {"\n"}
            <span className="text-[#46d6e6]">12=Work w/dtl 13=Work w/SuperPO 15=Lumper 16=Plt Est 17=Qty Diff U=Mark/upd</span>
            {"\n\n"}
            <span className="text-[#46d6e6]"> Opt   PO Number      Vendor  Name              Date   / Time  Status</span>
            {"\n"}
            {PO_ROWS.map((r) => {
              const nameCol = r.name.padEnd(20, " ");
              return (
                <span key={r.po}>
                  <span className="text-[#2fe23b]">      ___    {r.po}              {nameCol} {r.date} / 0000 {r.status}</span>
                  {"\n"}
                </span>
              );
            })}
            {"                                                                  "}
            <span className="text-white">More...</span>
            {"\n\n"}
            <span className="text-[#46d6e6]"> F3=Exit F4=Prompt F5=Refresh F7=Create Super PO    F23=more opts   F24=More keys</span>
          </pre>

          {/* bottom status bar */}
          <div className="absolute bottom-0 left-0 right-0 h-[22px] border-t border-[#2fe23b]/60 flex items-center justify-between px-3">
            <span className="inline-flex items-center justify-center w-6 h-3 border border-[#2fe23b]/70 text-[#2fe23b] text-[9px]">
              &#9993;
            </span>
            <span className="text-[#2fe23b] font-mono text-[12px]">05/071</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ===========================================================================
 *  Entrée — NECS food distributor app home screen
 * ========================================================================= */

function RibbonTab({ label, active }: { label: string; active?: boolean }) {
  return (
    <div
      className={
        "px-3 h-[22px] flex items-center text-[12px] " +
        (active
          ? "bg-white text-black border border-b-white border-[#d4d4d4] rounded-t-[3px] relative -mb-px"
          : "text-black/80")
      }
    >
      {label}
    </div>
  );
}

function RibbonGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-1.5 border-r border-[#d9d6c9] h-full justify-between">
      <div className="flex items-start gap-1 flex-1 pt-1">{children}</div>
      <div className="text-[10px] text-black/55 pb-0.5">{title}</div>
    </div>
  );
}

function RibbonItem({ label, big }: { label: string; big?: boolean }) {
  return (
    <div
      className={
        "flex items-center gap-1 px-1 rounded-[2px] hover:bg-[#fde8c8] hover:border hover:border-[#e0b87a] cursor-default " +
        (big ? "flex-col py-1 w-[52px] text-center" : "h-[20px]")
      }
    >
      <span
        className={
          "rounded-[2px] bg-gradient-to-br from-[#f0a23a] to-[#d4761f] " +
          (big ? "w-6 h-6" : "w-3.5 h-3.5")
        }
      />
      <span className="text-[11px] text-black/85 leading-tight whitespace-nowrap">
        {label}
      </span>
    </div>
  );
}

export function EntreeScreen({ onClose }: { onClose: () => void }) {
  useEscToClose(onClose);
  return (
    <div className="fixed inset-0 z-[120] bg-[#f1f0ec] flex flex-col font-sans overflow-hidden">
      {/* Title bar */}
      <div className="flex items-center justify-between bg-gradient-to-b from-[#f7f7f7] to-[#e4e4e4] border-b border-[#c4c4c4] h-[26px] pl-2">
        <div className="flex items-center gap-1.5 text-[12px] text-black/80">
          <span className="inline-block w-3.5 h-3.5 rounded-[2px] bg-gradient-to-br from-amber-400 to-red-600 text-white text-[8px] leading-[14px] text-center font-bold">
            V
          </span>
          <span className="italic">entrée</span>
        </div>
        <WindowControls onClose={onClose} />
      </div>

      {/* Ribbon tabs */}
      <div className="flex items-end gap-1 bg-[#e9e7dd] border-b border-[#cfccbd] px-2 pt-1 h-[26px]">
        <RibbonTab label="Inventory" />
        <RibbonTab label="Customer" active />
        <RibbonTab label="Vendor" />
        <RibbonTab label="Salesperson" />
        <RibbonTab label="Dashboards" />
        <RibbonTab label="System" />
        <RibbonTab label="Add-Ons" />
      </div>

      {/* Ribbon content */}
      <div className="flex items-stretch bg-gradient-to-b from-[#fbfaf6] to-[#ece9dd] border-b border-[#cfccbd] h-[78px] px-1 overflow-x-auto">
        <RibbonGroup title="Customer File">
          <RibbonItem label="Customer" big />
          <div className="flex flex-col gap-0.5 pt-1">
            <RibbonItem label="Contact" />
            <RibbonItem label="Comment" />
            <RibbonItem label="Maps Keywords" />
          </div>
          <div className="flex flex-col gap-0.5 pt-1">
            <RibbonItem label="Terms" />
          </div>
        </RibbonGroup>

        <RibbonGroup title="Sales Transactions">
          <RibbonItem label="Invoice" big />
          <div className="flex flex-col gap-0.5 pt-1">
            <RibbonItem label="Credit Memo" />
            <RibbonItem label="Sales Order" />
            <RibbonItem label="Quotation" />
          </div>
          <div className="flex flex-col gap-0.5 pt-1">
            <RibbonItem label="Assign Routes" />
            <RibbonItem label="Enter Weights" />
            <RibbonItem label="Route Documents" />
          </div>
          <div className="flex flex-col gap-0.5 pt-1">
            <RibbonItem label="Print" />
          </div>
        </RibbonGroup>

        <RibbonGroup title="A/R Transactions">
          <RibbonItem label="Cash Receipts" big />
          <div className="flex flex-col gap-0.5 pt-1">
            <RibbonItem label="Statements" />
            <RibbonItem label="Tools" />
          </div>
        </RibbonGroup>

        <RibbonGroup title="Customer Reports">
          <RibbonItem label="Sales" big />
          <div className="flex flex-col gap-0.5 pt-1">
            <RibbonItem label="Analytics" />
            <RibbonItem label="Shipping" />
            <RibbonItem label="File" />
          </div>
        </RibbonGroup>

        <RibbonGroup title="Customer Utilities">
          <RibbonItem label="Cost/Price" big />
          <div className="flex flex-col gap-0.5 pt-1">
            <RibbonItem label="Recalculate" />
            <RibbonItem label="Reassign" />
            <RibbonItem label="Purge Data" />
          </div>
        </RibbonGroup>
      </div>

      {/* Main canvas with red waves + logo + truck */}
      <div className="relative flex-1 bg-white min-h-0 overflow-hidden">
        {/* Red wave ribbon */}
        <svg
          className="absolute inset-0 w-full h-full"
          viewBox="0 0 1024 520"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden
        >
          <g fill="none" stroke="#e2242b" strokeOpacity="0.55" strokeWidth="1">
            {Array.from({ length: 46 }).map((_, i) => {
              const o = i * 4;
              return (
                <path
                  key={i}
                  d={`M -50 ${120 + o * 1.1} C 250 ${20 + o}, 480 ${340 + o * 0.4}, 760 ${180 + o * 0.7} S 1100 ${60 + o}, 1120 ${120 + o}`}
                />
              );
            })}
          </g>
        </svg>

        {/* Logo block */}
        <div className="absolute left-[8%] top-1/2 -translate-y-1/2 select-none">
          <div className="flex items-end gap-1">
            <span className="text-[64px] font-bold text-[#e2242b] leading-none">V4.8</span>
            <span className="text-[14px] font-semibold text-[#e2242b] mb-2 [writing-mode:vertical-rl] rotate-180">
              SQL
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[52px] italic font-semibold text-[#3a3a3a] leading-none">
              entrée
            </span>
            <span className="text-[#e2242b] text-[28px] leading-none">&#10003;</span>
          </div>
          <div className="text-[15px] tracking-[0.12em] text-[#4a4a4a] mt-1 font-semibold">
            SOFTWARE FOR <span className="text-[#e2242b]">FOOD DISTRIBUTORS</span>
          </div>
        </div>

        {/* Greco truck logo (approximate) */}
        <div className="absolute right-[8%] bottom-[14%] select-none">
          <div className="relative">
            {/* truck body */}
            <div className="w-[150px] h-[70px] bg-[#e2242b] rounded-md relative shadow-lg">
              <div className="absolute -left-1 top-3 w-9 h-[52px] bg-[#cf1f25] rounded-l-md" />
              <div className="absolute left-1 top-4 w-7 h-5 bg-sky-200/80 rounded-sm" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="bg-white rounded-full px-3 py-1 border-2 border-[#e2242b] -mt-1">
                  <div className="text-[#e2242b] font-bold italic text-[15px] leading-none">
                    Greco
                  </div>
                  <div className="text-[#e2242b] text-[6px] tracking-[0.3em] text-center leading-none">
                    AND SONS
                  </div>
                </div>
              </div>
            </div>
            {/* wheels */}
            <div className="absolute -bottom-2 left-6 w-6 h-6 rounded-full bg-stone-800 border-2 border-stone-500" />
            <div className="absolute -bottom-2 right-6 w-6 h-6 rounded-full bg-stone-800 border-2 border-stone-500" />
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div className="bg-[#e9e7dd] border-t border-[#cfccbd] text-[10px] text-black/70 px-2 py-0.5 flex items-center justify-between">
        <span>
          ...RY FILE ARE 03/31/2026 BACK. PLEASE WATCH YOU FILE SELECTION ON REPORTS***
        </span>
        <span>
          ***MTD OR CURRENT ENTREE FILES ARE 04/01/2026 FWD. YTD OR HIST...
        </span>
      </div>
      <div className="bg-[#dcdacb] border-t border-[#cfccbd] text-[11px] text-black/75 px-2 py-0.5 flex items-center justify-between">
        <span>Version 4.8.23.1</span>
        <span>Licensed to: GRECO &amp; SONS. INC.</span>
        <span>Wednesday, June 10, 2026</span>
        <span>User name: SCLOONAN | S6</span>
      </div>
    </div>
  );
}
