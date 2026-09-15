/* SPACE JUNK copy deck. Every word a visitor reads lives here.
   Rules: never name a role. Show the lens side and the terminal side by what
   the objects are, not by a label. No em dashes. Numbers only if verified.
   Lines under ~28 chars so the 2048px type canvas never crops. */

/* World-type, depth-ordered. `at` is a fraction of the full descent (0..1).
   The tunnel places each line once at its depth; nothing loops. */
export const DESCENT = [
  {at:0.00, text:"EVERYTHING I HAVE EVER MADE"},
  {at:0.04, text:"IS STILL UP HERE"},
  {at:0.08, text:"SOME OF IT STILL WORKS"},
  {at:0.11, text:"HOLD SPACE TO SLOW DOWN"},
  {at:0.13, text:"THE GOOD ONES GO BY FAST"},
  {at:0.17, text:"SOME OF IT WAS SHOT AT 24"},
  {at:0.27, text:"SOME OF IT NEEDED A TERMINAL"},
  {at:0.36, text:"I STOPPED KEEPING SCORE"},
  {at:0.53, text:"TOUCH ONE. IT WILL TALK."},
  {at:0.58, text:"THE SEALED ONES WON'T OPEN"},
  {at:0.62, text:"YOU CAN STILL READ THEM"},
  {at:0.66, text:"THE DARK ONES ARE DEAD"},
  {at:0.70, text:"THEY TAUGHT ME THE MOST"},
  {at:0.76, text:"I NEVER PICKED A LANE"},
  {at:0.80, text:"I PICKED A FALL"},
  {at:0.90, text:"YOU ARE NEARLY AT THE BOTTOM"},
  {at:0.95, text:"I AM DOWN HERE"}
];

/* ACT 2. After "I PICKED A FALL" the audience loses control. The robot falls through a
   sequence of voids, each a different luminous universe, authored and music-timed, then the END.
   `look` names a tunnel.js void; `secs` is the dwell; `pose` is the figure's pose; `text` is optional
   world type that lands mid-void. Scroll and keys are ignored until the END; a bracketed SKIP exists. */
export const ACT2 = {
  handoff:"I PICKED A FALL",
  skip:"SKIP",
  /* Three phases after the hand-off. Input: steering stays live, forward speed is authored. */
  memory:{
    secs:7, speed:0.9,
    title:"AND THEN THERE WAS ALL OF THIS",
    tail:"THAT WAS THE POINT",
    manifest:"assets/memories/manifest.json"   /* clips and photos Kirtan supplies; see the README there */
  },
  plunge:{
    secs:10,
    speeds:[2.4,4.0,5.5,7.0],        /* ramps through these, eased, over the phase */
    dealEvery:0.4,                     /* seconds between colour + shape deals (also on every beat) */
    shapes:["cube","octa","tetra","ico","lattice","stairs","rings","shards"],
    /* the plunge is a cut list: each stage is a distinct room, in order, about secs/stages each; the tunnel owns the looks */
    stages:["cubes","lattice","stairs","inverse","rings","shards","cubes-wave","collapse"],
    text:"FROM EVERYWHERE AT ONCE"
  },
  landing:{
    secs:4,
    text:"I AM DOWN HERE"
  }
};

/* The very end. CRT-headed figure, his face on the screen. Lines land one at a time.
   This is the ONE place roles are named. Everything above it only showed the work. */
export const END = {
  lines:["HI. I MADE ALL OF THAT.","SOME OF IT ON PURPOSE."],
  name:"KIRTAN PUROHIT",
  roles:"CREATIVE PRODUCER. FILMMAKER. DEVELOPER.",
  line:"A soul that yearns for the scream of the creative muse.",
  cta:"FOR WORK, WRITE TO ME",
  email:"purohit.krick@gmail.com",
  links:[
    {label:"INSTAGRAM", url:"https://instagram.com/kirtanheypurohit"},
    {label:"THE OTHER INSTAGRAM", url:"https://instagram.com/kirtancreative"},
    {label:"YOUTUBE", url:"https://youtube.com/@Kirtanpurohit"}
  ],
  outro:"GO BACK UP. YOU MISSED SOME."   /* replaced at runtime by GAME.missed / GAME.clean */,
  credit:"MUSIC: \"SIX COFFIN NAILS\" BY KEROSYN, VIA BREAKINGCOPYRIGHT"
};

