/**
 * PROTOTYPE — throwaway. Lives on the `prototype/interactions` branch only.
 *
 * Question: which pointer interactions make the simulation most impressive?
 * Each variant is a different interaction mode, switched by the
 * `?interaction=` URL param or the floating bar at the bottom of the page.
 * No tests, no polish: it exists to be played with and then thrown away.
 */
import { Camera, simulationToCanvas, STARTING_BOUNDARY_RADIUS } from './camera';
import { SimulationControls } from './simulation-controls';
import type { PrototypeTool } from './verlet/particle-layout';
import type { SimulationInput } from './verlet/verlet';

const GRAVITY = 3000;

type VariantId = 'classic' | 'stir' | 'vortex' | 'shockwave' | 'tilt' | 'container' | 'paddle';

interface Variant {
  id: VariantId;
  name: string;
  blurb: string;
  how: string;
  mode: number;
  radius: number;
}

const VARIANTS: Variant[] = [
  { id: 'classic', name: 'Classic', mode: 0, radius: 0,
    blurb: 'Today\'s behaviour: a point force that replaces gravity.',
    how: 'LMB attract · RMB repel' },
  { id: 'stir', name: 'Stir', mode: 1, radius: 180,
    blurb: 'Drag a finger through the fluid: nearby particles take the pointer\'s velocity.',
    how: 'hold LMB and move · wheel = radius' },
  { id: 'vortex', name: 'Vortex', mode: 2, radius: 350,
    blurb: 'A whirlpool around the pointer, with a little pull to its eye.',
    how: 'LMB spin anticlockwise · RMB clockwise · wheel = radius' },
  { id: 'shockwave', name: 'Shockwave', mode: 3, radius: 70,
    blurb: 'An expanding ring that kicks everything it passes; or a collapsing one.',
    how: 'LMB click = blast · RMB click = implosion' },
  { id: 'tilt', name: 'Tilt', mode: 4, radius: 0,
    blurb: 'Gravity points from the centre toward the pointer: pour the particles around.',
    how: 'hold LMB to aim gravity · hold RMB = zero-g · G = gravity down' },
  { id: 'container', name: 'Container', mode: 5, radius: 0,
    blurb: 'Grab the boundary circle and shake it; the wall carries its own velocity.',
    how: 'drag with LMB · G = recentre' },
  { id: 'paddle', name: 'Paddle', mode: 6, radius: 120,
    blurb: 'The pointer is a solid disc that ploughs through the particles.',
    how: 'hold LMB · wheel = radius' }
];

const SHOCK_SPEED = 2400;
const SHOCK_STRENGTH = 90000;
const IMPLOSION_START = 1400;

export class InteractionPrototype {
  private variant: Variant;
  private pointer: [number, number] = [0, 0];
  private lastPointer: [number, number] = [0, 0];
  private pointerVelocity: [number, number] = [0, 0];
  private held = { left: false, right: false };
  private radius = 0;
  private gravity: [number, number] = [0, GRAVITY];
  private center: [number, number] = [0, 0];
  private lastCenter: [number, number] = [0, 0];
  private grabOffset: [number, number] = [0, 0];
  private shock: { origin: [number, number]; age: number; implode: boolean } | null = null;
  private savedConstrainRadius: number | null = null;
  private last: PrototypeTool | null = null;

  private bar: HTMLDivElement;
  private stateLine: HTMLDivElement;
  private blurb: HTMLDivElement;
  private overlay: HTMLCanvasElement;
  private frame = 0;

  constructor(
    private controls: SimulationControls,
    canvas: HTMLCanvasElement,
    private toSimulation: (pageX: number, pageY: number) => [number, number]
  ) {
    const id = new URLSearchParams(location.search).get('interaction');
    this.variant = VARIANTS.find((v) => v.id === id) ?? VARIANTS[0];
    this.buildBar();
    this.overlay = this.buildOverlay(canvas);
    this.bind(canvas);
    this.select(this.variant.id);
  }

  /** Switches variant: the URL, the bar and the tool's state all follow. */
  select(id: VariantId) {
    this.variant = VARIANTS.find((v) => v.id === id)!;
    const url = new URL(location.href);
    url.searchParams.set('interaction', id);
    history.replaceState(null, '', url);

    this.radius = this.variant.radius;
    this.gravity = [0, GRAVITY];
    this.center = [0, 0];
    this.lastCenter = [0, 0];
    this.shock = null;
    if (this.savedConstrainRadius !== null) {
      this.controls.constrainRadius = this.savedConstrainRadius;
      this.savedConstrainRadius = null;
    }
    if (id === 'container') {
      // The circle can only move within simulation space if it is smaller.
      this.savedConstrainRadius = this.controls.constrainRadius;
      this.controls.constrainRadius = Math.min(this.controls.constrainRadius, STARTING_BOUNDARY_RADIUS * 0.55);
    }

    this.bar.querySelectorAll('button').forEach((b) => {
      b.style.background = b.dataset.id === id ? '#4a7dff' : '#2a2a2a';
    });
    this.blurb.textContent = `${this.variant.blurb}  —  ${this.variant.how}`;
  }

