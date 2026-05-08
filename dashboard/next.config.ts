import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  // Корнем для Turbopack ставим родительскую папку (scan-agent/), а не
  // dashboard/. Это нужно потому что @prisma/client намеренно НЕ в
  // dashboard/package.json (см. корневой CLAUDE.md) — клиент резолвится из
  // корневого node_modules через стандартный Node module resolution. Если
  // ограничить root самой dashboard/, Turbopack не пойдёт вверх и не найдёт
  // @prisma/client. Заодно глушится warning про multiple lockfiles.
  turbopack: {
    root: path.resolve(process.cwd(), '..'),
  },
  // Тот же корень для file tracing — иначе standalone-бандл не подхватит
  // @prisma/client из корневого node_modules при сборке Docker-образа.
  outputFileTracingRoot: path.resolve(process.cwd(), '..'),
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Type', value: 'application/javascript' },
        ],
      },
      {
        source: '/manifest.webmanifest',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },
};

export default nextConfig;
