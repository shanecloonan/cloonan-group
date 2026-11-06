import type { Metadata } from "next";
import Image from "next/image";

/**
 * Curated /active list. Order is intentional — do not sort.
 * Hostnames are lowercased for the HTTPS destination only.
 * Share images are the existing Active assets; missing ones stay unlabeled.
 */
const ACTIVE_LINKS: {
  label: string;
  host: string;
  image?: string;
  width?: number;
  height?: number;
}[] = [
  { label: "WitResearch.com", host: "witresearch.com", image: "/brands/share/witresearch.png", width: 1200, height: 630 },
  { label: "TvnNews.com", host: "tvnnews.com", image: "/brands/share/tvnnews.jpg", width: 1200, height: 630 },
  { label: "Vecey.com", host: "vecey.com" },
  { label: "AntlerGear.com", host: "antlergear.com", image: "/brands/share/antlergear.png", width: 872, height: 516 },
  { label: "TenXcasino.com", host: "tenxcasino.com", image: "/brands/share/tenxcasino.png", width: 1200, height: 630 },
  { label: "Thc5.com", host: "thc5.com", image: "/brands/share/thc5.png", width: 1200, height: 630 },
  { label: "GlobeSheet.com", host: "globesheet.com" },
  { label: "Daily2x.com", host: "daily2x.com", image: "/brands/share/daily2x.png", width: 1200, height: 630 },
  { label: "PFPchain.com", host: "pfpchain.com", image: "/brands/share/pfpchain.png", width: 1200, height: 630 },
  { label: "FileDisplay.com", host: "filedisplay.com", image: "/brands/share/filedisplay.png", width: 1200, height: 630 },
  { label: "Saintholland.com", host: "saintholland.com", image: "/brands/share/saintholland.jpg", width: 1200, height: 630 },
  { label: "RandomPPL.com", host: "randomppl.com", image: "/brands/share/randomppl.png", width: 1200, height: 630 },
  { label: "USDBill.com", host: "usdbill.com", image: "/brands/share/usdbill.jpg", width: 1168, height: 784 },
];

export const metadata: Metadata = {
  title: "Active | MoneyFund",
  description: ACTIVE_LINKS.map((link) => link.label).join(", "),
};

export default function ActivePage() {
  return (
    <div className="min-h-screen bg-brand-950 pt-14">
      <section id="active" className="relative bg-brand-950">
        <div className="relative px-5 sm:px-8 pt-12 pb-6 sm:pt-16 sm:pb-8">
          <div className="absolute inset-0 bg-gradient-to-b from-forest/20 to-transparent" />
          <div className="relative z-10 max-w-3xl mx-auto text-center">
            <h1 className="font-heading text-lg sm:text-xl md:text-2xl font-bold tracking-tight uppercase mb-3 text-brand-200">
              Active
            </h1>
          </div>
        </div>

        <div className="px-5 sm:px-8 pb-16 sm:pb-24">
          <ul className="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {ACTIVE_LINKS.map((link) => (
              <li key={link.host} className="min-w-0">
                <a
                  href={`https://${link.host}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group border border-gold/40 bg-gold/5 rounded-sm overflow-hidden flex flex-col h-full transition-all hover:brightness-125 hover:border-gold/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
                >
                  {link.image && link.width && link.height ? (
                    <Image
                      src={link.image}
                      alt=""
                      width={link.width}
                      height={link.height}
                      sizes="(min-width: 1024px) 360px, (min-width: 640px) 50vw, 100vw"
                      style={{ width: "100%", height: "auto" }}
                    />
                  ) : (
                    <div className="aspect-[1200/630] w-full" aria-hidden="true" />
                  )}
                  <p className="px-4 py-5 sm:px-5 sm:py-6 text-center font-heading text-xl sm:text-2xl font-bold tracking-wide text-gold break-words">
                    {link.label}
                  </p>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