  /** Adds this frame's tool to the simulation input. Call once per frame. */
  apply(input: SimulationInput, elapsed: number) {
    const dt = Math.max(elapsed, 1 / 240);
    // Pointer velocity, smoothed so a single jittery frame does not fling.
    const raw: [number, number] = [
      (this.pointer[0] - this.lastPointer[0]) / dt,
      (this.pointer[1] - this.lastPointer[1]) / dt
    ];
    const k = 0.5;
    this.pointerVelocity = [
      this.pointerVelocity[0] * (1 - k) + raw[0] * k,
      this.pointerVelocity[1] * (1 - k) + raw[1] * k
    ];
    this.lastPointer = [...this.pointer];

    if (this.variant.id === 'classic') {
      this.last = null;
      return;
    }
    // Every other variant replaces the click force.
    input.clickForce = 0;

    const tool: PrototypeTool = {
      mode: this.variant.mode,
      point: [...this.pointer],
      radius: this.radius,
      strength: 0,
      velocity: [...this.pointerVelocity],
      ring: 0,
      gravity: [...this.gravity],
      wallVelocity: [0, 0]
    };

    switch (this.variant.id) {
      case 'stir':
        if (this.held.left) tool.strength = 30;
        break;
      case 'vortex':
        if (this.held.left) tool.strength = -9000;
        else if (this.held.right) tool.strength = 9000;
        break;
      case 'shockwave':
        if (this.shock) {
          if (!this.controls.paused) this.shock.age += Math.min(elapsed, 1 / 60);
          const ring = this.shock.implode
            ? IMPLOSION_START - SHOCK_SPEED * 0.6 * this.shock.age
            : SHOCK_SPEED * this.shock.age;
          if (ring < 0 || ring > 2 * STARTING_BOUNDARY_RADIUS + IMPLOSION_START) {
            this.shock = null;
          } else {
            tool.point = [...this.shock.origin];
            tool.ring = ring;
            tool.strength = this.shock.implode ? -SHOCK_STRENGTH * 0.6 : SHOCK_STRENGTH;
          }
        }
        break;
      case 'tilt': {
        if (this.held.right) {
          this.gravity = [0, 0];
        } else if (this.held.left) {
          const dx = this.pointer[0];
          const dy = this.pointer[1];
          const len = Math.hypot(dx, dy);
          if (len > 1) this.gravity = [(dx / len) * GRAVITY, (dy / len) * GRAVITY];
        }
        tool.gravity = [...this.gravity];
        break;
      }
      case 'container': {
        if (this.held.left) {
          const max = STARTING_BOUNDARY_RADIUS - this.controls.constrainRadius;
          let cx = this.pointer[0] - this.grabOffset[0];
          let cy = this.pointer[1] - this.grabOffset[1];
          const len = Math.hypot(cx, cy);
          if (len > max) {
            cx *= max / len;
            cy *= max / len;
          }
          this.center = [cx, cy];
        }
        tool.wallVelocity = [
          (this.center[0] - this.lastCenter[0]) / dt,
          (this.center[1] - this.lastCenter[1]) / dt
        ];
        this.lastCenter = [...this.center];
        input.constrainCenter = [...this.center];
        break;
      }
      case 'paddle':
        if (this.held.left) tool.strength = 1;
        break;
    }

    input.tool = tool;
    this.last = tool;
    if (this.frame++ % 6 === 0) this.showState(input);
  }

  /** Draws the tool's outline over the simulation. */
  drawOverlay(camera: Camera) {
    const canvas = this.overlay;
    const w = Math.round(canvas.clientWidth * devicePixelRatio);
    const h = Math.round(canvas.clientHeight * devicePixelRatio);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const g = canvas.getContext('2d')!;
    g.clearRect(0, 0, w, h);
    if (!this.last || camera.scale <= 0) return;
    const tool = this.last;
    const circle = (x: number, y: number, r: number, style: string, width = 2) => {
      const [px, py] = simulationToCanvas(camera, x, y);
      g.beginPath();
      g.arc(px, py, Math.max(r * camera.scale, 0), 0, Math.PI * 2);
      g.strokeStyle = style;
      g.lineWidth = width * devicePixelRatio;
      g.stroke();
    };
    const active = tool.strength !== 0;
    switch (this.variant.id) {
      case 'stir':
      case 'vortex':
      case 'paddle':
        circle(tool.point[0], tool.point[1], tool.radius, active ? 'rgba(120,170,255,0.8)' : 'rgba(255,255,255,0.25)');
        break;
      case 'shockwave':
        if (active) circle(tool.point[0], tool.point[1], tool.ring, 'rgba(255,200,120,0.6)', 3);
        break;
      case 'tilt': {
        const [cx, cy] = simulationToCanvas(camera, 0, 0);
        const [gx, gy] = simulationToCanvas(camera, tool.gravity[0] / 10, tool.gravity[1] / 10);
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(gx, gy);
        g.strokeStyle = 'rgba(255,255,255,0.5)';
        g.lineWidth = 3 * devicePixelRatio;
        g.stroke();
        break;
      }
      case 'container':
        circle(this.center[0], this.center[1], this.controls.constrainRadius, this.held.left ? 'rgba(120,170,255,0.6)' : 'rgba(255,255,255,0.2)');
        break;
    }
  }

