"use client";

import { useId } from "react";

export default function MoneyFundLogo({
  className = "",
}: {
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const leafId = `leaf-${uid}`;

  const leaves: {
    x: number;
    y: number;
    rot: number;
    s: number;
    alt: boolean;
  }[] = [];

  for (let i = 0; i < 15; i++) {
    const t = i / 14;
    const offset = 20 + t * 140;
    const s = 0.9 + (1 - t) * 0.25;
    const alt = i % 2 === 0;

    for (const side of ["left", "right"] as const) {
      const angle = side === "left" ? 270 - offset : 270 + offset;
      const dir = side === "left" ? -60 : 60;
      const rad = (angle * Math.PI) / 180;
      leaves.push({
        x: Math.cos(rad) * 82,
        y: Math.sin(rad) * 82,
        rot: angle + dir,
        s,
        alt,
      });
    }
  }

  const veins = [
    [-10, -2.5, -7.5],
    [-10, 2.5, -7.5],
    [-8, -3.5, -5.5],
    [-8, 3.5, -5.5],
    [-6, -4, -3.5],
    [-6, 4, -3.5],
    [-4, -4, -1.5],
    [-4, 4, -1.5],
    [-2, -4, 0.5],
    [-2, 4, 0.5],
    [0, -4, 2.5],
    [0, 4, 2.5],
    [2, -3.5, 4.5],
    [2, 3.5, 4.5],
    [4, -3, 6.5],
    [4, 3, 6.5],
    [6, -2.5, 8.5],
    [6, 2.5, 8.5],
  ];

  return (
    <svg
      viewBox="0 0 260 260"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <g id={leafId}>
          <path d="M0,-12 C6,-8 6,8 0,12 C-6,8 -6,-8 0,-12Z" />
          <line
            x1="0"
            y1="-11"
            x2="0"
            y2="11"
            stroke="#355e44"
            strokeWidth="0.4"
          />
          {veins.map(([y1, x2, y2], j) => (
            <line
              key={j}
              x1="0"
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="#355e44"
              strokeWidth="0.25"
            />
          ))}
        </g>
      </defs>

      <circle cx="130" cy="130" r="105" fill="#0d2e2e" />
      <circle
        cx="130"
        cy="130"
        r="105"
        fill="none"
        stroke="var(--color-gold, #d4a843)"
        strokeWidth="1"
      />

      <g transform="translate(130 130) scale(1.05)">
        {leaves.map((l, i) => (
          <g
            key={i}
            transform={`translate(${l.x} ${l.y}) rotate(${l.rot}) scale(${l.s})`}
          >
            <use
              href={`#${leafId}`}
              fill={l.alt ? "#8bbf91" : "#6aa174"}
              stroke="#355e44"
              strokeWidth="0.8"
              opacity={0.95}
            />
          </g>
        ))}
      </g>

      <text
        x="130"
        y="130"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="120"
        fontWeight="700"
        fill="white"
        fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
        letterSpacing="1"
      >
        $
      </text>
    </svg>
  );
}
