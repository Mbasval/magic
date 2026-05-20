const canvas = document.querySelector("#scene");
const ctx = canvas.getContext("2d", { alpha: false });
const music = document.querySelector("#bg-music");

const TAU = Math.PI * 2;
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
const lowPower = prefersReducedMotion || isCoarsePointer || window.innerWidth < 760;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const map = (value, a, b, c, d) => c + ((value - a) / (b - a)) * (d - c);

function mulberry32(seed) {
  return function random() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hslToRgb(h, s, l) {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp >= 0 && hp < 1) [r, g, b] = [c, x, 0];
  else if (hp >= 1 && hp < 2) [r, g, b] = [x, c, 0];
  else if (hp >= 2 && hp < 3) [r, g, b] = [0, c, x];
  else if (hp >= 3 && hp < 4) [r, g, b] = [0, x, c];
  else if (hp >= 4 && hp < 5) [r, g, b] = [x, 0, c];
  else if (hp >= 5 && hp < 6) [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

function colorString(color, alpha = 1) {
  return `rgba(${color.r | 0}, ${color.g | 0}, ${color.b | 0}, ${alpha})`;
}

function mixColor(from, to, amount) {
  return {
    r: lerp(from.r, to.r, amount),
    g: lerp(from.g, to.g, amount),
    b: lerp(from.b, to.b, amount)
  };
}

function whiteShade(index) {
  const centered = index - 3;
  return hslToRgb(210 + centered * 4.8, 11 + Math.abs(centered) * 2, 90 + index);
}

const PALETTES = [
  { name: "blue", h: 203, s: 100, l: 62 },
  { name: "red", h: 350, s: 100, l: 60 },
  { name: "yellow", h: 53, s: 100, l: 58 },
  { name: "green", h: 137, s: 100, l: 60 },
  { name: "orange", h: 29, s: 100, l: 58 },
  { name: "pink", h: 315, s: 100, l: 66 },
  { name: "purple", h: 262, s: 100, l: 68 },
  { name: "cyan", h: 180, s: 100, l: 60 }
];

function shadeFromPalette(palette, index, total = 7, lift = 0) {
  const centered = index - (total - 1) / 2;
  return hslToRgb(
    (palette.h + centered * 2.6 + 360) % 360,
    clamp(palette.s + Math.abs(centered) * 2, 78, 100),
    clamp(palette.l + centered * 3 + lift, 48, 82)
  );
}

const state = {
  dpr: 1,
  width: 1,
  height: 1,
  time: 0,
  lastTime: performance.now(),
  floorTop: 0,
  pointer: { x: 0, y: 0, tx: 0, ty: 0, px: 0, py: 0, speed: 0, active: false },
  fungi: [],
  stars: [],
  butterflies: [],
  activeFungus: null,
  infused: new Set(),
  ascended: false
};

function polygon(points) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
}

function spawnStars() {
  const random = mulberry32(1033);
  const count = Math.floor(clamp((state.width * state.height) / 30000, 18, 52));
  state.stars = Array.from({ length: count }, (_, i) => ({
    x: random() * state.width,
    y: random() * state.height * 0.76,
    r: random() * 1.15 + 0.3,
    twinkle: random() * 1.5 + 0.4,
    phase: random() * TAU,
    color: whiteShade(i % 7)
  }));
}

function buildLandingSpots(index, capX, capY, capWidth, capHeight) {
  const random = mulberry32(1700 + index * 101);
  const total = 16;
  return Array.from({ length: total }, (_, i) => {
    const ring = i < 8 ? 0.28 : 0.45;
    const angle = (i / total) * TAU + random() * 0.35;
    return {
      ox: Math.cos(angle) * capWidth * ring + (random() - 0.5) * capWidth * 0.08,
      oy: -capHeight * (0.05 + ring * 0.35) + Math.sin(angle) * capHeight * 0.12,
      phase: random() * TAU
    };
  });
}

function buildFungusFacets(index) {
  const random = mulberry32(8100 + index * 73);
  return Array.from({ length: lowPower ? 3 : 5 }, () => ({
    ax: random() * 0.9 - 0.5,
    ay: random() * 0.78 - 0.5,
    bx: random() * 0.77 - 0.25,
    by: random() * 0.74 - 0.42,
    cx: random() * 0.92 - 0.42,
    cy: random() * 0.7 - 0.2,
    shade: random() * 28 - 12,
    alpha: random() * 0.18 + 0.15
  }));
}

function layoutFungi() {
  const width = state.width;
  const height = state.height;
  state.floorTop = height - clamp(height * 0.18, 86, 170);
  const edge = clamp(width * 0.075, 24, 108);
  const usable = width - edge * 2;
  const compact = width < 680;
  const baseScale = clamp(width / 1250, 0.56, 1.18);
  const random = mulberry32(5002);
  const sizes = [1.18, 0.86, 1.05, 0.78, 1.3, 0.92, 1.08, 0.82];
  const types = ["dome", "bell", "umbrella", "spire", "shelf", "dome", "bell", "fan"];

  state.fungi = PALETTES.map((palette, index) => {
    const t = index / (PALETTES.length - 1);
    const x = edge + usable * t + Math.sin(t * Math.PI * 3.15) * (compact ? 8 : 18);
    const scale = baseScale * sizes[index] * (compact ? 0.72 : 1);
    const stemHeight = clamp(48 * scale + Math.sin(index * 1.7) * 9 + (random() * 10 - 4), 30, 86);
    const capWidth = clamp(74 * scale, compact ? 34 : 54, compact ? 58 : 118);
    const capHeight = clamp(38 * scale, compact ? 20 : 28, compact ? 40 : 74);
    const baseY = height - (compact ? 8 + random() * 16 : 12 + random() * 22);
    const capY = baseY - stemHeight;
    const capX = x + Math.sin(index * 2.1) * capWidth * 0.05;
    return {
      id: index,
      palette,
      type: types[index],
      x,
      y: baseY,
      capX,
      capY,
      capWidth,
      capHeight,
      stemWidth: clamp(capWidth * 0.25, 12, 32),
      interactionRadius: clamp(capWidth * 1.2 + 28, 58, compact ? 88 : 138),
      landingSpots: buildLandingSpots(index, capX, capY, capWidth, capHeight),
      facets: buildFungusFacets(index)
    };
  });
}

class Butterfly {
  constructor(index, bornColored = false) {
    const random = mulberry32(9000 + index * 41);
    this.index = index;
    this.x = random() * state.width;
    this.y = random() * state.height * 0.48 + state.height * 0.15;
    this.vx = random() * 36 - 18;
    this.vy = random() * 36 - 18;
    this.phase = random() * TAU;
    this.flap = random() * 0.6 + 0.8;
    this.scale = (random() * 0.34 + 1.02) * (bornColored ? 1.03 : 1);
    this.wander = random() * TAU;
    this.personal = index % PALETTES.length;
    this.color = bornColored ? shadeFromPalette(PALETTES[this.personal], index % 7, 7, 8) : whiteShade(index % 7);
    this.white = whiteShade(index % 7);
    this.homeX = random() * state.width;
    this.homeY = random() * state.height * 0.72;
    this.resting = false;
  }

  update(dt, index, neighbors) {
    const pointerMoving = state.pointer.speed > (lowPower ? 90 : 65);
    const activeFungus = state.activeFungus;
    this.phase += dt * this.flap * (this.resting ? 3.1 : 9.3);
    this.wander += dt * 1.55;

    let targetX = state.pointer.x;
    let targetY = state.pointer.y;
    let pull = 4.2;
    let maxSpeed = lowPower ? 115 : 150;
    let desiredColor = this.white;
    this.resting = false;

    if (activeFungus) {
      const spot = activeFungus.landingSpots[index % activeFungus.landingSpots.length];
      const pulse = Math.sin(state.time * 0.8 + spot.phase) * 0.05;
      targetX = activeFungus.capX + spot.ox * (1 + pulse);
      targetY = activeFungus.capY + spot.oy - Math.cos(state.time * 0.7 + spot.phase) * 2.4;
      desiredColor = shadeFromPalette(activeFungus.palette, index % 7, 7, 7);
      pull = 2.8;
      maxSpeed = 90;
      const dRest = dist(this.x, this.y, targetX, targetY);
      this.resting = dRest < activeFungus.capWidth * 0.24;
      state.infused.add(activeFungus.id);
    } else if (state.ascended) {
      if (pointerMoving) {
        const dx = this.x - state.pointer.x;
        const dy = this.y - state.pointer.y;
        const d = Math.max(Math.hypot(dx, dy), 0.001);
        const repel = clamp(map(d, 12, 190, 1, 0), 0, 1);
        targetX = this.x + (dx / d) * 180 * repel + Math.cos(this.wander + index * 0.7) * 22;
        targetY = this.y + (dy / d) * 180 * repel + Math.sin(this.wander * 1.2 + index) * 18;
      } else {
        const roamR = 26 + (index % 9) * 7;
        const angle = state.time * (0.34 + (index % 7) * 0.04) + index * 1.17;
        targetX = this.homeX + Math.cos(angle) * roamR + Math.sin(this.wander) * 14;
        targetY = this.homeY + Math.sin(angle * 1.2) * roamR * 0.58 + Math.cos(this.wander * 0.8) * 10;
      }
      desiredColor = shadeFromPalette(PALETTES[this.personal], index % 7, 7, 8);
      pull = 2.3;
      maxSpeed = lowPower ? 120 : 155;
    } else {
      const ring = 35 + (index % 7) * 12;
      const angle = state.time * (0.82 + (index % 5) * 0.09) + index * 1.9;
      targetX += Math.cos(angle) * ring + Math.sin(this.wander * 1.35) * 24;
      targetY += Math.sin(angle * 1.21) * ring * 0.62 + Math.cos(this.wander) * 18;
      pull = 3.5;
      maxSpeed = lowPower ? 126 : 164;
    }

    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const d = Math.max(Math.hypot(dx, dy), 0.001);
    const desiredSpeed = this.resting ? clamp(d * 1.2, 10, 48) : clamp(d * 1.8, 22, maxSpeed);
    let desiredVx = (dx / d) * desiredSpeed;
    let desiredVy = (dy / d) * desiredSpeed;

    const wanderAmp = this.resting ? 4 : 22;
    desiredVx += Math.cos(this.wander * 2 + this.phase * 0.2) * wanderAmp;
    desiredVy += Math.sin(this.wander * 1.6 - this.phase * 0.23) * wanderAmp * 0.82;

    let sepX = 0;
    let sepY = 0;
    const comfort = this.resting ? 24 : 20;
    for (const other of neighbors) {
      if (other === this) continue;
      const ox = this.x - other.x;
      const oy = this.y - other.y;
      const od = Math.hypot(ox, oy);
      if (od > 0 && od < comfort) {
        const force = ((comfort - od) / comfort) * (this.resting ? 28 : 52);
        sepX += (ox / od) * force;
        sepY += (oy / od) * force;
      }
    }
    desiredVx += sepX;
    desiredVy += sepY;

    this.vx += (desiredVx - this.vx) * pull * dt;
    this.vy += (desiredVy - this.vy) * pull * dt;
    this.vx *= 1 - 0.04 * dt;
    this.vy *= 1 - 0.04 * dt;

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    const margin = 38;
    if (this.x < -margin) this.x = state.width + margin;
    if (this.x > state.width + margin) this.x = -margin;
    this.y = clamp(this.y, 26, state.height - 36);

    const colorBlend = activeFungus ? 3.2 : state.ascended ? 2.2 : 0.75;
    this.color = mixColor(this.color, desiredColor, clamp(dt * colorBlend, 0, 1));
  }

  draw() {
    const angle = Math.atan2(this.vy, this.vx);
    const flapSpeed = this.resting ? 0.5 : 1;
    const wingOpen = 0.55 + Math.abs(Math.sin(this.phase * flapSpeed)) * (this.resting ? 0.42 : 0.78);
    const compact = state.width < 620 ? 0.9 : 1;
    const size = 12 * this.scale * compact;
    const bodyLength = size * 1.5;
    const wingColor = this.color;
    const coreColor = mixColor(this.color, { r: 255, g: 255, b: 255 }, 0.3);

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(angle);
    ctx.globalCompositeOperation = "lighter";

    const leftWing = [
      { x: -size * 0.1, y: 0 },
      { x: -size * (1.25 + wingOpen * 0.28), y: -size * wingOpen },
      { x: -size * 0.46, y: -size * (1.75 + wingOpen * 0.1) },
      { x: size * 0.22, y: -size * 0.42 }
    ];
    const leftLower = [
      { x: -size * 0.12, y: 0 },
      { x: -size * (0.95 + wingOpen * 0.2), y: size * 0.7 },
      { x: -size * 0.25, y: size * (1.24 + wingOpen * 0.16) },
      { x: size * 0.18, y: size * 0.34 }
    ];

    drawWing(leftWing, wingColor, 0.84);
    drawWing(leftLower, mixColor(wingColor, coreColor, 0.22), 0.64);
    ctx.scale(1, -1);
    drawWing(leftWing, wingColor, 0.84);
    drawWing(leftLower, mixColor(wingColor, coreColor, 0.22), 0.64);
    ctx.scale(1, -1);

    ctx.fillStyle = colorString(coreColor, 0.96);
    ctx.beginPath();
    ctx.ellipse(0, 0, bodyLength * 0.35, size * 0.13, 0, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = colorString(coreColor, 0.45);
    ctx.lineWidth = 0.85;
    ctx.beginPath();
    ctx.moveTo(size * 0.22, -size * 0.05);
    ctx.quadraticCurveTo(size * 0.74, -size * 0.44, size * 0.95, -size * 0.78);
    ctx.moveTo(size * 0.22, size * 0.05);
    ctx.quadraticCurveTo(size * 0.74, size * 0.44, size * 0.95, size * 0.78);
    ctx.stroke();
    ctx.restore();
  }
}

function drawWing(points, color, alpha) {
  polygon(points);
  const g = ctx.createLinearGradient(points[1].x, points[1].y, points[3].x, points[3].y);
  g.addColorStop(0, colorString(mixColor(color, { r: 255, g: 255, b: 255 }, 0.38), alpha));
  g.addColorStop(1, colorString(color, alpha * 0.5));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = colorString(mixColor(color, { r: 255, g: 255, b: 255 }, 0.58), alpha * 0.28);
  ctx.lineWidth = 0.62;
  ctx.stroke();
}

function spawnButterflies(count, bornColored = false) {
  const start = state.butterflies.length;
  for (let i = 0; i < count; i += 1) state.butterflies.push(new Butterfly(start + i, bornColored));
}

function ensureAscension() {
  if (state.ascended || state.infused.size < PALETTES.length) return;
  state.ascended = true;
  const target = lowPower ? 32 : 54;
  const toAdd = Math.max(0, target - state.butterflies.length);
  spawnButterflies(toAdd, true);
}

function resize() {
  state.dpr = 1;
  state.width = window.innerWidth;
  state.height = window.innerHeight;
  canvas.width = Math.floor(state.width);
  canvas.height = Math.floor(state.height);
  canvas.style.width = `${state.width}px`;
  canvas.style.height = `${state.height}px`;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (!state.pointer.active) {
    state.pointer.x = state.width / 2;
    state.pointer.y = state.height * 0.42;
    state.pointer.tx = state.pointer.x;
    state.pointer.ty = state.pointer.y;
  }
  layoutFungi();
  spawnStars();
}

function findActiveFungus() {
  let closest = null;
  let closestD = Infinity;
  for (const fungus of state.fungi) {
    const d = dist(state.pointer.x, state.pointer.y, fungus.capX, fungus.capY - fungus.capHeight * 0.12);
    if (d < fungus.interactionRadius && d < closestD) {
      closest = fungus;
      closestD = d;
    }
  }
  state.activeFungus = closest;
}

function updatePointer(dt) {
  if (!state.pointer.active) {
    state.pointer.tx = state.width / 2 + Math.cos(state.time * 0.23) * state.width * 0.14;
    state.pointer.ty = state.height * 0.42 + Math.sin(state.time * 0.29) * state.height * 0.1;
  }
  state.pointer.px = state.pointer.x;
  state.pointer.py = state.pointer.y;
  state.pointer.x = lerp(state.pointer.x, state.pointer.tx, clamp(dt * 10, 0, 1));
  state.pointer.y = lerp(state.pointer.y, state.pointer.ty, clamp(dt * 10, 0, 1));
  state.pointer.speed = Math.hypot(state.pointer.x - state.pointer.px, state.pointer.y - state.pointer.py) / Math.max(dt, 0.001);
}

function update(dt) {
  state.time += dt;
  updatePointer(dt);
  findActiveFungus();
  for (let i = 0; i < state.butterflies.length; i += 1) {
    state.butterflies[i].update(dt, i, state.butterflies);
  }
  ensureAscension();
}

function drawBackground() {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, state.width, state.height);

  ctx.fillStyle = "rgba(255,255,255,0.012)";
  ctx.beginPath();
  ctx.arc(state.pointer.x, state.pointer.y, Math.max(state.width, state.height) * 0.15, 0, TAU);
  ctx.fill();

  for (const star of state.stars) {
    const a = 0.11 + Math.sin(state.time * star.twinkle + star.phase) * 0.06;
    ctx.fillStyle = colorString(star.color, a);
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.r, 0, TAU);
    ctx.fill();
  }
}

