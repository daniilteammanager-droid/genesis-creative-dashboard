import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Reports переименован в Live Manager (28.10.2026) — старые закладки и ссылки ведут на новый адрес.
  async redirects() {
    return [{ source: "/reports", destination: "/live-manager", permanent: true }];
  },
  // Метаданные OAuth для AI-доступа по MCP (Decision 116) — по стандартным адресам /.well-known/*.
  // Дерево /.well-known в app не заводим: роуты живут рядом с остальным OAuth в /api/oauth.
  async rewrites() {
    return [
      { source: "/.well-known/oauth-authorization-server", destination: "/api/oauth/metadata" },
      { source: "/.well-known/oauth-authorization-server/:path*", destination: "/api/oauth/metadata" },
      { source: "/.well-known/oauth-protected-resource", destination: "/api/oauth/resource" },
      { source: "/.well-known/oauth-protected-resource/:path*", destination: "/api/oauth/resource" },
    ];
  },
};

export default nextConfig;
