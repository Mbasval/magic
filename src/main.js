const canvas = document.querySelector("#scene");
const ctx = canvas.getContext("2d", { alpha: false });

const TAU = Math.PI * 2;
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
const performanceMode = prefersReducedMotion || isCoarsePointer || window.innerWidth < 760;

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
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  };
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

function shadeFromPalette(palette, index, total = 7, lift = 0) {
  const centered = index - (total - 1) / 2;
  const hue = (palette.h + centered * 2.8 + 360) % 360;
  const lightness = clamp(palette.l + centered * 3.2 + lift, 48, 82);
  const saturation = clamp(palette.s + Math.abs(centered) * 1.8, 72, 100);
  return hslToRgb(hue, saturation, lightness);
}

function whiteShade(index, total = 7) {
  const centered = index - (total - 1) / 2;
  return hslToRgb(210 + centered * 5, 10 + Math.abs(centered) * 3, 89 + index * 1.25);
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

const state = {
  dpr: 1,
  width: 1,
  height: 1,
  time: 0,
  lastTime: performance.now(),
  floorTop: 0,
  pointer: { x: 0, y: 0, tx: 0, ty: 0, active: false },
  cursorPulse: 0,
  activeFungus: null,
  fungi: [],
  butterflies: [],
  birds: [],
  particles: [],
  stars: [],
  spores: [],
  infused: new Set(),
  ascended: false,
  ascensionPulse: 0
};

function randomRange(random, min, max) {
  return min + random() * (max - min);
}

function polygon(ctxRef, points) {
  ctxRef.beginPath();
  ctxRef.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    ctxRef.lineTo(points[i].x, points[i].y);
  }
  ctxRef.closePath();
}

function rotatePoint(x, y, angle) {
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  return { x: x * c - y * s, y: x * s + y * c };
}

function spawnStars() {
  const random = mulberry32(1033);
  const density = performanceMode ? 23000 : 16000;
  const count = Math.floor(clamp((state.width * state.height) / density, 24, performanceMode ? 56 : 86));
  state.stars = Array.from({ length: count }, (_, i) => ({
    x: random() * state.width,
    y: random() * state.height * 0.72,
    r: randomRange(random, 0.35, 1.5),
    twinkle: randomRange(random, 0.5, 1.8),
    phase: random() * TAU,
    color: whiteShade(i % 7)
  }));
}

function layoutFungi() {
  const width = state.width;
  const height = state.height;
  const floorHeight = clamp(height * 0.18, 86, 170);
  state.floorTop = height - floorHeight;

  const edge = clamp(width * 0.075, 24, 108);
  const usable = width - edge * 2;
  const compact = width < 680;
  const baseScale = clamp(width / 1250, 0.56, 1.18);
  const random = mulberry32(5002);
  const sizes = [1.18, 0.86, 1.05, 0.78, 1.3, 0.92, 1.08, 0.82];
  const types = ["dome", "bell", "umbrella", "spire", "shelf", "dome", "bell", "fan"];

  state.fungi = PALETTES.map((palette, index) => {
    const t = PALETTES.length === 1 ? 0.5 : index / (PALETTES.length - 1);
    const wave = Math.sin(t * Math.PI * 3.15) * (compact ? 8 : 18);
    const x = edge + usable * t + wave;
    const heightJitter = Math.sin(index * 1.7) * 9 + randomRange(random, -4, 6);
    const scale = baseScale * sizes[index] * (compact ? 0.72 : 1);
    const stemHeight = clamp(48 * scale + heightJitter, 30, 86);
    const capWidth = clamp(74 * scale, compact ? 34 : 54, compact ? 58 : 118);
    const capHeight = clamp(38 * scale, compact ? 20 : 28, compact ? 40 : 74);
    const baseY = height - randomRange(random, compact ? 8 : 12, compact ? 24 : 34);
    const capY = baseY - stemHeight;
    const capX = x + Math.sin(index * 2.1) * capWidth * 0.05;
    const interactionRadius = clamp(capWidth * 1.2 + 32, 58, compact ? 86 : 140);

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
      stemHeight,
      stemWidth: clamp(capWidth * 0.25, 12, 32),
      scale,
      interactionRadius,
      landingSpots: buildLandingSpots(index, capX, capY, capWidth, capHeight),
      facets: buildFungusFacets(index),
      lean: randomRange(random, -0.13, 0.13),
      infused: false,
      dwell: 0,
      pulse: 0
    };
  });

}

