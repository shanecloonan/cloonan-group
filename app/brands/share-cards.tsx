import Image from "next/image";
import { comDomain, SUBSIDIARY_SEED, subsidiaryUrl } from "./subsidiaries";

/**
 * Local copies of verified 1200×630 og:image files.
 * Served from this site so the grid does not hotlink deployment-hashed URLs.
 * Linked brands with no real share image are omitted.
 */
const SHARE_IMAGE: Record<string, string> = {
  "Daily 2x": "/brands/share/daily2x.png",
  "TVN News": "/brands/share/tvnnews.jpg",
  "Saint Holland": "/brands/share/saintholland.jpg",
  THC5: "/brands/share/thc5.png",
  "TenX Casino": "/brands/share/tenxcasino.png",
  "File Display": "/brands/share/filedisplay.png",
  "NIL Enterprise": "/brands/share/nilenterprise.png",
  Beigefield: "/brands/share/beigefield.png",
  "Salmon Salad": "/brands/share/salmonsalad.png",
  BusinessVend: "/brands/share/businessvend.png",
  "Top Parlays": "/brands/share/topparlays.png",
  Dakbot: "/brands/share/dakbot.png",
  RandomPPL: "/brands/share/randomppl.png",
};

const SHARE_CARDS = SUBSIDIARY_SEED.flatMap((seed) => {
  const url = subsidiaryUrl(seed);
  const image = SHARE_IMAGE[seed.name];
  if (!url || !image) return [];
  return [{ name: seed.name, domain: comDomain(seed.name), url, image }];
});

export default function ShareCards() {
  return (
    <section id="share-cards" className="relative bg-brand-950 border-t border-brand-800">
      <div className="relative px-5 sm:px-8 pt-12 pb-6 sm:pt-16 sm:pb-8">
        <div className="absolute inset-0 bg-gradient-to-b from-forest/20 to-transparent" />
        <div className="relative z-10 max-w-3xl mx-auto text-center">
          <h2 className="font-heading text-lg sm:text-xl md:text-2xl font-bold tracking-tight uppercase mb-3 text-brand-200">
            Share cards
          </h2>
          <p className="text-brand-500 text-sm max-w-lg mx-auto">
            Social images from the live brand sites.
          </p>
        </div>
      </div>

      <div className="px-5 sm:px-8 pb-16 sm:pb-24">
        <ul className="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {SHARE_CARDS.map((card) => (
            <li key={card.name} className="min-w-0">
              <a
                href={card.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group border border-gold/40 bg-gold/5 rounded-sm overflow-hidden flex flex-col h-full transition-all hover:brightness-125 hover:border-gold/70"
              >
                <Image
                  src={card.image}
                  alt=""
                  width={1200}
                  height={630}
                  sizes="(min-width: 1024px) 360px, (min-width: 640px) 50vw, 100vw"
                  style={{ width: "100%", height: "auto" }}
                />
                <div className="px-3 py-3 sm:px-4 sm:py-3.5 text-center">
                  <h3 className="font-heading text-sm sm:text-lg font-bold uppercase tracking-wide text-gold mb-1.5">
                    {card.name}
                  </h3>
                  <span className="inline-block max-w-full text-[10px] sm:text-[11px] font-semibold leading-snug px-2.5 py-0.5 rounded-full bg-gold/15 text-gold break-words">
                    {card.domain}
                  </span>
                </div>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