/* Neon palette: muted, never poppy. Every logo, name and text line gets a thin border in one of these. */
export const NEON = {
  teal:"#6fcfd2", magenta:"#c78fc4", amber:"#d8b46e", mint:"#8fcfa6", violet:"#a493d3", slate:"#7f93a6",
  byAccent:{"#3fe9ff":"#6fcfd2","#ffc247":"#d8b46e","#7dffc4":"#8fcfa6","#9a6bff":"#a493d3","#ff2d78":"#c78fc4","#597484":"#7f93a6"}
};

/* GAME. Fly the robot through a thing to log it. Counter top centre. */
export const GAME = {
  counter:"LOGGED {n} / {total}",
  logged:"LOGGED",          /* toast on pickup */
  scanned:"SCANNED",        /* toast on a sealed one */
  revived:"LOGGED. STILL DEAD.",   /* toast on a dark one */
  missed:"YOU MISSED {n}. GO BACK UP.",
  clean:"YOU FOUND ALL OF IT. NOBODY DOES THAT.",
  hint:"FLY THROUGH THINGS"    /* replaces CLICK A LOGO in the legend */
};

/* LOADER. Two seconds, two instructions, then any key or click drops you in. */
export const LOADER = {
  lines:[
    {key:"W",   text:"ACCELERATE"},
    {key:"◀ ▲ ▶ ▼", text:"MOVE"}
  ],
  ready:"PRESS ANY KEY",
  loading:"LOADING",
  hint:"SOUND ON. HEADPHONES HELP.",
  touch:[
    {key:"DRAG", text:"FALL"},
    {key:"TAP",  text:"OPEN"}
  ],
  touchReady:"TAP TO START"
};

/* Chrome. Only three things on screen besides the fall. */
export const CHROME = {
  name:"KIRTAN PUROHIT",          /* top left, nothing under it */
  contact:"CONTACT ME DIRECTLY",  /* top right, jumps to the END */
  unit:"c"                        /* the speed readout suffix, the only number left */
};

/* HUD state words, keyed by the flags the frame loop already computes. */
export const HUD = {
  still:"HOLDING STILL",
  falling:"FALLING",
  braking:"BRAKING",
  slowed:"TIME BENT",
  fast:"NEAR C",
  inspecting:"READING",
  dark:"DARK",            /* suffix on dead cards */
  classified:"SEALED",    /* suffix on agency cards, never linked */
  sealedNote:"SEALED. READ ONLY.",   /* replaces the OPEN button on classified cards */
  darkNote:"DEAD. NOTHING TO OPEN.", /* replaces the OPEN button on dark cards */
  release:"CLICK ANYWHERE OR ESC TO LET GO  /  ENTER OPENS IT",
  open:"OPEN IT",
  absurd:"THIS IS NOT PHYSICS"   /* state word above 12c; there is no speed cap */
};

/* Per-object blurbs. Matched by slug first, then by exact uppercase name.
   First person, one concrete thing, one honest thing. Under ~110 chars.
   THE LIST IS KIRTAN'S (2026-09-14). state: live (linked) | classified (agency, described, never linked) | dark (dead or parked).
   Camera work is NOT here yet: Kirtan supplies the cleared list. */
