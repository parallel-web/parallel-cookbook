import { ImageResponse } from "next/og"
import { MARK_DATA_URI } from "./og-mark"

export const runtime = "edge"
export const alt = "Apartment Finder: find your Bay Area rental in your own words"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

// Social share card ("m3"): the search shown inside an app window with a live
// result chip, over a warm spotlight and a faint wall of candidate units (one
// lit orange). Built in next/og (Satori) primitives: flexbox + gradients +
// box-shadow only, no CSS grid.
export default function OpenGraphImage() {
  const OFF = "#FCFCFA", INK = "#1D1B16", ORANGE = "#FB631B", GREY = "#858483", BORDER = "#E5E5E5"

  // Faint wall of unit cells in the top-right, one lit orange.
  const CW = 8, CR = 5, CS = 46, CSZ = 34
  const wall: React.ReactNode[] = []
  for (let r = 0; r < CR; r++) {
    for (let c = 0; c < CW; c++) {
      const lit = c === 5 && r === 1
      wall.push(
        <div
          key={`${r}-${c}`}
          style={{
            position: "absolute",
            right: c * CS + 70,
            top: r * CS + 44,
            width: CSZ,
            height: CSZ,
            borderRadius: 4,
            backgroundColor: lit ? ORANGE : "#EFEDE7",
            opacity: lit ? 0.9 : 0.7,
          }}
        />,
      )
    }
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          backgroundColor: OFF,
          fontFamily: "sans-serif",
        }}
      >
        {/* warm spotlight */}
        <div style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 630, backgroundImage: "radial-gradient(circle at 80% 16%, #FFDFCF 0%, rgba(252,252,250,0) 58%)", display: "flex" }} />
        {/* faint unit wall */}
        <div style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 630, display: "flex" }}>{wall}</div>

        {/* lockup */}
        <div style={{ position: "absolute", top: 66, left: 100, display: "flex", alignItems: "center" }}>
          <img src={MARK_DATA_URI} width={52} height={52} alt="" />
          <div style={{ fontSize: 26, fontWeight: 600, color: INK, letterSpacing: "-0.4px", marginLeft: 16 }}>Apartment Finder</div>
        </div>

        {/* headline */}
        <div style={{ position: "absolute", top: 172, left: 100, width: 500, fontSize: 54, fontWeight: 600, color: INK, letterSpacing: "-2px", lineHeight: 1.05, display: "flex" }}>
          Find your Bay Area rental in your own words.
        </div>

        {/* app window */}
        <div
          style={{
            position: "absolute", top: 150, left: 646, width: 464,
            display: "flex", flexDirection: "column",
            backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}`, borderRadius: 12,
            boxShadow: "0 30px 70px rgba(15,17,21,0.16)", overflow: "hidden",
          }}
        >
          {/* window chrome */}
          <div style={{ display: "flex", alignItems: "center", padding: "13px 16px", borderBottom: `1px solid #EEEEEE` }}>
            <div style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: BORDER, marginRight: 7 }} />
            <div style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: BORDER, marginRight: 7 }} />
            <div style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: BORDER }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", padding: 18 }}>
            {/* search box */}
            <div style={{ display: "flex", alignItems: "center", border: `1px solid ${BORDER}`, borderRadius: 8 }}>
              <div style={{ flex: 1, padding: "13px 16px", fontSize: 16, color: INK, display: "flex" }}>2 bedroom in the Mission…</div>
              <div style={{ margin: 6, padding: "9px 16px", backgroundColor: ORANGE, color: "#fff", borderRadius: 5, fontSize: 12, fontWeight: 600, letterSpacing: "0.5px", display: "flex" }}>SEARCH</div>
            </div>
            {/* result chip */}
            <div style={{ display: "flex", flexDirection: "column", marginTop: 16, border: `1px solid ${BORDER}`, borderLeft: `3px solid ${ORANGE}`, borderRadius: 6, padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div style={{ fontSize: 18, fontWeight: 600, color: INK, display: "flex" }}>3330 20th St</div>
                <div style={{ fontSize: 19, fontWeight: 600, color: INK, display: "flex" }}>$4,400</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", marginTop: 6 }}>
                <div style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: ORANGE, marginRight: 7 }} />
                <div style={{ fontSize: 12.5, color: GREY, letterSpacing: "0.5px", display: "flex" }}>2 BD · MISSION · VERIFIED</div>
              </div>
            </div>
          </div>
        </div>

        {/* credit */}
        <div style={{ position: "absolute", bottom: 52, left: 100, display: "flex", alignItems: "center" }}>
          <div style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: ORANGE, marginRight: 12 }} />
          <div style={{ fontSize: 18, color: GREY, letterSpacing: "1px", display: "flex" }}>AI SEARCH WITH CITED SOURCES · POWERED BY PARALLEL</div>
        </div>

        {/* orange bar */}
        <div style={{ position: "absolute", bottom: 0, left: 0, width: 1200, height: 10, backgroundColor: ORANGE }} />
      </div>
    ),
    size,
  )
}
