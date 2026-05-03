/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The site is fully static; lock-in by exporting at build time. Vercel
  // serves it from CDN with no Node runtime.
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: false,
};
export default nextConfig;
