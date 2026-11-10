import { ImageResponse } from "next/og";

// The link preview (Twitter, LinkedIn, chats): paper, one ink, a red accent, the site's promise.
export const runtime = "edge";
export const alt = "ragaz: a small language model that composes Hindustani ragas";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  const notes = ["सा", "रे", "ग", "प", "ध", "सां"];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#F1E6CF", padding: "64px 72px", border: "14px solid #B23A22", color: "#131A2B" }}>
        <div style={{ display: "flex", fontSize: 24, letterSpacing: 5, textTransform: "uppercase", color: "#4A5166" }}>Hindustani ragas · trained on a MacBook</div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 148, lineHeight: 1, fontWeight: 700 }}>ragaz</div>
          <div style={{ fontSize: 46, lineHeight: 1.25, marginTop: 18, maxWidth: 980 }}>A language model that learned to compose ragas. Hum to it, and it answers in your raga.</div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 22 }}>
          {notes.map((n, i) => <div key={n} style={{ display: "flex", width: 74, height: 40 + i * 22, background: i === 2 ? "#B23A22" : "#131A2B", borderRadius: 8, opacity: 0.9 }} />)}
          <div style={{ display: "flex", marginLeft: "auto", fontSize: 30, color: "#B23A22" }}>ragaz-black.vercel.app</div>
        </div>
      </div>
    ),
    size,
  );
}