function buildLandingSpots(index, capX, capY, capWidth, capHeight) {
  const random = mulberry32(1700 + index * 101);
  return Array.from({ length: 7 }, (_, i) => {
    const t = (i + 0.5) / 7;
    return {
      ox: map(t, 0, 1, -capWidth * 0.38, capWidth * 0.38) + randomRange(random, -5, 5),
      oy: -capHeight * 0.1 + Math.sin(t * Math.PI) * capHeight * 0.14 + randomRange(random, -4, 4),
      orbit: randomRange(random, 0.5, 1.2),
      phase: random() * TAU
    };
  });
}

function buildFungusFacets(index) {
  const random = mulberry32(8100 + index * 73);
  return Array.from({ length: performanceMode ? 5 : 8 }, () => ({
    ax: randomRange(random, -0.5, 0.4),
    ay: randomRange(random, -0.5, 0.28),
    bx: randomRange(random, -0.25, 0.52),
    by: randomRange(random, -0.42, 0.32),
    cx: randomRange(random, -0.42, 0.5),
    cy: randomRange(random, -0.2, 0.5),
    shade: randomRange(random, -12, 16),
    alpha: randomRange(random, 0.16, 0.35)
  }));
}

function resize() {
  state.dpr = Math.min(window.devicePixelRatio || 1, performanceMode ? 1 : 1.35);
  state.width = window.innerWidth;
  state.height = window.innerHeight;
  canvas.width = Math.floor(state.width * state.dpr);
  canvas.height = Math.floor(state.height * state.dpr);
  canvas.style.width = `${state.width}px`;
  canvas.style.height = `${state.height}px`;
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);

  if (!state.pointer.active) {
    state.pointer.x = state.width / 2;
    state.pointer.y = state.height * 0.42;
    state.pointer.tx = state.pointer.x;
    state.pointer.ty = state.pointer.y;
  }

  layoutFungi();
  spawnStars();
}