  private showState(input: SimulationInput) {
    const f = (n: number) => n.toFixed(0).padStart(6);
    const t = input.tool!;
    this.stateLine.textContent =
      `mode ${this.variant.id} (${t.mode}) | pointer ${f(t.point[0])},${f(t.point[1])} | ` +
      `vel ${f(t.velocity[0])},${f(t.velocity[1])} | radius ${f(t.radius)} | strength ${t.strength} | ` +
      `ring ${f(t.ring)} | gravity ${f(t.gravity[0])},${f(t.gravity[1])} | ` +
      `wall ${f(input.constrainCenter?.[0] ?? 0)},${f(input.constrainCenter?.[1] ?? 0)} ` +
      `v ${f(t.wallVelocity[0])},${f(t.wallVelocity[1])} | held ${this.held.left ? 'L' : '-'}${this.held.right ? 'R' : '-'}`;
  }

  private bind(canvas: HTMLCanvasElement) {
    document.addEventListener('pointermove', (e) => {
      this.pointer = this.toSimulation(e.pageX, e.pageY);
    });
    // On the canvas, so clicks on the bar or the settings panel do not count.
    canvas.addEventListener('pointerdown', (e) => {
      this.pointer = this.toSimulation(e.pageX, e.pageY);
      if (e.button === 0) this.held.left = true;
      if (e.button === 2) this.held.right = true;
      if (this.variant.id === 'shockwave' && (e.button === 0 || e.button === 2)) {
        this.shock = { origin: [...this.pointer], age: 0, implode: e.button === 2 };
      }
      if (this.variant.id === 'container' && e.button === 0) {
        this.grabOffset = [this.pointer[0] - this.center[0], this.pointer[1] - this.center[1]];
      }
    });
    document.addEventListener('pointerup', (e) => {
      if (e.button === 0) this.held.left = false;
      if (e.button === 2) this.held.right = false;
    });
    canvas.addEventListener('wheel', (e) => {
      if (this.variant.radius === 0 || this.variant.id === 'shockwave') return;
      this.radius = Math.min(Math.max(this.radius * (e.deltaY > 0 ? 0.9 : 1.1), 20), 1000);
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyG') {
        this.gravity = [0, GRAVITY];
        this.center = [0, 0];
      }
      // Number keys 1..7 switch variant.
      const n = Number(e.key);
      if (n >= 1 && n <= VARIANTS.length) this.select(VARIANTS[n - 1].id);
    });
  }

  private buildBar() {
    const bar = document.createElement('div');
    bar.style.cssText =
      'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2000;' +
      'background:rgba(15,15,15,0.88);color:#ddd;border:1px solid #444;border-radius:10px;' +
      'padding:10px 14px;font:12px "JetBrains Mono",monospace;max-width:92vw;';
    const title = document.createElement('div');
    title.textContent = 'PROTOTYPE · interaction variants (keys 1–7)';
    title.style.cssText = 'color:#f7b955;margin-bottom:6px;font-size:11px;';
    bar.appendChild(title);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';
    VARIANTS.forEach((v, i) => {
      const b = document.createElement('button');
      b.dataset.id = v.id;
      b.textContent = `${i + 1} ${v.name}`;
      b.style.cssText =
        'color:#fff;border:1px solid #555;border-radius:6px;padding:5px 10px;cursor:pointer;font:inherit;';
      b.onclick = () => this.select(v.id);
      row.appendChild(b);
    });
    bar.appendChild(row);
    this.blurb = document.createElement('div');
    this.blurb.style.cssText = 'margin-top:6px;';
    bar.appendChild(this.blurb);
    this.stateLine = document.createElement('div');
    this.stateLine.style.cssText = 'margin-top:4px;color:#8a8a8a;font-size:10px;white-space:pre;overflow:hidden;';
    bar.appendChild(this.stateLine);
    // Keep the simulation's own mouse bindings from seeing clicks on the bar.
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      bar.addEventListener(type, (e) => e.stopPropagation());
    }
    document.body.appendChild(bar);
    this.bar = bar;
  }

  private buildOverlay(canvas: HTMLCanvasElement): HTMLCanvasElement {
    const overlay = document.createElement('canvas');
    overlay.style.cssText = 'position:absolute;left:0;top:0;width:100vw;height:100vh;pointer-events:none;';
    canvas.parentElement!.appendChild(overlay);
    return overlay;
  }
}
