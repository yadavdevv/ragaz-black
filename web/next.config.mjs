/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Pages folded into others: Listen is the library on /ragas; Words lives on inside Remix.
  async redirects() {
    return [
      { source: "/listen", destination: "/ragas#library", permanent: false },
      { source: "/words", destination: "/remix", permanent: false },
      // Waves grew into the studio: its sound designer is the studio's Sound panel.
      { source: "/waves", destination: "/studio", permanent: false },
    ];
  },
};
