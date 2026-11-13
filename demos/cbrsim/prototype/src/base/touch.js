// Touch controls for tablets: a joystick on the left moves, dragging anywhere else
// looks around, and two buttons fly up and down. Only shown on touch devices.

export function createTouch(root) {
  const state = { move: [0, 0], look: [0, 0], up: 0, active: false };
  if (!('ontouchstart' in window) && !(navigator.maxTouchPoints > 0)) return state;
  state.active = true;
  document.body.classList.add('touch');

  const pad = document.createElement('div'); pad.id = 'joy';
  const knob = document.createElement('div'); knob.id = 'knob'; pad.appendChild(knob);
  root.appendChild(pad);
  let padId = null, cx = 0, cy = 0;
  pad.addEventListener('pointerdown', (e) => {
    padId = e.pointerId; pad.setPointerCapture(e.pointerId);
    const r = pad.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    e.stopPropagation();
  });
  pad.addEventListener('pointermove', (e) => {
    if (e.pointerId !== padId) return;
    let dx = (e.clientX - cx) / 50, dy = (e.clientY - cy) / 50;
    const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
    state.move = [dx, -dy];
    knob.style.transform = `translate(${dx * 40}px, ${dy * 40}px)`;
  });
  const endPad = (e) => { if (e.pointerId !== padId) return; padId = null; state.move = [0, 0]; knob.style.transform = ''; };
  pad.addEventListener('pointerup', endPad); pad.addEventListener('pointercancel', endPad);

  const canvas = root.querySelector('canvas#app');
  let lookId = null, lx = 0, ly = 0;
  canvas.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch') return; lookId = e.pointerId; lx = e.clientX; ly = e.clientY; });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lookId) return;
    state.look[0] += e.clientX - lx; state.look[1] += e.clientY - ly; lx = e.clientX; ly = e.clientY;
  });
  const endLook = (e) => { if (e.pointerId === lookId) lookId = null; };
  canvas.addEventListener('pointerup', endLook); canvas.addEventListener('pointercancel', endLook);

  for (const [label, dir] of [['▲', 1], ['▼', -1]]) {
    const b = document.createElement('button'); b.className = 'flybtn'; b.textContent = label;
    b.addEventListener('pointerdown', (e) => { state.up = dir; e.stopPropagation(); });
    b.addEventListener('pointerup', () => { state.up = 0; }); b.addEventListener('pointerleave', () => { state.up = 0; });
    root.appendChild(b);
  }
  return state;
}