class Particle {
  constructor(x, y, vx, vy, color, size, life, glow = 0.5) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.color = color;
    this.size = size;
    this.life = life;
    this.maxLife = life;
    this.glow = glow;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vx *= 1 - 0.32 * dt;
    this.vy -= 2.5 * dt;
    this.life -= dt;
  }

  draw() {
    const alpha = clamp(this.life / this.maxLife, 0, 1);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    if (!performanceMode) {
      ctx.shadowColor = colorString(this.color, alpha);
      ctx.shadowBlur = 12 * this.glow;
    }
    ctx.fillStyle = colorString(this.color, alpha * 0.55);
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size * alpha, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

class Butterfly {
  constructor(index, bornFromAscension = false) {
    const random = mulberry32(9000 + index * 41);
    this.index = index;
    this.x = random() * state.width;
    this.y = random() * state.height * 0.48 + state.height * 0.15;
    this.vx = randomRange(random, -18, 18);
    this.vy = randomRange(random, -18, 18);
    this.phase = random() * TAU;
    this.flap = randomRange(random, 0.75, 1.35);
    this.scale = randomRange(random, 0.82, 1.22) * (bornFromAscension ? 0.9 : 1);
    this.wander = random() * TAU;
    this.settle = 0;
    this.personal = index % PALETTES.length;
    this.color = bornFromAscension
      ? shadeFromPalette(PALETTES[this.personal], index, 14, 8)
      : whiteShade(index % 7);
    this.white = whiteShade(index % 7);
    this.ascended = bornFromAscension;
    this.trailClock = random() * 0.2;
  }

  update(dt) {
    this.phase += dt * (prefersReducedMotion ? 5.5 : 10.5) * this.flap;
    this.wander += dt * 1.9;

    const active = state.activeFungus;
    let targetX = state.pointer.x;
    let targetY = state.pointer.y;
    let desiredColor = this.white;
    let maxSpeed = prefersReducedMotion ? 70 : 170;
    let pull = prefersReducedMotion ? 1.8 : 4.2;

    if (active) {
      const spot = active.landingSpots[this.index % active.landingSpots.length];
      const orbit = Math.sin(state.time * (1.3 + spot.orbit) + spot.phase);
      const hoverLift = Math.cos(state.time * (1.5 + spot.orbit) + spot.phase) * active.capHeight * 0.22;
      const baseX = active.capX + spot.ox;
      const baseY = active.capY + spot.oy;

      targetX = baseX + orbit * active.capWidth * 0.25;
      targetY = baseY - Math.abs(hoverLift) - active.capHeight * 0.18;
      desiredColor = shadeFromPalette(active.palette, this.index % 7, 7, this.settle > 0.45 ? 8 : 0);
      maxSpeed = prefersReducedMotion ? 96 : 340;
      pull = prefersReducedMotion ? 2.8 : 7.4;

      const distanceToFungus = dist(this.x, this.y, baseX, baseY);
      this.settle = distanceToFungus < active.capWidth * 0.42 ? clamp(this.settle + dt * 1.5, 0, 1) : clamp(this.settle - dt, 0, 1);

      if (this.settle > 0.38) {
        state.infused.add(active.id);
        active.infused = true;
        active.pulse = Math.min(active.pulse + dt * 2, 1);
      }
    } else {
      this.settle = clamp(this.settle - dt * 1.4, 0, 1);
      const ring = 30 + (this.index % 7) * 11;
      const angle = state.time * (0.85 + (this.index % 5) * 0.08) + this.index * 1.9;
      targetX += Math.cos(angle) * ring + Math.sin(this.wander * 1.3) * 22;
      targetY += Math.sin(angle * 1.25) * ring * 0.58 + Math.cos(this.wander) * 18;
      if (state.ascended) {
        desiredColor = shadeFromPalette(PALETTES[this.personal], this.index, Math.max(14, state.butterflies.length), 9);
      }
    }

    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const distance = Math.max(Math.hypot(dx, dy), 0.001);
    const speed = clamp(distance * 1.9, 26, maxSpeed);
    let desiredVx = (dx / distance) * speed;
    let desiredVy = (dy / distance) * speed;

    desiredVx += Math.cos(this.wander * 2.1 + this.phase) * 32;
    desiredVy += Math.sin(this.wander * 1.7 - this.phase * 0.2) * 24;

    this.vx += (desiredVx - this.vx) * pull * dt;
    this.vy += (desiredVy - this.vy) * pull * dt;
    this.vx *= 1 - 0.035 * dt;
    this.vy *= 1 - 0.035 * dt;

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    const margin = 36;
    if (this.x < -margin) this.x = state.width + margin;
    if (this.x > state.width + margin) this.x = -margin;
    this.y = clamp(this.y, 24, state.height - 42);

    this.color = mixColor(this.color, desiredColor, clamp(dt * (active || state.ascended ? 2.8 : 0.55), 0, 1));
    this.trailClock -= dt;
    if (this.trailClock <= 0) {
      this.trailClock = performanceMode ? 0.18 : 0.09 + (this.index % 4) * 0.018;
      emitParticle(
        this.x - this.vx * 0.035,
        this.y - this.vy * 0.035,
        -this.vx * 0.035 + Math.sin(this.phase) * 8,
        -this.vy * 0.035 + Math.cos(this.phase) * 7,
        this.color,
        randomRange(Math.random, 0.8, 2.2),
        randomRange(Math.random, 0.38, performanceMode ? 0.62 : 0.9),
        performanceMode ? 0.35 : 0.75
      );
    }
  }

  draw() {
    const angle = Math.atan2(this.vy, this.vx);
    const flap = Math.sin(this.phase);
    const wingOpen = 0.52 + Math.abs(flap) * 0.72;
    const compact = state.width < 620 ? 0.82 : 1;
    const size = 10.5 * this.scale * compact;
    const bodyLength = size * 1.45;
    const wingColor = this.color;
    const coreColor = mixColor(this.color, { r: 255, g: 255, b: 255 }, 0.28);

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(angle);
    ctx.globalCompositeOperation = "lighter";
    ctx.shadowColor = colorString(wingColor, 0.85);
    ctx.shadowBlur = performanceMode ? 7 : 13 + wingOpen * 5;

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

    drawButterflyWing(leftWing, wingColor, 0.82);
    drawButterflyWing(leftLower, mixColor(wingColor, coreColor, 0.22), 0.62);

    ctx.scale(1, -1);
    drawButterflyWing(leftWing, wingColor, 0.82);
    drawButterflyWing(leftLower, mixColor(wingColor, coreColor, 0.22), 0.62);
    ctx.scale(1, -1);

    ctx.shadowBlur = performanceMode ? 0 : 6;
    ctx.fillStyle = colorString(coreColor, 0.94);
    ctx.beginPath();
    ctx.ellipse(0, 0, bodyLength * 0.35, size * 0.13, 0, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = colorString(coreColor, 0.42);
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(size * 0.22, -size * 0.04);
    ctx.quadraticCurveTo(size * 0.72, -size * 0.42, size * 0.92, -size * 0.78);
    ctx.moveTo(size * 0.22, size * 0.04);
    ctx.quadraticCurveTo(size * 0.72, size * 0.42, size * 0.92, size * 0.78);
    ctx.stroke();
    ctx.restore();
  }
}

function drawButterflyWing(points, color, alpha) {
  polygon(ctx, points);
  const gradient = ctx.createLinearGradient(points[1].x, points[1].y, points[3].x, points[3].y);
  gradient.addColorStop(0, colorString(mixColor(color, { r: 255, g: 255, b: 255 }, 0.38), alpha));
  gradient.addColorStop(1, colorString(color, alpha * 0.48));
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.strokeStyle = colorString(mixColor(color, { r: 255, g: 255, b: 255 }, 0.55), alpha * 0.28);
  ctx.lineWidth = 0.65;
  ctx.stroke();

  const midA = {
    x: (points[0].x + points[1].x + points[2].x) / 3,
    y: (points[0].y + points[1].y + points[2].y) / 3
  };
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  ctx.lineTo(midA.x, midA.y);
  ctx.lineTo(points[3].x, points[3].y);
  ctx.strokeStyle = colorString({ r: 255, g: 255, b: 255 }, alpha * 0.16);
  ctx.stroke();
}

class Bird {
  constructor(index) {
    const random = mulberry32(12000 + index * 113);
    this.index = index;
    this.x = random() * state.width;
    this.y = randomRange(random, state.height * 0.08, state.height * 0.5);
    this.vx = randomRange(random, -30, 30);
    this.vy = randomRange(random, -10, 18);
    this.phase = random() * TAU;
    this.scale = randomRange(random, 0.85, 1.3);
    this.palette = index % PALETTES.length;
    this.color = shadeFromPalette(PALETTES[this.palette], index, 12, 8);
  }

  update(dt) {
    this.phase += dt * 7.5;
    const angle = state.time * (0.25 + this.index * 0.015) + this.index * 1.4;
    const radiusX = clamp(state.width * 0.23, 78, 280);
    const radiusY = clamp(state.height * 0.14, 48, 140);
    const targetX = state.pointer.x + Math.cos(angle) * radiusX;
    const targetY = state.pointer.y - state.height * 0.18 + Math.sin(angle * 1.7) * radiusY;
    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const distance = Math.max(Math.hypot(dx, dy), 0.001);
    const desiredSpeed = clamp(distance * 1.45, 48, 190);
    const desiredVx = (dx / distance) * desiredSpeed + Math.sin(this.phase * 0.37) * 24;
    const desiredVy = (dy / distance) * desiredSpeed + Math.cos(this.phase * 0.41) * 16;

    this.vx += (desiredVx - this.vx) * dt * 2.4;
    this.vy += (desiredVy - this.vy) * dt * 2.2;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    if (this.x < -60) this.x = state.width + 60;
    if (this.x > state.width + 60) this.x = -60;
    this.y = clamp(this.y, 18, state.floorTop - 35);

    if (!performanceMode && Math.random() < dt * 2.2) {
      emitParticle(this.x, this.y, -this.vx * 0.02, -this.vy * 0.02, this.color, 1.1, 0.65, 0.45);
    }
  }

  draw() {
    const angle = Math.atan2(this.vy, this.vx);
    const flap = Math.sin(this.phase) * 0.75;
    const size = (state.width < 620 ? 8 : 11) * this.scale;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(angle);
    ctx.globalCompositeOperation = "lighter";
    ctx.shadowColor = colorString(this.color, 0.8);
    ctx.shadowBlur = performanceMode ? 4 : 10;
    ctx.strokeStyle = colorString(this.color, 0.76);
    ctx.lineWidth = Math.max(1.4, size * 0.14);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(-size * 0.2, 0);
    ctx.quadraticCurveTo(-size * 0.65, -size * (0.72 + flap * 0.25), -size * 1.42, -size * (0.35 - flap * 0.2));
    ctx.moveTo(-size * 0.2, 0);
    ctx.quadraticCurveTo(-size * 0.65, size * (0.72 + flap * 0.25), -size * 1.42, size * (0.35 - flap * 0.2));
    ctx.stroke();
    ctx.fillStyle = colorString(mixColor(this.color, { r: 255, g: 255, b: 255 }, 0.25), 0.8);
    ctx.beginPath();
    ctx.ellipse(size * 0.28, 0, size * 0.55, size * 0.16, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

function emitParticle(x, y, vx, vy, color, size, life, glow) {
  if (state.particles.length > (performanceMode ? 70 : 150)) return;
  state.particles.push(new Particle(x, y, vx, vy, color, size, life, glow));
}

function spawnButterflies(count, bornFromAscension = false) {
  const start = state.butterflies.length;
  for (let i = 0; i < count; i += 1) {
    state.butterflies.push(new Butterfly(start + i, bornFromAscension));
  }
}

function triggerAscension() {
  if (state.ascended || state.infused.size < PALETTES.length) return;
  state.ascended = true;
  state.ascensionPulse = 1;
  spawnButterflies(7, true);
  for (let i = 0; i < (performanceMode ? 5 : 8); i += 1) {
    state.birds.push(new Bird(i));
  }
  for (const fungus of state.fungi) {
    const baseColor = shadeFromPalette(fungus.palette, fungus.id, PALETTES.length, 8);
    for (let i = 0; i < (performanceMode ? 7 : 14); i += 1) {
      const angle = Math.random() * TAU;
      const speed = randomRange(Math.random, 20, 92);
      emitParticle(
        fungus.capX,
        fungus.capY,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed - randomRange(Math.random, 10, 70),
        baseColor,
        randomRange(Math.random, 1.2, 3.4),
        randomRange(Math.random, 0.8, 1.6),
        1.1
      );
    }
  }
}

function updatePointer(dt) {
  if (!state.pointer.active) {
    const driftX = state.width / 2 + Math.cos(state.time * 0.29) * state.width * 0.16;
    const driftY = state.height * 0.42 + Math.sin(state.time * 0.37) * state.height * 0.11;
    state.pointer.tx = driftX;
    state.pointer.ty = driftY;
  }

  state.pointer.x = lerp(state.pointer.x, state.pointer.tx, clamp(dt * 10, 0, 1));
  state.pointer.y = lerp(state.pointer.y, state.pointer.ty, clamp(dt * 10, 0, 1));
}

function findActiveFungus() {
  let closest = null;
  let closestDistance = Infinity;

  for (const fungus of state.fungi) {
    const focusY = fungus.capY - fungus.capHeight * 0.1;
    const d = dist(state.pointer.x, state.pointer.y, fungus.capX, focusY);
    if (d < fungus.interactionRadius && d < closestDistance) {
      closest = fungus;
      closestDistance = d;
    }
  }

  state.activeFungus = closest;
}

function update(dt) {
  state.time += dt;
  updatePointer(dt);
  findActiveFungus();

  for (const fungus of state.fungi) {
    fungus.pulse = Math.max(0, fungus.pulse - dt * 0.34);
    if (state.activeFungus === fungus) {
      fungus.dwell = Math.min(fungus.dwell + dt, 2);
      fungus.pulse = Math.min(1, fungus.pulse + dt * 1.7);
      state.infused.add(fungus.id);
      fungus.infused = true;
    } else {
      fungus.dwell = Math.max(0, fungus.dwell - dt * 0.9);
    }
  }

  for (const butterfly of state.butterflies) butterfly.update(dt);
  for (const bird of state.birds) bird.update(dt);

  for (let i = state.particles.length - 1; i >= 0; i -= 1) {
    const particle = state.particles[i];
    particle.update(dt);
    if (particle.life <= 0) state.particles.splice(i, 1);
  }

  if (state.activeFungus && Math.random() < dt * (performanceMode ? 4 : 8)) {
    const fungus = state.activeFungus;
    const color = shadeFromPalette(fungus.palette, Math.floor(Math.random() * 7), 7, 7);
    emitParticle(
      fungus.capX + randomRange(Math.random, -fungus.capWidth * 0.38, fungus.capWidth * 0.38),
      fungus.capY - randomRange(Math.random, 0, fungus.capHeight * 0.45),
      randomRange(Math.random, -9, 9),
      randomRange(Math.random, -30, -8),
      color,
      randomRange(Math.random, 0.9, 2.4),
      randomRange(Math.random, 0.55, 1.15),
      0.9
    );
  }

  state.ascensionPulse = Math.max(0, state.ascensionPulse - dt * 0.5);
  triggerAscension();
}

function drawBackground() {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, state.width, state.height);

  const glow = ctx.createRadialGradient(
    state.pointer.x,
    state.pointer.y,
    0,
    state.pointer.x,
    state.pointer.y,
    Math.max(state.width, state.height) * 0.72
  );
  glow.addColorStop(0, "rgba(255,255,255,0.045)");
  glow.addColorStop(0.28, "rgba(120,180,255,0.018)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, state.width, state.height);

  for (const star of state.stars) {
    const alpha = performanceMode ? 0.16 : 0.15 + Math.sin(state.time * star.twinkle + star.phase) * 0.08;
    ctx.fillStyle = colorString(star.color, alpha);
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.r, 0, TAU);
    ctx.fill();
  }

  if (state.ascensionPulse > 0) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const pulse = ctx.createRadialGradient(
      state.width / 2,
      state.height * 0.55,
      0,
      state.width / 2,
      state.height * 0.55,
      Math.max(state.width, state.height) * state.ascensionPulse
    );
    pulse.addColorStop(0, `rgba(255,255,255,${0.16 * state.ascensionPulse})`);
    pulse.addColorStop(0.28, `rgba(80,255,229,${0.07 * state.ascensionPulse})`);
    pulse.addColorStop(0.62, `rgba(255,78,202,${0.05 * state.ascensionPulse})`);
    pulse.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = pulse;
    ctx.fillRect(0, 0, state.width, state.height);
    ctx.restore();
  }
}

function drawFloor() {
  const top = state.floorTop;
  const h = state.height - top;
  const random = mulberry32(3021);
  ctx.save();
  ctx.fillStyle = "#020202";
  ctx.beginPath();
  ctx.moveTo(0, top + Math.sin(state.time * 0.28) * 2);
  const segments = 18;
  for (let i = 0; i <= segments; i += 1) {
    const x = (i / segments) * state.width;
    const y = top + Math.sin(i * 1.7) * 7 + Math.cos(i * 0.7) * 4;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(state.width, state.height);
  ctx.lineTo(0, state.height);
  ctx.closePath();
  ctx.fill();

  for (let i = 0; i < (performanceMode ? 14 : 28); i += 1) {
    const x = random() * state.width;
    const y = top + random() * h;
    const w = randomRange(random, 18, 86);
    const color = i % 3 === 0 ? "rgba(255,255,255,0.025)" : "rgba(255,255,255,0.014)";
    ctx.fillStyle = color;
    polygon(ctx, [
      { x: x - w * 0.5, y: y + randomRange(random, -4, 4) },
      { x: x + w * 0.55, y: y + randomRange(random, -4, 4) },
      { x: x + w * 0.3, y: y + randomRange(random, 8, 26) },
      { x: x - w * 0.65, y: y + randomRange(random, 8, 28) }
    ]);
    ctx.fill();
  }

  ctx.restore();
}

function capOutline(fungus) {
  const w = fungus.capWidth;
  const h = fungus.capHeight;
  const cx = fungus.capX;
  const cy = fungus.capY;

  if (fungus.type === "bell") {
    return [
      { x: cx - w * 0.45, y: cy + h * 0.32 },
      { x: cx - w * 0.36, y: cy - h * 0.2 },
      { x: cx - w * 0.08, y: cy - h * 0.58 },
      { x: cx + w * 0.18, y: cy - h * 0.52 },
      { x: cx + w * 0.42, y: cy - h * 0.08 },
      { x: cx + w * 0.5, y: cy + h * 0.3 },
      { x: cx + w * 0.18, y: cy + h * 0.42 },
      { x: cx - w * 0.16, y: cy + h * 0.38 }
    ];
  }

  if (fungus.type === "spire") {
    return [
      { x: cx - w * 0.48, y: cy + h * 0.34 },
      { x: cx - w * 0.28, y: cy - h * 0.08 },
      { x: cx - w * 0.05, y: cy - h * 0.8 },
      { x: cx + w * 0.22, y: cy - h * 0.12 },
      { x: cx + w * 0.5, y: cy + h * 0.34 },
      { x: cx + w * 0.12, y: cy + h * 0.47 },
      { x: cx - w * 0.28, y: cy + h * 0.43 }
    ];
  }

  if (fungus.type === "shelf") {
    return [
      { x: cx - w * 0.56, y: cy + h * 0.12 },
      { x: cx - w * 0.32, y: cy - h * 0.35 },
      { x: cx + w * 0.32, y: cy - h * 0.42 },
      { x: cx + w * 0.62, y: cy - h * 0.08 },
      { x: cx + w * 0.48, y: cy + h * 0.28 },
      { x: cx - w * 0.38, y: cy + h * 0.34 }
    ];
  }

  if (fungus.type === "fan") {
    return [
      { x: cx - w * 0.5, y: cy + h * 0.24 },
      { x: cx - w * 0.5, y: cy - h * 0.18 },
      { x: cx - w * 0.22, y: cy - h * 0.54 },
      { x: cx + w * 0.2, y: cy - h * 0.52 },
      { x: cx + w * 0.54, y: cy - h * 0.14 },
      { x: cx + w * 0.46, y: cy + h * 0.3 },
      { x: cx + w * 0.05, y: cy + h * 0.42 }
    ];
  }

  if (fungus.type === "umbrella") {
    return [
      { x: cx - w * 0.58, y: cy + h * 0.28 },
      { x: cx - w * 0.42, y: cy - h * 0.08 },
      { x: cx - w * 0.12, y: cy - h * 0.38 },
      { x: cx + w * 0.2, y: cy - h * 0.36 },
      { x: cx + w * 0.52, y: cy - h * 0.03 },
      { x: cx + w * 0.6, y: cy + h * 0.25 },
      { x: cx + w * 0.22, y: cy + h * 0.38 },
      { x: cx - w * 0.28, y: cy + h * 0.36 }
    ];
  }

  return [
    { x: cx - w * 0.54, y: cy + h * 0.22 },
    { x: cx - w * 0.38, y: cy - h * 0.18 },
    { x: cx - w * 0.05, y: cy - h * 0.48 },
    { x: cx + w * 0.28, y: cy - h * 0.34 },
    { x: cx + w * 0.52, y: cy + h * 0.08 },
    { x: cx + w * 0.42, y: cy + h * 0.35 },
    { x: cx + w * 0.05, y: cy + h * 0.43 },
    { x: cx - w * 0.36, y: cy + h * 0.34 }
  ];
}

function drawFungus(fungus) {
  const active = state.activeFungus === fungus;
  const infused = state.infused.has(fungus.id);
  const pulse = fungus.pulse + (infused ? 0.28 : 0);
  const base = shadeFromPalette(fungus.palette, fungus.id, PALETTES.length, active ? 14 : 4);
  const muted = hslToRgb(fungus.palette.h, clamp(fungus.palette.s * 0.65, 40, 100), active ? 48 : 36);
  const stemTopX = fungus.capX + Math.sin(fungus.lean) * fungus.stemWidth;
  const stemBottomX = fungus.x;

  ctx.save();
  ctx.globalCompositeOperation = "source-over";

  if ((active || infused) && (!performanceMode || active)) {
    ctx.globalCompositeOperation = "lighter";
    const aura = ctx.createRadialGradient(
      fungus.capX,
      fungus.capY,
      0,
      fungus.capX,
      fungus.capY,
      fungus.interactionRadius * (0.75 + pulse * 0.45)
    );
    aura.addColorStop(0, colorString(base, active ? 0.24 : 0.15));
    aura.addColorStop(0.55, colorString(base, active ? 0.07 : 0.04));
    aura.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = aura;
    ctx.fillRect(
      fungus.capX - fungus.interactionRadius * 1.3,
      fungus.capY - fungus.interactionRadius * 1.1,
      fungus.interactionRadius * 2.6,
      fungus.interactionRadius * 2.4
    );
    ctx.globalCompositeOperation = "source-over";
  }

  const stem = [
    { x: stemBottomX - fungus.stemWidth * 0.58, y: fungus.y },
    { x: stemBottomX + fungus.stemWidth * 0.55, y: fungus.y },
    { x: stemTopX + fungus.stemWidth * 0.36, y: fungus.capY + fungus.capHeight * 0.32 },
    { x: stemTopX - fungus.stemWidth * 0.4, y: fungus.capY + fungus.capHeight * 0.32 }
  ];
  polygon(ctx, stem);
  const stemGradient = ctx.createLinearGradient(stemBottomX, fungus.y, stemTopX, fungus.capY);
  stemGradient.addColorStop(0, "rgba(10,10,10,1)");
  stemGradient.addColorStop(0.58, colorString(mixColor(muted, { r: 0, g: 0, b: 0 }, 0.58), 0.9));
  stemGradient.addColorStop(1, colorString(mixColor(base, { r: 0, g: 0, b: 0 }, 0.32), 0.86));
  ctx.fillStyle = stemGradient;
  ctx.fill();

  ctx.strokeStyle = colorString(mixColor(base, { r: 255, g: 255, b: 255 }, 0.28), 0.2 + pulse * 0.22);
  ctx.lineWidth = 1;
  ctx.stroke();

  const cap = capOutline(fungus);
  polygon(ctx, cap);
  const capGradient = ctx.createLinearGradient(
    fungus.capX - fungus.capWidth * 0.45,
    fungus.capY - fungus.capHeight * 0.55,
    fungus.capX + fungus.capWidth * 0.4,
    fungus.capY + fungus.capHeight * 0.44
  );
  capGradient.addColorStop(0, colorString(mixColor(base, { r: 255, g: 255, b: 255 }, active ? 0.38 : 0.24), 0.98));
  capGradient.addColorStop(0.5, colorString(base, 0.95));
  capGradient.addColorStop(1, colorString(mixColor(muted, { r: 0, g: 0, b: 0 }, 0.35), 0.96));
  ctx.fillStyle = capGradient;
  ctx.shadowColor = colorString(base, active ? 0.72 : 0.32);
  ctx.shadowBlur = performanceMode ? (active ? 7 : 0) : active ? 14 : 5;
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.save();
  polygon(ctx, cap);
  ctx.clip();
  const facets = performanceMode && !active ? fungus.facets.slice(0, 3) : fungus.facets;
  for (const facet of facets) {
    const points = [
      {
        x: fungus.capX + facet.ax * fungus.capWidth,
        y: fungus.capY + facet.ay * fungus.capHeight
      },
      {
        x: fungus.capX + facet.bx * fungus.capWidth,
        y: fungus.capY + facet.by * fungus.capHeight
      },
      {
        x: fungus.capX + facet.cx * fungus.capWidth,
        y: fungus.capY + facet.cy * fungus.capHeight
      }
    ];
    const facetColor = hslToRgb(
      fungus.palette.h + facet.shade * 0.22,
      clamp(fungus.palette.s + facet.shade * 0.15, 70, 100),
      clamp(fungus.palette.l + facet.shade, 38, 76)
    );
    polygon(ctx, points);
    ctx.fillStyle = colorString(facetColor, facet.alpha + pulse * 0.08);
    ctx.fill();
  }

  for (let i = 0; i < 6; i += 1) {
    const t = (i + 0.7) / 6;
    const x = fungus.capX + map(t, 0, 1, -fungus.capWidth * 0.37, fungus.capWidth * 0.36);
    const y = fungus.capY - fungus.capHeight * (0.18 + Math.sin(t * Math.PI) * 0.23);
    const spotSize = clamp(fungus.capWidth * (0.025 + (i % 3) * 0.008), 1.2, 4);
    ctx.fillStyle = colorString({ r: 255, g: 255, b: 255 }, active ? 0.38 : 0.22);
    polygon(ctx, [
      { x, y: y - spotSize },
      { x: x + spotSize * 1.2, y: y + spotSize * 0.2 },
      { x: x + spotSize * 0.1, y: y + spotSize * 1.1 },
      { x: x - spotSize * 1.1, y: y + spotSize * 0.1 }
    ]);
    ctx.fill();
  }
  ctx.restore();

  polygon(ctx, cap);
  ctx.strokeStyle = colorString(mixColor(base, { r: 255, g: 255, b: 255 }, 0.4), 0.32 + pulse * 0.24);
  ctx.lineWidth = 1.1;
  ctx.stroke();
  ctx.restore();
}

function drawCursor() {
  const active = state.activeFungus;
  const color = active ? shadeFromPalette(active.palette, 3, 7, 10) : { r: 255, g: 255, b: 255 };
  const pulse = 0.6 + Math.sin(state.time * 5) * 0.22;
  const radius = active ? 18 + pulse * 7 : 12 + pulse * 4;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = colorString(color, active ? 0.55 : 0.32);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(state.pointer.x, state.pointer.y, radius, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = colorString(color, active ? 0.26 : 0.16);
  ctx.beginPath();
  ctx.arc(state.pointer.x, state.pointer.y, 2.2, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function draw() {
  drawBackground();
  drawFloor();

  const sortedFungi = [...state.fungi].sort((a, b) => a.y - b.y);
  for (const fungus of sortedFungi) drawFungus(fungus);

  for (const particle of state.particles) particle.draw();
  for (const bird of state.birds) bird.draw();
  for (const butterfly of state.butterflies) butterfly.draw();
  drawCursor();
}

function frame(now) {
  const rawDt = (now - state.lastTime) / 1000;
  const dt = clamp(rawDt, 0.001, prefersReducedMotion ? 0.03 : 0.045);
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

window.addEventListener("resize", resize, { passive: true });
window.addEventListener("pointermove", (event) => {
  setPointer(event.clientX, event.clientY);
});
window.addEventListener("pointerdown", (event) => {
  setPointer(event.clientX, event.clientY);
});
window.addEventListener("pointerleave", () => {
  state.pointer.active = false;
});
window.addEventListener(
  "touchmove",
  (event) => {
    if (event.touches[0]) {
      setPointer(event.touches[0].clientX, event.touches[0].clientY);
    }
    event.preventDefault();
  },
  { passive: false }
);

resize();
spawnButterflies(7, false);
requestAnimationFrame(frame);
