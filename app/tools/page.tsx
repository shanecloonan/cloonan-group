"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Rocket } from "lucide-react";

const TOOLS = [
  { name: "Shorts Tool", href: "/shorts", desc: "Excel-based shortage report generator" },
  { name: "Skip Tool", href: "/skips", desc: "Excel-based skip report generator & analytics" },
];

export default function ToolsPage() {
  const router = useRouter();
  const [selected, setSelected] = useState(0);
  const [open, setOpen] = useState(false);

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden">
      <div className="absolute inset-0 bg-brand-950" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(56,189,248,0.06),transparent)]" />

      <div
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(56,189,248,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,0.3) 1px, transparent 1px)",
          backgroundSize: "80px 80px",
        }}
      />

      <div className="relative z-10 w-full max-w-md px-6">
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-3 mb-6">
            <span className="h-px w-8 bg-sky-400/40" />
            <span className="text-[10px] sm:text-[11px] tracking-[0.3em] uppercase font-semibold text-sky-400/70">
              Internal
            </span>
            <span className="h-px w-8 bg-sky-400/40" />
          </div>
          <h1 className="font-heading text-4xl sm:text-5xl font-bold tracking-tight text-brand-100 mb-3">
            Greco <span className="text-sky-400">Tools</span>
          </h1>
          <p className="text-sm text-brand-500">
            Select a tool and launch.
          </p>
        </div>

        {/* Dropdown */}
        <div className="relative mb-4">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="w-full flex items-center justify-between bg-brand-900 border border-brand-700 hover:border-sky-400/40 rounded-lg px-5 py-4 text-left transition-colors"
          >
            <div>
              <div className="text-sm font-semibold text-brand-100">
                {TOOLS[selected].name}
              </div>
              <div className="text-xs text-brand-500 mt-0.5">
                {TOOLS[selected].desc}
              </div>
            </div>
            <ChevronDown
              className={`w-5 h-5 text-brand-400 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>

          {open && (
            <div className="absolute z-20 w-full mt-1 bg-brand-900 border border-brand-700 rounded-lg shadow-2xl overflow-hidden">
              {TOOLS.map((tool, i) => (
                <button
                  key={tool.href}
                  type="button"
                  onClick={() => {
                    setSelected(i);
                    setOpen(false);
                  }}
                  className={`w-full text-left px-5 py-3.5 transition-colors hover:bg-brand-800 ${
                    i === selected
                      ? "bg-sky-400/10 border-l-2 border-sky-400"
                      : "border-l-2 border-transparent"
                  }`}
                >
                  <div className="text-sm font-semibold text-brand-100">
                    {tool.name}
                  </div>
                  <div className="text-xs text-brand-500 mt-0.5">
                    {tool.desc}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Launch button */}
        <button
          type="button"
          onClick={() => router.push(TOOLS[selected].href)}
          className="w-full flex items-center justify-center gap-3 bg-sky-500 hover:bg-sky-400 text-white font-bold text-sm tracking-[0.1em] uppercase rounded-lg px-5 py-4 transition-all shadow-lg shadow-sky-500/25 hover:shadow-sky-400/35 hover:-translate-y-0.5"
        >
          <Rocket className="w-4 h-4" />
          Launch Tool
        </button>
      </div>

      <div className="absolute top-8 left-8 w-12 h-12 border-l border-t border-sky-400/10" />
      <div className="absolute top-8 right-8 w-12 h-12 border-r border-t border-sky-400/10" />
      <div className="absolute bottom-8 left-8 w-12 h-12 border-l border-b border-sky-400/10" />
      <div className="absolute bottom-8 right-8 w-12 h-12 border-r border-b border-sky-400/10" />
    </div>
  );
}
