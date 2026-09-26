// Keyboard + mouse state for exploring on foot.
export class Input {
  constructor(dom) {
    this.keys = new Set();
    this.pressed = new Set(); // edge-triggered this frame
    this.dragging = false;
    this.dx = 0; this.dy = 0; this.wheel = 0;
    this.lastActivity = -1e9; // performance.now() of the last user input that steers the traveller
    this.lastLook = -1e9;
    this.any = false;
    const norm = (e) => (e.code || e.key);
    window.addEventListener('keydown', (e) => {
      const k = norm(e);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      this.any = true;
      if (/^(Key[WASD]|Arrow|Space|Shift)/.test(k)) this.lastActivity = performance.now();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(norm(e)));
    window.addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('pointerdown', (e) => {
      this.dragging = true; this.any = true;
      this.px = e.clientX; this.py = e.clientY;
      dom.setPointerCapture?.(e.pointerId);
    });
    window.addEventListener('pointerup', () => { this.dragging = false; });
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.dx += e.clientX - this.px; this.dy += e.clientY - this.py;
      this.px = e.clientX; this.py = e.clientY;
      this.lastLook = performance.now();
    });
    dom.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); this.lastLook = performance.now(); e.preventDefault(); }, { passive: false });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  down(...codes) { return codes.some((c) => this.keys.has(c)); }
  hit(code) { return this.pressed.has(code); }
  // movement axes in camera space: x = right, y = forward
  axes() {
    let x = 0, y = 0;
    if (this.down('KeyW', 'ArrowUp')) y += 1;
    if (this.down('KeyS', 'ArrowDown')) y -= 1;
    if (this.down('KeyD', 'ArrowRight')) x += 1;
    if (this.down('KeyA', 'ArrowLeft')) x -= 1;
    const l = Math.hypot(x, y);
    return l > 0 ? { x: x / l, y: y / l } : { x: 0, y: 0 };
  }
  consumeLook() {
    const r = { dx: this.dx, dy: this.dy, wheel: this.wheel };
    this.dx = 0; this.dy = 0; this.wheel = 0;
    return r;
  }
  endFrame() { this.pressed.clear(); }
}
