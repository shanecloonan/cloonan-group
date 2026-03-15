"use client";

const RADIUS = 82;
const LEAVES_PER_SIDE = 15;
const START_OFFSET = 20;
const END_OFFSET = 160;

function generateLeaves() {
  const leaves: {
    side: "left" | "right";
    x: number;
    y: number;
    rot: number;
    size: number;
    alt: boolean;
  }[] = [];

  for (let i = 0; i < LEAVES_PER_SIDE; i++) {
    const t = i / (LEAVES_PER_SIDE - 1);
    const offset = START_OFFSET + t * (END_OFFSET - START_OFFSET);
    const size = 0.9 + (1 - t) * 0.25;
    const alt = i % 2 === 0;

    const leftAngle = 270 - offset;
    const leftRad = (leftAngle * Math.PI) / 180;
    leaves.push({
      side: "left",
      x: Math.cos(leftRad) * RADIUS,
      y: Math.sin(leftRad) * RADIUS,
      rot: leftAngle - 60,
      size,
      alt,
    });

    const rightAngle = 270 + offset;
    const rightRad = (rightAngle * Math.PI) / 180;
    leaves.push({
      side: "right",
      x: Math.cos(rightRad) * RADIUS,
      y: Math.sin(rightRad) * RADIUS,
      rot: rightAngle + 60,
      size,
      alt,
    });
  }
  return leaves;
}

const LEAVES = generateLeaves();

const LEAF_VEINS = [
  { y1: -10, x2: -2.5, y2: -7.5 },
  { y1: -10, x2: 2.5, y2: -7.5 },
  { y1: -8, x2: -3.5, y2: -5.5 },
  { y1: -8, x2: 3.5, y2: -5.5 },
  { y1: -6, x2: -4, y2: -3.5 },
  { y1: -6, x2: 4, y2: -3.5 },
  { y1: -4, x2: -4, y2: -1.5 },
  { y1: -4, x2: 4, y2: -1.5 },
  { y1: -2, x2: -4, y2: 0.5 },
  { y1: -2, x2: 4, y2: 0.5 },
  { y1: 0, x2: -4, y2: 2.5 },
  { y1: 0, x2: 4, y2: 2.5 },
  { y1: 2, x2: -3.5, y2: 4.5 },
  { y1: 2, x2: 3.5, y2: 4.5 },
  { y1: 4, x2: -3, y2: 6.5 },
  { y1: 4, x2: 3, y2: 6.5 },
  { y1: 6, x2: -2.5, y2: 8.5 },
  { y1: 6, x2: 2.5, y2: 8.5 },
];

export default function MoneyFundLogo({ className }: { className?: string }) {
  return (
    <div className={className} style={{ position: "relative", width: 220, height: 220 }}>
      {/* Inner circle */}
      <div
        style={{
          position: "absolute",
          width: 178,
          height: 178,
          backgroundColor: "#0c0a09",
          borderRadius: "50%",
          top: 21,
          left: 21,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          zIndex: 2,
        }}
      >
        <span
          style={{
            fontSize: 100,
            fontWeight: 700,
            color: "#ffffff",
            fontFamily: "'Poppins', Arial, Helvetica, sans-serif",
            zIndex: 4,
            pointerEvents: "none",
            letterSpacing: 1,
          }}
        >
          $
        </span>
      </div>

      {/* Gold ring */}
      <div
        style={{
          position: "absolute",
          width: 178,
          height: 178,
          borderRadius: "50%",
          top: 21,
          left: 21,
          boxSizing: "border-box",
          border: "1px solid #d4a843",
          zIndex: 3,
          pointerEvents: "none",
        }}
      />

      {/* Wreath SVG */}
      <div
        style={{
          position: "absolute",
          top: 21,
          left: 21,
          width: 178,
          height: 178,
          zIndex: 3,
          pointerEvents: "none",
        }}
      >
        <svg
          viewBox="0 0 200 200"
          xmlns="http://www.w3.org/2000/svg"
          style={{ width: "100%", height: "100%", overflow: "visible" }}
        >
          <defs>
            <g id="leafShape">
              <path d="M0,-12 C6,-8 6,8 0,12 C-6,8 -6,-8 0,-12 Z" />
              <line x1="0" y1="-11" x2="0" y2="11" stroke="#355e44" strokeWidth="0.4" />
              {LEAF_VEINS.map((v, i) => (
                <line
                  key={i}
                  x1="0"
                  y1={v.y1}
                  x2={v.x2}
                  y2={v.y2}
                  stroke="#355e44"
                  strokeWidth="0.25"
                />
              ))}
            </g>
          </defs>

          {/* Left leaves */}
          <g transform="translate(100 100)">
            {LEAVES.filter((l) => l.side === "left").map((leaf, i) => (
              <g
                key={`l-${i}`}
                transform={`translate(${leaf.x},${leaf.y}) rotate(${leaf.rot}) scale(${leaf.size})`}
              >
                <use
                  href="#leafShape"
                  className={leaf.alt ? "leaf alt" : "leaf"}
                />
              </g>
            ))}
          </g>

          {/* Right leaves */}
          <g transform="translate(100 100)">
            {LEAVES.filter((l) => l.side === "right").map((leaf, i) => (
              <g
                key={`r-${i}`}
                transform={`translate(${leaf.x},${leaf.y}) rotate(${leaf.rot}) scale(${leaf.size})`}
              >
                <use
                  href="#leafShape"
                  className={leaf.alt ? "leaf alt" : "leaf"}
                />
              </g>
            ))}
          </g>
        </svg>
      </div>

      {/* Leaf styles */}
      <style>{`
        .leaf {
          fill: #6aa174;
          stroke: #355e44;
          stroke-width: 0.8;
          opacity: 0.95;
        }
        .leaf.alt {
          fill: #8bbf91;
        }
        svg path, svg line {
          shape-rendering: geometricPrecision;
          vector-effect: non-scaling-stroke;
        }
      `}</style>
    </div>
  );
}
