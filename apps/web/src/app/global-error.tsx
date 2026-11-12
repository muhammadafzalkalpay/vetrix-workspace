"use client";

// Last resort when even the root layout fails. Plain styles: the app CSS may not have loaded.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0, background: "#f8fafc", color: "#0b1b2b" }}>
        <div style={{ textAlign: "center", maxWidth: 420, padding: 16 }}>
          <h1 style={{ fontSize: 24 }}>Vetrix could not load</h1>
          <p style={{ color: "#475569" }}>Please try again in a moment.</p>
          <button onClick={reset} style={{ marginTop: 12, padding: "10px 18px", borderRadius: 8, border: 0, background: "#0f766e", color: "#fff", cursor: "pointer" }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
