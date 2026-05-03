/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Serve the static demo at `/`. The drag-and-drop ClawStudio still
  // lives at `/builder`. The demo HTML is fully self-contained
  // (Google Fonts + inline CSS + inline JS) and ships from
  // packages/studio/public/index.html.
  async rewrites() {
    return [{ source: '/', destination: '/index.html' }];
  },
};
export default nextConfig;
