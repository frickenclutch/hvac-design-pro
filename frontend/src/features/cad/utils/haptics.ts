/**
 * Visual haptic feedback system for CAD canvas interactions.
 * Provides visual pulse/flash effects and optional vibration feedback
 * when users interact with the canvas (grid snaps, wall snaps, object
 * placement, selection confirmations).
 */

const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------------------
// 1. Snap Pulse — expanding ring at screen coordinates
// ---------------------------------------------------------------------------

export function showSnapPulse(
  x: number,
  y: number,
  containerEl: HTMLElement,
): void {
  if (prefersReducedMotion()) return;

  const ring = document.createElement('div');
  const size = 24;

  Object.assign(ring.style, {
    position: 'absolute',
    left: `${x - size / 2}px`,
    top: `${y - size / 2}px`,
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: '50%',
    border: '2px solid #38bdf8', // sky-400
    opacity: '1',
    transform: 'scale(1)',
    pointerEvents: 'none',
    zIndex: '9999',
    transition: 'transform 300ms ease-out, opacity 300ms ease-out',
    boxSizing: 'border-box',
  } satisfies Partial<CSSStyleDeclaration>);

  containerEl.appendChild(ring);

  // Force a reflow so the initial styles are committed before transitioning.
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  ring.offsetWidth;

  ring.style.transform = 'scale(2.5)';
  ring.style.opacity = '0';

  ring.addEventListener('transitionend', () => ring.remove(), { once: true });

  // Safety cleanup in case transitionend doesn't fire.
  setTimeout(() => ring.remove(), 400);
}

// ---------------------------------------------------------------------------
// 2. Placement Confirm — checkmark flash with green pulse
// ---------------------------------------------------------------------------

export function showPlacementConfirm(
  x: number,
  y: number,
  containerEl: HTMLElement,
): void {
  if (prefersReducedMotion()) return;

  const wrapper = document.createElement('div');
  const size = 28;

  Object.assign(wrapper.style, {
    position: 'absolute',
    left: `${x - size / 2}px`,
    top: `${y - size / 2}px`,
    width: `${size}px`,
    height: `${size}px`,
    pointerEvents: 'none',
    zIndex: '9999',
  } satisfies Partial<CSSStyleDeclaration>);

  // Green pulse ring
  const pulse = document.createElement('div');
  Object.assign(pulse.style, {
    position: 'absolute',
    inset: '0',
    borderRadius: '50%',
    backgroundColor: 'rgba(34, 197, 94, 0.35)', // green-500 @ 35%
    transform: 'scale(1)',
    opacity: '1',
    transition: 'transform 350ms ease-out, opacity 350ms ease-out',
  } satisfies Partial<CSSStyleDeclaration>);

  // Checkmark SVG
  const check = document.createElement('div');
  Object.assign(check.style, {
    position: 'absolute',
    inset: '0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: '1',
    transition: 'opacity 350ms ease-out',
  } satisfies Partial<CSSStyleDeclaration>);

  check.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none">' +
    '<path d="M3 8.5L6.5 12L13 4" stroke="#22c55e" stroke-width="2.5" ' +
    'stroke-linecap="round" stroke-linejoin="round"/></svg>';

  wrapper.appendChild(pulse);
  wrapper.appendChild(check);
  containerEl.appendChild(wrapper);

  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  wrapper.offsetWidth;

  pulse.style.transform = 'scale(2.8)';
  pulse.style.opacity = '0';
  check.style.opacity = '0';

  const cleanup = () => wrapper.remove();
  pulse.addEventListener('transitionend', cleanup, { once: true });
  setTimeout(cleanup, 450);
}

// ---------------------------------------------------------------------------
// 3. Alignment Guide — dashed line between two points that fades out
// ---------------------------------------------------------------------------

export function showAlignmentGuide(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  containerEl: HTMLElement,
): void {
  if (prefersReducedMotion()) return;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);

  const line = document.createElement('div');

  Object.assign(line.style, {
    position: 'absolute',
    left: `${x1}px`,
    top: `${y1}px`,
    width: `${length}px`,
    height: '0px',
    borderTop: '1.5px dashed #f97316', // orange-400
    transformOrigin: '0 0',
    transform: `rotate(${angle}deg)`,
    opacity: '1',
    pointerEvents: 'none',
    zIndex: '9999',
    transition: 'opacity 400ms ease-out',
  } satisfies Partial<CSSStyleDeclaration>);

  containerEl.appendChild(line);

  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  line.offsetWidth;

  // Begin fading after a short visible pause.
  requestAnimationFrame(() => {
    setTimeout(() => {
      line.style.opacity = '0';
    }, 150);
  });

  line.addEventListener('transitionend', () => line.remove(), { once: true });
  setTimeout(() => line.remove(), 650);
}

// ---------------------------------------------------------------------------
// 4. Selection Pulse — glow / outline pulse on an element
// ---------------------------------------------------------------------------

export function showSelectionPulse(element: HTMLElement | null): void {
  if (!element || prefersReducedMotion()) return;

  const className = '__haptic-selection-pulse';

  // Avoid stacking if already animating.
  if (element.classList.contains(className)) return;

  // Inject keyframes style once.
  injectSelectionKeyframes();

  element.classList.add(className);

  const onEnd = () => {
    element.classList.remove(className);
    element.removeEventListener('animationend', onEnd);
  };

  element.addEventListener('animationend', onEnd, { once: true });

  // Safety cleanup.
  setTimeout(() => {
    element.classList.remove(className);
  }, 600);
}

let selectionKeyframesInjected = false;

function injectSelectionKeyframes(): void {
  if (selectionKeyframesInjected) return;
  selectionKeyframesInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    @keyframes __hapticSelectionGlow {
      0%   { box-shadow: 0 0 0 0 rgba(56, 189, 248, 0.6); }
      50%  { box-shadow: 0 0 8px 4px rgba(56, 189, 248, 0.35); }
      100% { box-shadow: 0 0 0 0 rgba(56, 189, 248, 0); }
    }
    .__haptic-selection-pulse {
      animation: __hapticSelectionGlow 450ms ease-out;
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// 5. Haptic Vibration — Vibration API patterns
// ---------------------------------------------------------------------------

const VIBRATION_PATTERNS: Record<
  'snap' | 'place' | 'align' | 'error',
  number[]
> = {
  snap: [10],
  place: [15, 30, 15],
  align: [5, 10, 5, 10, 5],
  error: [50, 30, 50],
};

export function triggerHapticVibration(
  pattern: 'snap' | 'place' | 'align' | 'error',
): void {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(VIBRATION_PATTERNS[pattern]);
    } catch {
      // Vibration API may throw in restrictive contexts; silently ignore.
    }
  }
}
