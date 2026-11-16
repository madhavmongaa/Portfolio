// Single source for every stop. Feeds the 3D markers, the panel and the list view.
// Lines marked CONFIRM were written without facts from Madhav and should be checked.

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
    metaLabel: 'Stack',
    meta: ['React 19', 'TypeScript', 'Tailwind CSS', 'Gemini', 'Firebase', 'Google Maps'],
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
      'A voice agent that bargains with vendors on your behalf.',
      // CONFIRM: how it works
      'You tell it what you want and the price you would accept. It does the talking, holds the line on your number, and comes back with the deal.',
    ],
    metaLabel: 'Stack',
    meta: ['Voice AI', 'LLM agent'], // CONFIRM
    links: [],
  },
  {
    id: 'campus',
    title: 'Campus Life Club',
    kind: 'Cultural head, Zenith School of AI',
    summary: [
      'I lead the cultural side of the Campus Life Club at Zenith School of AI.',
      // CONFIRM: event names and numbers
      'That means taking an event from an idea to the day itself: the plan, the people, and whatever goes wrong an hour before it starts.',
    ],
    metaLabel: 'Role',
    meta: ['Cultural head', 'Event planning', 'Team lead'],
    links: [],
  },
  {
    id: 'shorts',
    title: 'Faceless 3D shorts',
    kind: 'Blender and Claude video pipeline',
    summary: [
      'Short 3D videos made without anyone on camera.',
      // CONFIRM: who does what in the pipeline
      'Claude helps write the script and the scene code, and Blender builds and renders it, so one person can take a short from idea to finished video.',
    ],
    metaLabel: 'Stack',
    meta: ['Blender', 'Claude', 'Python'],
    links: [],
  },
  {
    id: 'about',
    title: 'About and contact',
    kind: 'Madhav Monga',
    summary: [
      'I am a first-year BTech student in Artificial Intelligence at Zenith School of AI, K.R. Mangalam University, Gurugram.',
      'I like building small AI products that do one useful thing, and making things in 3D. If you want to build something together, write to me.',
    ],
    metaLabel: 'Based in',
    meta: ['Gurugram, India'],
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
