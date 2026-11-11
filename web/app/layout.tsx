import type { Metadata } from "next";
import { Inter, Newsreader, Tiro_Devanagari_Hindi } from "next/font/google";
import "katex/dist/katex.min.css";
import { Cursor } from "@/components/Cursor";
import { Nav } from "@/components/Nav";
import { PageFrame } from "@/components/Ornament";
import { Player } from "@/components/Player";
import { SmoothScroll } from "@/components/SmoothScroll";
import "./globals.css";

// Tiro Devanagari Hindi was drawn for Devanagari and Latin together, in the manner of
// printed books; it sets every heading, in both scripts. Newsreader for reading, Inter for small UI.
const display = Tiro_Devanagari_Hindi({ subsets: ["latin", "devanagari"], weight: "400", style: ["normal", "italic"], variable: "--font-display" });
const serif = Newsreader({ subsets: ["latin"], variable: "--font-serif", style: ["normal", "italic"] });
const sans = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  metadataBase: new URL("https://ragaz-black.vercel.app"),
  title: "ragaz",
  description: "A small language model that learned to compose Hindustani ragas on a MacBook. Hum to it and it answers in your raga; hear how it learned.",
  openGraph: {
    title: "ragaz: a language model that composes ragas",
    description: "A 0.6B model that learned to compose Hindustani ragas on a MacBook. Hum 10 seconds and it names your raga and answers in it.",
    url: "/",
    siteName: "ragaz",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: "ragaz: a language model that composes ragas", description: "A 0.6B model that learned to compose Hindustani ragas on a MacBook. Hum 10 seconds and it names your raga and answers in it." },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${serif.variable} ${sans.variable}`}>
      <body className="font-serif text-kajal">
        <SmoothScroll />
        <Nav />
        {children}
        <PageFrame />
        <Player />
        <Cursor />
      </body>
    </html>
  );
}
