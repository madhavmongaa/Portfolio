// Everything you hear is synthesised here with Web Audio: no sound files.
// The engine, tyres, wind and exhaust follow the car; small chimes mark
// arrivals; an original synthwave loop plays underneath.
// Browsers only allow sound after a click or key press, so nothing starts
// until the first one.

const STORE = 'mm-sound'
const BPM = 96
const S16 = 60 / BPM / 4 // one sixteenth note, in seconds
const mtof = (m) => 440 * 2 ** ((m - 69) / 12)

// Am, F, C, G, one bar each. Pad voicings move as little as possible.
const PROG = [
  { root: 33, pad: [57, 60, 64] },
  { root: 29, pad: [57, 60, 65] },
  { root: 36, pad: [55, 60, 64] },
  { root: 31, pad: [55, 59, 62] },
]
// Lead line over the four bars: [sixteenth, note, length in sixteenths].
const LEAD = [
  [0, 76, 6], [6, 74, 2], [8, 72, 4], [12, 69, 4],
  [16, 77, 6], [22, 76, 2], [24, 72, 8],
  [32, 79, 6], [38, 76, 2], [40, 72, 4], [44, 76, 4],
  [48, 74, 12], [60, 71, 4],
]
const LEAD_AT = new Map(LEAD.map((n) => [n[0], n]))

