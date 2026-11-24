import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import styles from "./Layout.module.css";

interface UsePaneWidthOptions {
  storageKey: string;
  defaultWidth: number;
  min: number;
  max: number;
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** localStorage に永続化されるペイン幅 */
export function usePaneWidth({ storageKey, defaultWidth, min, max }: UsePaneWidthOptions) {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(storageKey));
    return Number.isFinite(saved) && saved > 0 ? clamp(saved, min, max) : defaultWidth;
  });
  const persist = (w: number) => localStorage.setItem(storageKey, String(w));
  return { width, setWidth: (w: number) => setWidth(clamp(w, min, max)), persist, min, max };
}

interface PaneResizerProps {
  width: number;
  min: number;
  max: number;
  onResize: (width: number) => void;
  /** ドラッグ・キー操作の確定時に呼ばれる (永続化用) */
  onCommit: (width: number) => void;
  "aria-label"?: string;
}

const KEY_STEP = 16;

/**
 * ペイン間のリサイズハンドル。
 * Pointer Capture でドラッグを追跡し、←/→ キーでも幅を変更できる。
 */
export function PaneResizer({ width, min, max, onResize, onCommit, "aria-label": ariaLabel }: PaneResizerProps) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const latest = useRef(width);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    latest.current = width;
  }, [width]);

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startWidth: width };
    setDragging(true);
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const next = clamp(drag.current.startWidth + e.clientX - drag.current.startX, min, max);
    latest.current = next;
    onResize(next);
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    onCommit(latest.current);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (e.key === "ArrowLeft") next = width - KEY_STEP;
    else if (e.key === "ArrowRight") next = width + KEY_STEP;
    else if (e.key === "Home") next = min;
    else if (e.key === "End") next = max;
    if (next == null) return;
    e.preventDefault();
    next = clamp(next, min, max);
    onResize(next);
    onCommit(next);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className={styles.resizer}
      data-dragging={dragging || undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
    />
  );
}
