import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/fund", destination: "/research", permanent: true },
      { source: "/fund/:path*", destination: "/research/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
