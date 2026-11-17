// Single source for every stop. Feeds the 3D markers, the panel and the list view.
// `facts` are label/value rows shown under the summary. `preview` is a short muted loop.

export const person = {
  name: 'Madhav Monga',
  line: 'First-year BTech student in Artificial Intelligence at Zenith School of AI, Gurugram.',
}

export const projects = [
  {
    id: 'wastewise',
    title: 'WasteWise',
    kind: 'AI waste-sorting assistant',
    summary: [
      'Snap or describe any item and Lulu, the assistant inside the app, tells you which bin it goes in and how to prepare it.',
      'Gemini identifies the item and has to choose one of five bins that follow Indian segregation practice: dry, wet, hazardous, reject or e-waste. If it is not sure what it is looking at, it asks one question first. Points, streaks and an area leaderboard give people a reason to keep sorting. Built for the Equinox hackathon.',
    ],
    facts: [['Stack', ['React 19', 'TypeScript', 'Tailwind CSS', 'Gemini', 'Firebase', 'Google Maps']]],
    links: [
      { label: 'Live app', href: 'https://equinox-hackathon-wastewise-alpha.vercel.app' },
      { label: 'Source', href: 'https://github.com/madhavmongaa/equinox-hackathon-wastewise' },
    ],
  },
  {
    id: 'mandi',
    title: 'Mandi',
    kind: 'Voice AI that negotiates for you',
    summary: [
      'A voice AI agent that negotiates prices with vendors on your behalf.',
      'Our entry for Startup Buildathon India 2026 (Google x Hack2Skill), Delhi round. We are a team of two, I am co-founder and CEO, and we plan to build it into a company.',
    ],
    // ASK: stack, how it works under the hood, demo or repo link
    facts: [
      ['Event', ['Startup Buildathon India 2026']],
      ['Role', ['Co-founder & CEO']],
    ],
    links: [],
  },
  {
    id: 'campus',
    title: 'Campus Life Club',
    kind: 'Cultural Head, Zenith School of AI (2026-27)',
    summary: ['I run the cultural side of the Campus Life Club.'],
    facts: [],
    links: [],
  },
  {
    id: 'reels',
    title: '3D Absurd Reels',
    kind: 'Claude Code skill · animated 3D shorts, 100% code',
    summary: [
      'A Claude Code skill that turns one idea into a finished 9:16 animated 3D short. There is no video editor, no stock footage and no AI video model: every frame, voice line and sound comes from code.',
      'three.js scenes rendered through Remotion, an offline Kokoro voice with whisper word timing, sound effects and music synthesized in Python, and a QA script that checks every frame and the loudness before anything gets posted. Five formats, each with a full example reel: The Cloud Guy, Elevator, Crow Court, Kong’s Penny and Float Town.',
    ],
    facts: [['Stack', ['three.js', 'Remotion', 'React', 'TypeScript', 'Python', 'Claude Code']]],
    preview: { src: 'media/float-town.mp4', poster: 'media/float-town.jpg', label: 'Float Town, made with the skill' },
    links: [
      { label: 'Source', href: 'https://github.com/madhavmongaa/3d-absurd-reels' },
      { label: 'Watch', href: 'https://www.instagram.com/thatssorandomfacts/' },
    ],
  },
  {
    id: 'about',
    title: 'About and contact',
    kind: 'Madhav Monga',
    summary: [
      'I am a first-year BTech student in Artificial Intelligence at Zenith School of AI, K.R. Mangalam University, Gurugram.',
      'I like building small AI products that do one useful thing, and making things in 3D. Away from the keyboard I beatbox and follow fashion. If you want to build something together, write to me.',
    ],
    facts: [
      ['Based in', ['Gurugram, India']],
      ['Daily tools', ['Claude Code', 'GitHub Copilot']],
      [
        'Skills',
        [
          'JavaScript', 'TypeScript', 'React', 'Node.js', 'Python', 'Three.js', 'Remotion', 'Blender', 'FFmpeg',
          'HTML', 'CSS', 'NumPy', 'Shell scripting', 'MongoDB', 'MySQL', 'SQL', 'Software Testing', 'GitHub',
          'Claude', 'Prompt Engineering',
        ],
      ],
    ],
    links: [
      { label: 'madhavmongaa@gmail.com', href: 'mailto:madhavmongaa@gmail.com' },
      { label: 'GitHub', href: 'https://github.com/madhavmongaa' },
      { label: 'LinkedIn', href: 'https://www.linkedin.com/in/madhav-monga-681558406/' },
      { label: 'Instagram', href: 'https://www.instagram.com/madhavmongaa/' },
    ],
    // Required by the model's licence. Keep this if the car stays.
    credit: {
      text: 'Car model: "Porsche 911 Carrera S (991.2)" by Mona x Supercars, CC BY 4.0, repainted black.',
      href: 'https://sketchfab.com/3d-models/porsche-911-carrera-s-9912-e8e06ddd8d3f4419a5252d187f6f217e',
    },
  },
]
