// Parallel design-system tokens (parallel.ai). Warm off-white base, index
// black text, signal orange as a sparing accent, neutral grey borders. Key
// names are kept stable (incl. the legacy `blue*` names) so every consumer
// picks up the on-brand values without a rename sweep. Per the brand system,
// interactive text is index black (underline on hover), signal orange is
// reserved for primary CTAs and selected states, and red is errors only.
export const Z = {
  // Signal orange — primary CTA / one key accent per section. Not a fill color.
  blue: "#FB631B",
  // Interactive / link text: index black (the brand's link affordance is an
  // underline on hover, not a blue). Emphasis uses the same.
  blueDark: "#1D1B16",
  blueDarker: "#1D1B16",
  // Selected / "parsed" chip + soft-CTA fills: orange wash and orange-light.
  blueSoft: "#FCDDCF",
  blueSofter: "#FEF3EC",
  blueBorder: "#F9BC9F",
  text: "#1D1B16",
  textSoft: "#3A352A",
  textMid: "#5C5B59",
  textFaint: "#858483",
  bgPage: "#FCFCFA",
  bgCard: "#FFFFFF",
  bgSubtle: "#F6F6F6",
  border: "#E5E5E5",
  borderSoft: "#EEEEEE",
  green: "#137333",
  greenSoft: "#E6F4EA",
  amber: "#C77700",
  amberSoft: "#FFF4E0",
  red: "#E14942",
  redSoft: "#FDECEA",
}

export const FONT_HEADING = "'Geist Variable', 'Geist', system-ui, sans-serif"
export const FONT_BODY = "'Geist Variable', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
export const FONT_MONO = "'Geist Mono Variable', 'Geist Mono', 'FT System Mono', 'SF Mono', Menlo, monospace"
