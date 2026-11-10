/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Pages folded into others (Listen is the library on /ragas), and the music-making tools, which
  // were moved out of Ragaz to keep it about ragas (builder_mode/studio-lab).
  async redirects() {
    return [
      { source: "/listen", destination: "/ragas#library", permanent: false },
      ...["/words", "/studio", "/remix", "/waves"].map((source) => ({ source, destination: "/", permanent: false })),
    ];
  },
};
