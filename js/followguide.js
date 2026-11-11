import { projectVector, R } from './coelum.js';

// Use the rendered camera, including roll, rather than azimuth differences:
// the arrow must still point the right way in landscape and near the zenith.
export function followGuide(direction, rotation, width, height, radius, stereographic) {
  const p = projectVector(direction, rotation, stereographic);
  const angle = Math.acos(Math.max(-1, Math.min(1, p.z))) / R;
  const ring = Math.min(64, Math.min(width, height) * 0.16, 22 + angle * 1.4);
  const dx = p.x * radius, dy = p.y * radius;
  const margin = ring + 30;
  const maxX = Math.max(0, width / 2 - margin), maxY = Math.max(0, height / 2 - margin);
  // Clamp along the bearing so the arrow and the target remain collinear.
  const k = Math.min(1, maxX / (Math.abs(dx) || 1), maxY / (Math.abs(dy) || 1));
  const onScreen = p.z > 0 && Math.abs(dx) < width / 2 && Math.abs(dy) < height / 2;
  return { x: width / 2 + dx * k, y: height / 2 + dy * k, ring,
    bearing: Math.atan2(p.y, p.x) / R, angle, onScreen,
    // Keep guiding at large zooms even when the angular error is small.
    acquired: onScreen && Math.hypot(dx, dy) < ring };
}