export const PROJECTS = [
  {slug:"clapper",       name:"CLAPPER",      kind:"On-set app", state:"live",     accent:"#9a6bff", url:"https://clapper.in",
   blurb:"A shot logger for the phone in your pocket on set. Ten people use it for real. Two have exported. Working on the other eight."},
  {slug:"cravache",      name:"CRAVACHE",     kind:"Game", state:"live",           accent:"#ff2d78", url:"https://cravmore.com",
   blurb:"Pixel survival sim about an ad agency. Every client is a boss fight. Playable at cravmore.com."},
  {slug:"page-22",       name:"PAGE 22",      kind:"Game", state:"live",           accent:"#ff2d78", url:"https://kirtan-00.github.io/reneev-tower/",
   blurb:"Crane stacking game for a real tower. One rule: never show the fall."},
  {slug:"postinnator",   name:"POSTINNATOR",  kind:"SaaS", state:"live",           accent:"#9a6bff", url:"https://postinnator.duckdns.org",
   blurb:"LinkedIn scheduling for people who would rather not open LinkedIn. It emails you for a yes first."},
  {slug:"deepdive",      name:"DEEPDIVE",     kind:"IG autopilot", state:"live",   accent:"#7dffc4", url:"https://instagram.com/thedeepdivemarketing",
   blurb:"162,000 people get ten posts a day from one server. I check on it like a plant."},
  {slug:"sportified",    name:"SPORTIFIED",   kind:"IG autopilot", state:"live",   accent:"#7dffc4", url:"https://instagram.com/thesportified",
   blurb:"A World Cup that posted itself. Fixtures in at midnight, reels out by breakfast, nobody at the desk."},
  {slug:"deepdive-blog", name:"THE BLOG",     kind:"Daily writing", state:"live",  accent:"#ffc247", url:"https://thedeepdivemarketing.com/",
   blurb:"One long read a day about why an ad worked. Written, published and posted to LinkedIn without me touching it."},
  {slug:"sparks",        name:"LITPRO",       kind:"DOP lighting pre-production tool", state:"live",        accent:"#9a6bff", url:"https://kirtan-00.github.io/sparks/",
   blurb:"Plan the lights before the truck arrives. Angles, distances, stops, on a phone. The numbers are the product."},
  {slug:"bill-please",   name:"BILL PLEASE",  kind:"WhatsApp bot", state:"dark",   accent:"#7dffc4", url:null,
   blurb:"Talk to WhatsApp, get a GST invoice. The server died. The idea did not."},
  {slug:"deepdive-intro",name:"THE INTRO",    kind:"Scroll film",    state:"live", accent:"#3fe9ff", url:"https://thedeepdivemarketing.com/intro",
   blurb:"A scroll you drive with your thumb. The whole agency pitch, no video file, no play button."},
  /* CLASSIFIED: agency tools. Described, never linked. Stamped SEALED on the card. */
  {slug:"retain-plus",   name:"RETAIN+",      kind:"Agency tool",    state:"classified", accent:"#597484", url:null,
   blurb:"Every Monday, 08:30, every client's week lands in one email. Nobody opens a dashboard any more."},
  {slug:"autocut",       name:"AUTOCUT",      kind:"Edit suite",     state:"classified", accent:"#597484", url:null,
   blurb:"Cuts the first pass of an edit on its own. 4K in, proxies out, two places a human has to say yes."},
  {slug:"letters",       name:"LETTERS",      kind:"HR tool",        state:"classified", accent:"#597484", url:null,
   blurb:"Generates HR letters that match the originals to the pixel. Boring on purpose."},
  /* DARK: dead, parked, or never shipped. Dim, flickering, no link. */
  {slug:"expense",       name:"EXPENSE",      kind:"Telegram bot",   state:"dark", accent:"#7dffc4", url:null,
   blurb:"Receipts in on Telegram, reimbursement PDFs out. A finance team accepted them. Then it went quiet."},
  {slug:"artemis",       name:"ARTEMIS",      kind:"Venture memo",   state:"dark", accent:"#9a6bff", url:null,
   blurb:"Escrow for freelancers. Seven versions of the memo. Zero lines of code. Yet."},
  {slug:"equaliser",     name:"EQUALISER",    kind:"Stock bot",      state:"dark", accent:"#7dffc4", url:null,
   blurb:"A paper trader that reads the mood of the market. Parked, dignity intact."},
  {slug:"stock-bot",     name:"STOCK BOT",    kind:"Prediction bot", state:"dark", accent:"#7dffc4", url:null,
   blurb:"Ten stocks a day with a confidence score. Parked. The confidence was the problem."},
  {slug:"flyingnode",    name:"FLYINGNODE",   kind:"Fare alerts",    state:"dark", accent:"#7dffc4", url:null,
   blurb:"Watches airfares for typos and tells me before the airline notices. Runs for one person."},
  {slug:"munimji",       name:"MUNIMJI",      kind:"Cashflow bot",   state:"dark", accent:"#7dffc4", url:null,
   blurb:"Say what you spent. It keeps the book. Whole rupees only. Audience of one."},
  {slug:"home-tour",     name:"HOME TOUR",    kind:"Phone 360",      state:"dark", accent:"#9a6bff", url:null,
   blurb:"Point your phone, get a 360. It works. Nobody will pay for it. Both true."},
  {slug:"scale-of-things",name:"SCALE OF",    kind:"Scroll piece",   state:"dark", accent:"#ff2d78", url:null,
   blurb:"AI valuations drawn to scale on one very long scroll. Built. Never shipped."},
  {slug:"youload",       name:"YOULOAD",      kind:"Chrome ext",     state:"dark", accent:"#9a6bff", url:null,
   blurb:"One click and the YouTube clip is in the edit bin. Built for the suite, never published."},
  {slug:"hu-kon-chu",    name:"HU KON CHU",   kind:"Sci-fi short",   state:"dark", accent:"#ffc247", url:null,
   blurb:"Five-minute sci-fi in modern Ahmedabad. Mood board done. Script not."},
  {slug:"ledger",        name:"LEDGER",       kind:"This site, v1",  state:"dark", accent:"#597484", url:null,
   blurb:"This site, one version ago. Read too much like a CV. Retired."},
];
export const BLURBS = Object.fromEntries(PROJECTS.map(p=>[p.slug,p.blurb]));


