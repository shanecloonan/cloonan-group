/** Exact-match .com domain: brand name lowercased, spaces removed. */
export function comDomain(name: string) {
  return `${name.replace(/\s+/g, "").toLowerCase()}.com`;
}

export type SubsidiarySeed = {
  name: string;
  desc: string;
  /** Link override on the same .com domain (e.g. its www host). Defaults to the .com domain. */
  site?: string;
  /** Set when the .com domain doesn't resolve. The domain still shows, unlinked. */
  unlinked?: boolean;
};

export const SUBSIDIARY_SEED: SubsidiarySeed[] = [
  { name: "Antler Gear", desc: "Premium bowhunting equipment." },
  {
    name: "Daily 2x",
    desc: "Free daily 2x pick, locked on Arweave. Public wins, losses, and streak.",
  },
  { name: "PFP Chain", desc: "Permanent Database Blockchain." },
  { name: "TVN News", desc: "Fake news propaganda platform." },
  { name: "Saint Holland", desc: "", site: "www.saintholland.com" },
  { name: "Stock FUD", desc: "FUD dissemination platform." },
  { name: "THC5", desc: "The new way to get high. High-end laboratory cannabis." },
  { name: "Dirt Shares", desc: "Fractionalized Land Investing." },
  { name: "Wynport", desc: "Casino and Sportsbook." },
  { name: "Wit Research", desc: "Market analytics platform." },
  { name: "Vix Ventures", desc: "Venture Capital Partners." },
  { name: "4th Capital", desc: "" },
  { name: "KNA Partners", desc: "Law firm.", site: "www.knapartners.com" },
  { name: "TenX Casino", desc: "Casino and gaming.", site: "www.tenxcasino.com" },
  { name: "File Display", desc: "Internal tooling SaaS platform." },
  { name: "Glycell", desc: "Synthetic biology research." },
  { name: "Deltamorph", desc: "Genomic Discovery Lab." },
  { name: "Cheaper Brand", desc: "Knockoff products and Chinese bullshit." },
  { name: "Joint Pacific", desc: "" },
  { name: "DTV Sports", desc: "NIL Agency." },
  { name: "Chip Fab", desc: "Semiconductor Research." },
  { name: "FN Journal", desc: "" },
  { name: "RCO Real Estate", desc: "Real estate investment." },
  { name: "NIL Enterprise", desc: "The name, image, and likeness experts." },
  { name: "ABY Global", desc: "Global holdings and ventures.", site: "www.abyglobal.com" },
  { name: "WEA Health", desc: "Health and wellness." },
  { name: "QD Mart", desc: "Online marketplace." },
  { name: "ANM Store", desc: "Online store." },
  { name: "Beigefield", desc: "Real Estate Holdings.", site: "www.beigefield.com" },
  { name: "Lynico", desc: "Cloonan Group brand." },
  { name: "Salmon Salad", desc: "Salmon Salad.", site: "www.salmonsalad.com" },
  {
    name: "BusinessVend",
    desc: "The world's #1 small business marketplace.",
    site: "www.businessvend.com",
  },
  {
    name: "Top Parlays",
    desc: "All the top parlays in one place.",
    site: "www.topparlays.com",
  },
  { name: "Dakbot", desc: "Dakbot.", site: "www.dakbot.com" },
  {
    name: "RandomPPL",
    desc: "Anonymous chat with random strangers.",
    site: "www.randomppl.com",
  },
];

export function subsidiaryUrl(seed: SubsidiarySeed) {
  if (seed.unlinked) return undefined;
  return `https://${(seed.site ?? comDomain(seed.name)).toLowerCase()}`;
}
