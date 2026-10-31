import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      'recharts',
      '@react-three/drei',
      '@react-three/fiber',
      'three',
    ],
  },
  turbopack: {},
};

export default nextConfig;