/* THE LENS SECTION. Client work Kirtan has cleared (2026-09-15). Hovering logos, no cards.
   Click plays the YouTube playlist in the inspect panel. playlist: YouTube playlist id, null until he sends it.
   Blurbs in his words, tightened. Never name a client he has not cleared. */
export const LENS_TITLE = "SOME OF IT NEEDED A LENS";
export const CLIENTS = [
  {slug:"gujarat-titans", name:"GUJARAT TITANS", kind:"IPL franchise", accent:"#3fe9ff", playlist:null,
   blurb:"On set and in the edit for a title-winning side. Cricketers, film stars, one camera, no second takes. Dozens of cuts, every sheet closed before the next match."},
  {slug:"zepto",          name:"ZEPTO",          kind:"Quick commerce", accent:"#9a6bff", playlist:null,
   blurb:"Made and curated the stuff that went viral for India's fastest delivery brand. Ten minutes, and a joke to match."},
  {slug:"palladium",      name:"PALLADIUM",      kind:"Mall brand",     accent:"#ffc247", playlist:null,
   blurb:"Films and CGI for the biggest mall brand in the country. Celebrity shoots between real escalators and fake gravity."},
  {slug:"crav-social",    name:"CRAV SOCIAL",    kind:"Social page",    accent:"#ff2d78", playlist:null,
   blurb:"A page built to go viral on purpose. Funny first, brand second, numbers third."}
];
/* THE PRODUCTION PROPS. Three built objects in the lens ring, not logos: what he makes with a crew.
   Each is a 3D prop (assets/props.js) and a pickup like the client marks. playlist: YouTube playlist id, null until he sends it.
   Order in the ring: dvc, reels, truck, then the four client marks. */
export const PRODUCTION = [
  {slug:"dvc",   name:"THE DVCs",     kind:"Digital video commercials", prop:"screen", accent:"#ffc247", playlist:null,
   blurb:"Thirty seconds a brand has to be loved in. Written, lit, shot, cut and delivered, with the client on set."},
  {slug:"reels", name:"THE REELS",    kind:"Viral short-form",          prop:"phone",  accent:"#ff2d78", playlist:null,
   blurb:"Vertical, nine by sixteen, made to be sent to someone. Funny first, brand second. The ones that travelled, travelled far."},
  {slug:"truck", name:"THE SHOOTS",   kind:"Ads and films",             prop:"truck",  accent:"#3fe9ff", playlist:null,
   blurb:"A truck of lights, a truck of cameras, and a call time nobody liked. The ads and films that needed all of it."}
];
export const LENS_HUD = {
  play:"PLAY THE REEL",
  playing:"PLAYING  /  ESC TO LEAVE",
  noReel:"REEL COMING. ASK ME."
};

/* Name aliases so the loader can match a JSON `name` field too. */
export const NAME_TO_SLUG = Object.fromEntries(PROJECTS.map(p=>[p.name,p.slug]));

/* Entries that must NOT appear until Kirtan clears them (NDA / client / removed). */
export const BLOCKED = ["DVC / GT","KABIR","EKLINGJI","VAULT","NAVRATRI","NAVRATRI II","PYC 24","CELLULOID","CADENCE","PACK SHOT","REEL 019","PALLADIUM","DEV REALITIES"];
