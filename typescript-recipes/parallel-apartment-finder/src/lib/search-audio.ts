// Procedural "AI searching" sound via Web Audio API. No files, no deps.
//
// Tuned to the Parallel design language translated to audio: warm, precise,
// and technical, never sci-fi. Restraint is the point, like "orange is a
// signal, not a fill": the bed is a soft, low, slowly-breathing drone (the
// off-white ground), and the one bright accent is the blip when a candidate
// verifies (the signal). Everything is low-passed for warmth (no clinical
// highs) with gentle envelopes. Only sine/triangle partials, lightly detuned.
//
// The AudioContext is created lazily and only resumed from a user gesture
// (the Search click), per browser autoplay policy. Muting persists via the UI.

type Drone = { stop: () => void }

let ctx: AudioContext | null = null
let master: GainNode | null = null
let drone: Drone | null = null
let muted = false

function ensure(): AudioContext | null {
  if (typeof window === "undefined") return null
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = 0.9
    master.connect(ctx.destination)
  }
  if (ctx.state === "suspended") void ctx.resume()
  return ctx
}

// Major pentatonic, ascending: successive matches feel like they resolve.
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21]

export const searchAudio = {
  setMuted(m: boolean) {
    muted = m
    // Hard-gate the master output so mute is instant and total, regardless of
    // any node still playing. Restore on unmute so later searches are audible.
    if (ctx && master) {
      master.gain.cancelScheduledValues(ctx.currentTime)
      master.gain.setValueAtTime(m ? 0 : 0.9, ctx.currentTime)
    }
    if (m) { drone?.stop(); drone = null }
  },
  isMuted: () => muted,

  start() {
    if (muted) return
    const c = ensure()
    if (!c || !master || drone) return
    const now = c.currentTime

    const bed = c.createGain()
    bed.gain.value = 0
    bed.connect(master)

    // Warm-but-airy foundation: a mid root + its fifth, gently low-passed
    // higher so it reads bright and friendly rather than dark.
    const filt = c.createBiquadFilter()
    filt.type = "lowpass"
    filt.frequency.value = 850
    filt.Q.value = 1.5
    filt.connect(bed)
    const o1 = c.createOscillator(); o1.type = "triangle"; o1.frequency.value = 130.81 // C3
    const o2 = c.createOscillator(); o2.type = "sine"; o2.frequency.value = 196.0; o2.detune.value = 4 // G3
    const o3 = c.createOscillator(); o3.type = "sine"; o3.frequency.value = 392.0; o3.detune.value = -3 // G4 airy shimmer
    const o3g = c.createGain(); o3g.gain.value = 0.28
    o1.connect(filt); o2.connect(filt); o3.connect(o3g); o3g.connect(filt)

    // Slow filter drift + a gentle amplitude "breath": processing, not a beat.
    const drift = c.createOscillator(); drift.type = "sine"; drift.frequency.value = 0.13
    const driftG = c.createGain(); driftG.gain.value = 320
    drift.connect(driftG); driftG.connect(filt.frequency)
    const breath = c.createOscillator(); breath.type = "sine"; breath.frequency.value = 0.4
    const breathG = c.createGain(); breathG.gain.value = 0.018
    breath.connect(breathG); breathG.connect(bed.gain)

    bed.gain.setValueAtTime(0, now)
    bed.gain.linearRampToValueAtTime(0.055, now + 1.1) // restrained
    o1.start(); o2.start(); o3.start(); drift.start(); breath.start()

    drone = {
      stop: () => {
        const t = c.currentTime
        bed.gain.cancelScheduledValues(t)
        bed.gain.setValueAtTime(Math.max(bed.gain.value, 0.0001), t)
        bed.gain.linearRampToValueAtTime(0, t + 0.7)
        for (const o of [o1, o2, o3, drift, breath]) o.stop(t + 0.8)
      },
    }
  },

  // The signal: a warm bell for the nth verified match, pitched up the scale.
  tick(n: number) {
    if (muted) return
    const c = ensure()
    if (!c || !master) return
    const step = PENTA[n % PENTA.length] + 12 * Math.min(2, Math.floor(n / PENTA.length))
    const base = 523.25 * Math.pow(2, Math.min(step, 24) / 12) // C5 root, up an octave = brighter
    const t = c.currentTime
    const g = c.createGain(); g.gain.value = 0; g.connect(master)
    // Bright, friendly chime: fundamental + octave + a sparkle two octaves up.
    const soft = c.createBiquadFilter(); soft.type = "lowpass"; soft.frequency.value = 6000; soft.connect(g)
    const o = c.createOscillator(); o.type = "sine"; o.frequency.value = base
    const oct = c.createOscillator(); oct.type = "sine"; oct.frequency.value = base * 2
    const octG = c.createGain(); octG.gain.value = 0.4
    const spk = c.createOscillator(); spk.type = "sine"; spk.frequency.value = base * 3
    const spkG = c.createGain(); spkG.gain.value = 0.14
    o.connect(soft); oct.connect(octG); octG.connect(soft); spk.connect(spkG); spkG.connect(soft)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.12, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55)
    o.start(t); oct.start(t); spk.start(t)
    o.stop(t + 0.6); oct.stop(t + 0.6); spk.stop(t + 0.6)
  },

  stop(success: boolean) {
    const c = ctx
    if (!c || !master) { drone?.stop(); drone = null; return }
    if (success && !muted) {
      // Cheerful major arpeggio: C, E, G, C. Bright and friendly resolve.
      const t = c.currentTime
      const soft = c.createBiquadFilter(); soft.type = "lowpass"; soft.frequency.value = 6000; soft.connect(master)
      const notes = [523.25, 659.25, 783.99, 1046.5] // C5, E5, G5, C6
      notes.forEach((f, i) => {
        const o = c.createOscillator(); o.type = "sine"; o.frequency.value = f
        const oct = c.createOscillator(); oct.type = "sine"; oct.frequency.value = f * 2
        const octG = c.createGain(); octG.gain.value = 0.18
        const g = c.createGain(); g.gain.value = 0
        o.connect(g); oct.connect(octG); octG.connect(g); g.connect(soft)
        const s = t + i * 0.1
        g.gain.setValueAtTime(0, s)
        g.gain.linearRampToValueAtTime(0.11, s + 0.02)
        g.gain.exponentialRampToValueAtTime(0.0001, s + 0.75)
        o.start(s); oct.start(s); o.stop(s + 0.8); oct.stop(s + 0.8)
      })
    }
    drone?.stop(); drone = null
  },
}
