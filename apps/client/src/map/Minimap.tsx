import type { PointerEvent } from 'react';
import { factionColor } from '../ui/util';
import { visibleRect, type Camera, type Viewport } from './camera';
import styles from './Minimap.module.css';
import type { Scene } from './scene';

export interface MinimapProps {
  readonly scene: Scene;
  readonly camera: Camera;
  readonly viewport: Viewport;
  /** Pitch of one plot in world units, used to pad the extent. */
  readonly pitch: number;
  readonly onJump: (wx: number, wy: number) => void;
}

/** The whole city in a corner: territory colours, the current view, click to jump. */
export function Minimap({ scene, camera, viewport, pitch, onJump }: MinimapProps) {
  const b = scene.bounds;
  const x0 = b.minX - pitch;
  const y0 = b.minY - pitch;
  const w = b.maxX - b.minX + pitch * 2;
  const h = scene.waterTop + pitch * 1.2 - y0;
  const view = visibleRect(camera, viewport);

  const jump = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    // the SVG letterboxes (xMidYMid meet), so map through the shared scale
    const k = Math.min(r.width / w, r.height / h);
    const ox = (r.width - w * k) / 2;
    const oy = (r.height - h * k) / 2;
    onJump(x0 + (e.clientX - r.left - ox) / k, y0 + (e.clientY - r.top - oy) / k);
  };

  return (
    <svg
      className={styles['minimap']}
      viewBox={`${String(x0)} ${String(y0)} ${String(w)} ${String(h)}`}
      role="img"
      aria-label="Minimap"
      onPointerDown={jump}
      onPointerMove={(e) => {
        if (e.buttons === 1) jump(e);
      }}
    >
      <rect
        className={styles['water']}
        x={x0}
        y={scene.waterTop}
        width={w}
        height={y0 + h - scene.waterTop}
      />
      {scene.districts.map((d) => (
        <rect
          key={d.id}
          className={d.remembered ? styles['fog'] : d.isHub ? styles['hub'] : styles['district']}
          x={d.cx - d.w / 2}
          y={d.cy - d.h / 2}
          width={d.w}
          height={d.h}
          style={d.remembered || d.isHub ? undefined : { fill: factionColor(d.role) }}
        />
      ))}
      <rect className={styles['view']} x={view.x} y={view.y} width={view.w} height={view.h} />
    </svg>
  );
}
