import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Reports переименован в Live Manager (28.10.2026) — старые закладки и ссылки ведут на новый адрес.
  async redirects() {
    return [{ source: "/reports", destination: "/live-manager", permanent: true }];
  },
};

export default nextConfig;