function drawFloor() {
  const top = state.floorTop;
  const h = state.height - top;
  const random = mulberry32(3021);
  ctx.fillStyle = "#020202";
  ctx.beginPath();
  ctx.moveTo(0, top + Math.sin(state.time * 0.22) * 1.8);
  for (let i = 0; i <= 16; i += 1) {
    const x = (i / 16) * state.width;
    const y = top + Math.sin(i * 1.7) * 6 + Math.cos(i * 0.7) * 4;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(state.width, state.height);
  ctx.lineTo(0, state.height);
  ctx.closePath();
  ctx.fill();

  for (let i = 0; i < 10; i += 1) {
    const x = random() * state.width;
    const y = top + random() * h;
    const w = map(random(), 0, 1, 18, 74);
    ctx.fillStyle = i % 3 === 0 ? "rgba(255,255,255,0.024)" : "rgba(255,255,255,0.013)";
    polygon([
      { x: x - w * 0.5, y: y + map(random(), 0, 1, -4, 4) },
      { x: x + w * 0.55, y: y + map(random(), 0, 1, -4, 4) },
      { x: x + w * 0.3, y: y + map(random(), 0, 1, 8, 24) },
      { x: x - w * 0.65, y: y + map(random(), 0, 1, 8, 26) }
    ]);
    ctx.fill();
  }
}

function capOutline(fungus) {
  const w = fungus.capWidth;
  const h = fungus.capHeight;
  const cx = fungus.capX;
  const cy = fungus.capY;
  if (fungus.type === "bell") {
    return [
      { x: cx - w * 0.45, y: cy + h * 0.32 }, { x: cx - w * 0.36, y: cy - h * 0.2 },
      { x: cx - w * 0.08, y: cy - h * 0.58 }, { x: cx + w * 0.18, y: cy - h * 0.52 },
      { x: cx + w * 0.42, y: cy - h * 0.08 }, { x: cx + w * 0.5, y: cy + h * 0.3 },
      { x: cx + w * 0.18, y: cy + h * 0.42 }, { x: cx - w * 0.16, y: cy + h * 0.38 }
    ];
  }
  if (fungus.type === "spire") {
    return [
      { x: cx - w * 0.48, y: cy + h * 0.34 }, { x: cx - w * 0.28, y: cy - h * 0.08 },
      { x: cx - w * 0.05, y: cy - h * 0.8 }, { x: cx + w * 0.22, y: cy - h * 0.12 },
      { x: cx + w * 0.5, y: cy + h * 0.34 }, { x: cx + w * 0.12, y: cy + h * 0.47 },
      { x: cx - w * 0.28, y: cy + h * 0.43 }
    ];
  }
  if (fungus.type === "shelf") {
    return [
      { x: cx - w * 0.56, y: cy + h * 0.12 }, { x: cx - w * 0.32, y: cy - h * 0.35 },
      { x: cx + w * 0.32, y: cy - h * 0.42 }, { x: cx + w * 0.62, y: cy - h * 0.08 },
      { x: cx + w * 0.48, y: cy + h * 0.28 }, { x: cx - w * 0.38, y: cy + h * 0.34 }
    ];
  }
  if (fungus.type === "fan") {
    return [
      { x: cx - w * 0.5, y: cy + h * 0.24 }, { x: cx - w * 0.5, y: cy - h * 0.18 },
      { x: cx - w * 0.22, y: cy - h * 0.54 }, { x: cx + w * 0.2, y: cy - h * 0.52 },
      { x: cx + w * 0.54, y: cy - h * 0.14 }, { x: cx + w * 0.46, y: cy + h * 0.3 },
      { x: cx + w * 0.05, y: cy + h * 0.42 }
    ];
  }
  if (fungus.type === "umbrella") {
    return [
      { x: cx - w * 0.58, y: cy + h * 0.28 }, { x: cx - w * 0.42, y: cy - h * 0.08 },
      { x: cx - w * 0.12, y: cy - h * 0.38 }, { x: cx + w * 0.2, y: cy - h * 0.36 },
      { x: cx + w * 0.52, y: cy - h * 0.03 }, { x: cx + w * 0.6, y: cy + h * 0.25 },
      { x: cx + w * 0.22, y: cy + h * 0.38 }, { x: cx - w * 0.28, y: cy + h * 0.36 }
    ];
  }
  return [
    { x: cx - w * 0.54, y: cy + h * 0.22 }, { x: cx - w * 0.38, y: cy - h * 0.18 },
    { x: cx - w * 0.05, y: cy - h * 0.48 }, { x: cx + w * 0.28, y: cy - h * 0.34 },
    { x: cx + w * 0.52, y: cy + h * 0.08 }, { x: cx + w * 0.42, y: cy + h * 0.35 },
    { x: cx + w * 0.05, y: cy + h * 0.43 }, { x: cx - w * 0.36, y: cy + h * 0.34 }
  ];
}

function drawFungus(fungus) {
  const active = state.activeFungus === fungus;
  const infused = state.infused.has(fungus.id);
  const pulse = active ? 0.12 + Math.sin(state.time * 2.1) * 0.08 : infused ? 0.09 : 0;
  const base = shadeFromPalette(fungus.palette, fungus.id, PALETTES.length, active ? 14 : 4);
  const muted = hslToRgb(fungus.palette.h, clamp(fungus.palette.s * 0.65, 40, 100), active ? 48 : 36);
  const stemTopX = fungus.capX;

  const stem = [
    { x: fungus.x - fungus.stemWidth * 0.58, y: fungus.y },
    { x: fungus.x + fungus.stemWidth * 0.55, y: fungus.y },
    { x: stemTopX + fungus.stemWidth * 0.36, y: fungus.capY + fungus.capHeight * 0.32 },
    { x: stemTopX - fungus.stemWidth * 0.4, y: fungus.capY + fungus.capHeight * 0.32 }
  ];
  polygon(stem);
  const stemG = ctx.createLinearGradient(fungus.x, fungus.y, stemTopX, fungus.capY);
  stemG.addColorStop(0, "rgba(10,10,10,1)");
  stemG.addColorStop(0.58, colorString(mixColor(muted, { r: 0, g: 0, b: 0 }, 0.58), 0.9));
  stemG.addColorStop(1, colorString(mixColor(base, { r: 0, g: 0, b: 0 }, 0.32), 0.86));
  ctx.fillStyle = stemG;
  ctx.fill();
  ctx.strokeStyle = colorString(mixColor(base, { r: 255, g: 255, b: 255 }, 0.28), 0.24 + pulse * 0.3);
  ctx.lineWidth = 1;
  ctx.stroke();

  const cap = capOutline(fungus);
  polygon(cap);
  const capG = ctx.createLinearGradient(
    fungus.capX - fungus.capWidth * 0.45,
    fungus.capY - fungus.capHeight * 0.55,
    fungus.capX + fungus.capWidth * 0.4,
    fungus.capY + fungus.capHeight * 0.44
  );
  capG.addColorStop(0, colorString(mixColor(base, { r: 255, g: 255, b: 255 }, active ? 0.4 : 0.24), 0.98));
  capG.addColorStop(0.5, colorString(base, 0.95));
  capG.addColorStop(1, colorString(mixColor(muted, { r: 0, g: 0, b: 0 }, 0.35), 0.96));
  ctx.fillStyle = capG;
  ctx.fill();

  ctx.save();
  polygon(cap);
  ctx.clip();
  for (const facet of fungus.facets) {
    const p = [
      { x: fungus.capX + facet.ax * fungus.capWidth, y: fungus.capY + facet.ay * fungus.capHeight },
      { x: fungus.capX + facet.bx * fungus.capWidth, y: fungus.capY + facet.by * fungus.capHeight },
      { x: fungus.capX + facet.cx * fungus.capWidth, y: fungus.capY + facet.cy * fungus.capHeight }
    ];
    polygon(p);
    const facetColor = hslToRgb(
      fungus.palette.h + facet.shade * 0.22,
      clamp(fungus.palette.s + facet.shade * 0.15, 70, 100),
      clamp(fungus.palette.l + facet.shade, 38, 76)
    );
    ctx.fillStyle = colorString(facetColor, facet.alpha + pulse * 0.12);
    ctx.fill();
  }
  ctx.restore();

  polygon(cap);
  ctx.strokeStyle = colorString(mixColor(base, { r: 255, g: 255, b: 255 }, 0.4), 0.32 + pulse * 0.28);
  ctx.lineWidth = 1.1;
  ctx.stroke();
}

function drawCursor() {
  const active = state.activeFungus;
  const c = active ? shadeFromPalette(active.palette, 3, 7, 10) : { r: 255, g: 255, b: 255 };
  const pulse = 0.6 + Math.sin(state.time * 5) * 0.22;
  const radius = active ? 18 + pulse * 7 : 12 + pulse * 4;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = colorString(c, active ? 0.5 : 0.3);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(state.pointer.x, state.pointer.y, radius, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = colorString(c, active ? 0.25 : 0.14);
  ctx.beginPath();
  ctx.arc(state.pointer.x, state.pointer.y, 2.2, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function draw() {
  drawBackground();
  drawFloor();
  for (const fungus of state.fungi) drawFungus(fungus);
  for (const butterfly of state.butterflies) butterfly.draw();
  drawCursor();
}

function frame(now) {
  const dt = clamp((now - state.lastTime) / 1000, 0.001, 0.05);
  state.lastTime = now;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}

function setPointer(x, y) {
  state.pointer.active = true;
  state.pointer.tx = clamp(x, 0, state.width);
  state.pointer.ty = clamp(y, 0, state.height);
}

function tryStartMusic() {
  if (!music) return;
  music.volume = 0.35;
  music.play().catch(() => {});
}

window.addEventListener("resize", resize, { passive: true });
window.addEventListener("pointermove", (event) => setPointer(event.clientX, event.clientY));
window.addEventListener("pointerdown", (event) => {
  setPointer(event.clientX, event.clientY);
  tryStartMusic();
}, { passive: true });
window.addEventListener("keydown", tryStartMusic, { once: true });
window.addEventListener("pointerleave", () => {
  state.pointer.active = false;
});
window.addEventListener(
  "touchmove",
  (event) => {
    if (event.touches[0]) setPointer(event.touches[0].clientX, event.touches[0].clientY);
    event.preventDefault();
  },
  { passive: false }
);

resize();
spawnButterflies(7, false);
requestAnimationFrame(frame);
