/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Pages folded into others: Listen is the library on /ragas; Words lives on inside the studio.
  async redirects() {
    return [
      { source: "/listen", destination: "/ragas#library", permanent: false },
      { source: "/words", destination: "/studio", permanent: false },
    ];
  },
};
