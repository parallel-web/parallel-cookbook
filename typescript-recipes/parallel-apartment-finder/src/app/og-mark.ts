// The app mark inlined as a data URI so the OG/apple icon routes can draw it
// without filesystem or network access. Keep in sync with public/app-icon.svg.
const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#1D1B16"/>
  <g transform="translate(8.5,8) scale(0.75)">
    <path d="M32 4 L58 26 V53 Q58 60 51 60 H13 Q6 60 6 53 V26 Z" fill="#FCFCFA"/>
    <g fill="#1D1B16">
      <rect x="13" y="28" width="10" height="10" rx="2"/>
      <rect x="27" y="28" width="10" height="10" rx="2" fill="#FB631B"/>
      <rect x="41" y="28" width="10" height="10" rx="2"/>
      <rect x="13" y="42" width="10" height="10" rx="2"/>
      <rect x="41" y="42" width="10" height="10" rx="2"/>
      <rect x="27" y="42" width="10" height="18" rx="2"/>
    </g>
  </g>
</svg>`

export const MARK_DATA_URI = `data:image/svg+xml,${encodeURIComponent(MARK_SVG)}`