export function createAudio() {
  let on = true
  try {
    on = localStorage.getItem(STORE) !== 'off'
  } catch {}
  let ctx = null
  let out, sfx, music, musicIn, duck, revSend, dlySend, sfxVerb, noise
  let eng = null
  let playing = false // the drive is on screen
  let live = false // sound is actually running
  let timer = 0
  let step = 0
  let nextT = 0
  let dimmed = false

  // ---------- setup ----------
  function build() {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return false
    ctx = new AC()
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -12
    comp.ratio.value = 4
    comp.attack.value = 0.005
    comp.release.value = 0.2
    out = gain(0)
    out.connect(comp)
    comp.connect(ctx.destination)
    sfx = gain(0.9, out)
    music = gain(0.42, out)
    musicIn = gain(1, music)
    duck = gain(1, musicIn) // pumped by the kick drum

    // One second of white noise, reused by everything that hisses.
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const nd = noise.getChannelData(0)
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1

    // Music reverb and a dotted-eighth echo.
    revSend = gain(1)
    const verb = ctx.createConvolver()
    verb.buffer = impulse(2.8, 2.6)
    revSend.connect(verb)
    verb.connect(gain(0.5, musicIn))
    dlySend = gain(1)
    const dly = ctx.createDelay(1)
    dly.delayTime.value = S16 * 3
    const fb = gain(0.36)
    const dlp = filter('lowpass', 2600)
    dlySend.connect(dly)
    dly.connect(dlp)
    dlp.connect(fb)
    fb.connect(dly)
    dlp.connect(gain(0.35, musicIn))

    // A shorter room for the chimes.
    sfxVerb = gain(1)
    const sv = ctx.createConvolver()
    sv.buffer = impulse(1.6, 3)
    sfxVerb.connect(sv)
    sv.connect(gain(0.4, sfx))

    eng = buildEngine()
    return true
  }

  function gain(v, to) {
    const g = ctx.createGain()
    g.gain.value = v
    if (to) g.connect(to)
    return g
  }
  function filter(type, f, q = 0.7) {
    const b = ctx.createBiquadFilter()
    b.type = type
    b.frequency.value = f
    b.Q.value = q
    return b
  }
  function impulse(sec, decay) {
    const len = Math.floor(ctx.sampleRate * sec)
    const b = ctx.createBuffer(2, len, ctx.sampleRate)
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay
    }
    return b
  }
  function noiseSrc() {
    const s = ctx.createBufferSource()
    s.buffer = noise
    s.loop = true
    return s
  }

  // ---------- car ----------
  // A crossplane V8 on straight pipes. The crank fires every 90 degrees, but
  // each bank's four cylinders fire unevenly (gaps of 270, 180, 90 and 180
  // degrees), and with no crossover pipe each tailpipe hears only its own bank:
  // that unevenness is the burble. One engine cycle (720 degrees) is drawn as a
  // pulse train per bank and turned into a waveform the oscillator repeats.
  // Firing order 1-8-4-3-6-5-7-2; odd cylinders on the left bank.
  const FIRING = [[0, 'L', 1.0], [90, 'R', 0.92], [180, 'R', 1.06], [270, 'L', 0.95], [360, 'R', 1.0], [450, 'L', 1.08], [540, 'L', 0.9], [630, 'R', 1.03]]
  function bankWave(bank) {
    const N = 4096
    const H = 96
    const x = new Float32Array(N)
    for (const [deg, b, amp] of FIRING) {
      if (b !== bank) continue
      const start = deg / 720
      for (let i = 0; i < N; i++) {
        let d = i / N - start
        if (d < 0) d += 1
        // A hard exhaust pulse that rings and dies away in the pipe.
        x[i] += amp * Math.exp(-d / 0.028) * (Math.sin(2 * Math.PI * d * 11) + 0.6 * Math.sin(2 * Math.PI * d * 4))
      }
    }
    const re = new Float32Array(H)
    const im = new Float32Array(H)
    for (let h = 1; h < H; h++) {
      let a = 0
      let b = 0
      for (let i = 0; i < N; i++) {
        const w = (2 * Math.PI * h * i) / N
        a += x[i] * Math.cos(w)
        b += x[i] * Math.sin(w)
      }
      re[h] = (2 * a) / N
      im[h] = (2 * b) / N
    }
    return ctx.createPeriodicWave(re, im)
  }

  function buildEngine() {
    const body = gain(0, sfx)
    const tone = filter('lowpass', 600, 1.2)
    const chest = filter('peaking', 95, 1)
    chest.gain.value = 7
    const shaper = ctx.createWaveShaper()
    const curve = new Float32Array(2048)
    for (let i = 0; i < 2048; i++) curve[i] = Math.tanh(((i / 2047) * 2 - 1) * 3.2)
    shaper.curve = curve
    shaper.oversample = '2x'
    const drive = gain(1.4)
    drive.connect(shaper)
    shaper.connect(chest)
    chest.connect(tone)
    tone.connect(body)

    // One oscillator per bank, panned a little apart like twin tailpipes.
    const banks = ['L', 'R'].map((b) => {
      const o = ctx.createOscillator()
      o.setPeriodicWave(bankWave(b))
      const p = ctx.createStereoPanner()
      p.pan.value = b === 'L' ? -0.35 : 0.35
      o.connect(p)
      p.connect(drive)
      return o
    })
    // Rasp: noise chopped by the exhaust pulses, the tearing edge of an open pipe.
    const rasp = gain(0)
    const rn = noiseSrc()
    const rb = filter('bandpass', 1400, 0.8)
    rn.connect(rb)
    rb.connect(rasp)
    rasp.connect(tone)
    const raspAmt = gain(0)
    banks[0].connect(raspAmt)
    banks[1].connect(raspAmt)
    raspAmt.connect(rasp.gain)
    rn.start()
    const t = ctx.currentTime + 0.02
    for (const o of banks) o.start(t) // same start, same automation: they stay in phase

    // Tyre screech: a pair of rough, wavering tones over a band of hiss,
    // the sound of rubber stick-slipping across tarmac.
    const squeal = gain(0, sfx)
    const sqTone = filter('bandpass', 1000, 3)
    sqTone.connect(squeal)
    const sqOsc = [0, 1].map((i) => {
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = i ? 1420 : 960
      o.connect(gain(i ? 0.5 : 1, sqTone))
      o.start()
      return o
    })
    const n1 = noiseSrc()
    const bp1 = filter('bandpass', 1200, 6)
    const bp2 = filter('bandpass', 2500, 10)
    n1.connect(bp1)
    n1.connect(bp2)
    bp1.connect(gain(0.9, squeal))
    bp2.connect(gain(0.5, squeal))
    n1.start()
    // Chatter: the rubber grabs and lets go a few dozen times a second.
    const chatter = gain(0.65, sfx)
    squeal.disconnect()
    squeal.connect(chatter)
    const ch = ctx.createOscillator()
    ch.type = 'square'
    ch.frequency.value = 23
    ch.connect(gain(0.35, chatter.gain))
    ch.start()

    const wind = gain(0, sfx)
    const n2 = noiseSrc()
    const wl = filter('lowpass', 700)
    n2.connect(wl)
    wl.connect(wind)
    n2.start(0, 0.7)

    const rumble = gain(0, sfx)
    const n3 = noiseSrc()
    const rl = filter('lowpass', 150, 2)
    n3.connect(rl)
    rl.connect(rumble)
    n3.start(0, 1.3)

    return { body, tone, drive, banks, raspAmt, squeal, sqOsc, sqTone, ch, bp1, wind, rumble, gear: 1 }
  }

  let screech = 0
  // Called every frame with the car's state; the gearbox lives in drive.js.
  function drive(dt, { vf, throttle, skid, corner, off, rpm: RPM, gear, shift, IDLE, REDLINE }) {
    if (!live) return
    const v = Math.abs(vf)
    const t = ctx.currentTime
    const r = (RPM - IDLE) / (REDLINE - IDLE)
    // Upshift under power: a crack from the pipes as the ignition cuts.
    if (gear > eng.gear && throttle) bang(t + 0.02, 0.5)
    eng.gear = gear

    // Near idle a lumpy cam makes the revs hunt a little.
    const lope = r < 0.08 ? 1 + (Math.random() - 0.5) * 0.05 : 1
    const cyc = (RPM * lope) / 120 // engine cycles per second (one cycle is two turns)
    for (const o of eng.banks) o.frequency.setTargetAtTime(cyc, t, 0.02)
    const load = shift > 0 ? 0 : throttle
    eng.tone.frequency.setTargetAtTime(380 + r * 1400 + load * (900 + r * 2600), t, 0.05)
    eng.drive.gain.setTargetAtTime(1 + load * 2.2, t, 0.05)
    eng.raspAmt.gain.setTargetAtTime(0.05 + load * (0.25 + r * 0.35), t, 0.05)
    const level = shift > 0 ? 0.045 : 0.09 + 0.06 * r + 0.09 * load
    eng.body.gain.setTargetAtTime(level, t, shift > 0 ? 0.01 : 0.06)

    // Off the throttle at speed the pipes pop and crackle on the overrun.
    if (!throttle && r > 0.35 && v > 8 && Math.random() < dt * 7) bang(t + Math.random() * 0.03, 0.15 + Math.random() * 0.3)

    // Screech: sliding, locked or spinning tyres, and hard cornering near the limit.
    const want = v > 2.5 ? Math.max(skid, Math.min(1, Math.max(0, corner - 11) / 12) * 0.75) : 0
    screech += (want - screech) * Math.min(1, dt * (want > screech ? 14 : 6))
    eng.squeal.gain.setTargetAtTime(screech * screech * 0.16, t, 0.03)
    const wob = 1 + (Math.random() - 0.5) * 0.09
    eng.sqOsc[0].frequency.setTargetAtTime((880 + screech * 260) * wob, t, 0.02)
    eng.sqOsc[1].frequency.setTargetAtTime((1300 + screech * 380) * wob, t, 0.02)
    eng.sqTone.frequency.setTargetAtTime(1000 + screech * 300, t, 0.05)
    eng.ch.frequency.setTargetAtTime(16 + v * 0.5 + Math.random() * 6, t, 0.03)
    eng.bp1.frequency.setTargetAtTime(1050 + Math.random() * 220 + v * 6, t, 0.02)
    eng.wind.gain.setTargetAtTime(Math.min(1, v / 50) ** 2 * 0.07, t, 0.2)
    eng.rumble.gain.setTargetAtTime(off ? Math.min(1, v / 8) * 0.22 : 0, t, 0.1)
  }

  // One crack from the exhaust: a short, dark burst of noise with a thump under it.
  function bang(t, vol) {
    const s = noiseSrc()
    const bp = filter('bandpass', 300 + Math.random() * 600, 1.2)
    const g = gain(0)
    s.connect(bp)
    bp.connect(g)
    g.connect(sfx)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(vol, t + 0.003)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.04 + Math.random() * 0.05)
    s.start(t, Math.random())
    s.stop(t + 0.12)
    const o = ctx.createOscillator()
    o.frequency.setValueAtTime(110, t)
    o.frequency.exponentialRampToValueAtTime(45, t + 0.06)
    const og = gain(0, sfx)
    o.connect(og)
    og.gain.setValueAtTime(vol * 0.8, t)
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.08)
    o.start(t)
    o.stop(t + 0.1)
  }
  // Lift-off at speed: a quick volley of bangs.
  function pop() {
    if (!live) return
    const n = 4 + Math.floor(Math.random() * 4)
    for (let i = 0; i < n; i++) bang(ctx.currentTime + 0.04 + Math.random() * 0.55, 0.35 + Math.random() * 0.4)
  }

  // ---------- chimes ----------
  function tone(m, t, dur, type, vol, dest = sfx, verb = sfxVerb) {
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.value = mtof(m)
    const g = gain(0)
    o.connect(g)
    g.connect(dest)
    if (verb) g.connect(verb)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(vol, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur)
    o.start(t)
    o.stop(t + dur + 0.05)
  }
  const now = () => ctx.currentTime + 0.01
  function arrive() {
    if (!live) return
    tone(81, now(), 0.8, 'sine', 0.07)
    tone(88, now() + 0.1, 1.1, 'sine', 0.06)
  }
  function click() {
    if (!live) return
    tone(93, now(), 0.09, 'triangle', 0.04, sfx, null)
  }
  function fanfare() {
    if (!live) return
    ;[69, 72, 76, 81, 84, 88].forEach((m, i) => tone(m, now() + i * 0.09, 0.9, 'triangle', 0.05))
  }

  // ---------- music ----------
  function voice(type, m, t, dur, { vol, cut, a = 0.005, r = 0.1, detune = 0, to = duck, rev = 0, dl = 0 }) {
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.value = mtof(m)
    o.detune.value = detune
    const lp = filter('lowpass', cut)
    const g = gain(0)
    o.connect(lp)
    lp.connect(g)
    g.connect(to)
    if (rev) g.connect(gain(rev, revSend))
    if (dl) g.connect(gain(dl, dlySend))
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(vol, t + a)
    g.gain.setValueAtTime(vol, t + Math.max(a, dur - r))
    g.gain.linearRampToValueAtTime(0, t + dur)
    o.start(t)
    o.stop(t + dur + 0.02)
    return { o, lp }
  }
  function kick(t) {
    const o = ctx.createOscillator()
    const g = gain(0, musicIn)
    o.connect(g)
    o.frequency.setValueAtTime(150, t)
    o.frequency.exponentialRampToValueAtTime(42, t + 0.13)
    g.gain.setValueAtTime(0.9, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4)
    o.start(t)
    o.stop(t + 0.42)
    duck.gain.cancelScheduledValues(t)
    duck.gain.setValueAtTime(0.35, t)
    duck.gain.setTargetAtTime(1, t + 0.03, 0.09)
  }
  function snare(t) {
    const s = noiseSrc()
    const bp = filter('bandpass', 1700, 0.8)
    const g = gain(0, musicIn)
    s.connect(bp)
    bp.connect(g)
    g.connect(gain(0.9, revSend)) // the big gated-sounding room
    g.gain.setValueAtTime(0.45, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22)
    s.start(t, Math.random())
    s.stop(t + 0.25)
    const o = ctx.createOscillator()
    o.type = 'triangle'
    o.frequency.setValueAtTime(220, t)
    o.frequency.exponentialRampToValueAtTime(140, t + 0.08)
    const og = gain(0, musicIn)
    o.connect(og)
    og.gain.setValueAtTime(0.3, t)
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.1)
    o.start(t)
    o.stop(t + 0.12)
  }
  function hat(t, vol) {
    const s = noiseSrc()
    const hp = filter('highpass', 7500)
    const g = gain(0, musicIn)
    s.connect(hp)
    hp.connect(g)
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.045)
    s.start(t, Math.random())
    s.stop(t + 0.06)
  }

  // One sixteenth of the loop. Form: 4-bar intro, then 8-bar sections that
  // cycle groove, groove with lead, breakdown.
  function play16(n, t) {
    const bar = Math.floor(n / 16)
    const s = n % 16
    const ch = PROG[bar % 4]
    const sec = bar < 4 ? 0 : 1 + (Math.floor((bar - 4) / 8) % 3)
    const drums = sec === 1 || sec === 2
    const lead = sec === 2 || sec === 3

    if (s === 0) {
      for (const m of ch.pad) {
        for (const d of [-9, 9]) {
          voice('sawtooth', m, t, S16 * 16 + 0.15, { vol: 0.028, cut: sec === 3 ? 1800 : 1100, a: 0.45, r: 0.6, detune: d, rev: 0.6 })
        }
      }
    }
    // Arpeggio up the chord, an octave above the pad.
    const arp = [...ch.pad.map((m) => m + 12), ch.pad[0] + 24]
    const open = sec === 0 ? 600 + (bar * 16 + s) * 6 : 2400
    voice('square', arp[s % 4], t, S16 * 0.9, { vol: sec === 0 ? 0.022 : 0.03, cut: open, r: 0.08, dl: 0.5, rev: 0.15 })
    // Octave bass on the eighths.
    if (s % 2 === 0 && (bar >= 2 || sec > 0) && sec !== 3) {
      const m = ch.root + (s % 4 === 2 ? 12 : 0)
      const b = voice('sawtooth', m, t, S16 * 1.8, { vol: 0.16, cut: 300, r: 0.05 })
      b.lp.frequency.setValueAtTime(1100, t)
      b.lp.frequency.exponentialRampToValueAtTime(260, t + 0.18)
    }
    if (drums) {
      if (s % 4 === 0) kick(t)
      if (s === 4 || s === 12) snare(t)
      if (s % 4 === 2) hat(t, 0.12)
      else if (s % 2 === 1) hat(t, 0.04)
    } else if (sec === 3 && s % 4 === 2) hat(t, 0.07)
    if (lead) {
      const note = LEAD_AT.get((bar % 4) * 16 + s)
      if (note) {
        const dur = note[2] * S16
        for (const d of [-6, 6]) {
          const v = voice('sawtooth', note[1], t, dur, { vol: 0.03, cut: 2600, a: 0.02, r: 0.12, detune: d, rev: 0.35, dl: 0.35 })
          v.o.frequency.setValueAtTime(mtof(note[1] - 0.4), t) // a little scoop into each note
          v.o.frequency.exponentialRampToValueAtTime(mtof(note[1]), t + 0.06)
        }
      }
    }
  }
  function tick() {
    while (nextT < ctx.currentTime + 0.15) {
      play16(step++, nextT)
      nextT += S16
    }
  }

  // ---------- on / off ----------
  function begin() {
    if (live || !on || !playing || !ctx || document.hidden) return
    live = true
    ctx.resume()
    const t = ctx.currentTime
    out.gain.cancelScheduledValues(t)
    out.gain.setValueAtTime(out.gain.value, t)
    out.gain.linearRampToValueAtTime(1, t + 1.2)
    if (!timer) {
      nextT = t + 0.1
      timer = setInterval(tick, 25)
      tick()
    }
  }
  function end() {
    if (!live) return
    live = false
    const t = ctx.currentTime
    out.gain.cancelScheduledValues(t)
    out.gain.setValueAtTime(out.gain.value, t)
    out.gain.linearRampToValueAtTime(0, t + 0.3)
    clearInterval(timer)
    timer = 0
    setTimeout(() => !live && ctx.suspend(), 400)
  }

  // The first click or key press anywhere unlocks audio.
  const gesture = () => {
    if (!ctx && !build()) return
    removeEventListener('pointerdown', gesture, true)
    removeEventListener('keydown', gesture, true)
    begin()
  }
  addEventListener('pointerdown', gesture, true)
  addEventListener('keydown', gesture, true)
  document.addEventListener('visibilitychange', () => (document.hidden ? end() : begin()))

  return {
    get on() {
      return on
    },
    setOn(v) {
      on = v
      try {
        localStorage.setItem(STORE, v ? 'on' : 'off')
      } catch {}
      if (v) {
        if (!ctx) build()
        begin()
      } else end()
    },
    start() {
      playing = true
      begin()
    },
    stop() {
      playing = false
      end()
    },
    // Music sits lower while a panel is open for reading.
    dim(v) {
      if (v === dimmed || !ctx) return
      dimmed = v
      music.gain.setTargetAtTime(v ? 0.24 : 0.42, ctx.currentTime, 0.3)
    },
    drive,
    pop,
    arrive,
    click,
    fanfare,
  }
}
