"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  text: string;
  /** True while reasoning is still streaming in. */
  active: boolean;
  /** Milliseconds spent reasoning, set once the answer starts. */
  durationMs?: number;
};

export default function ThinkingBlock({ text, active, durationMs }: Props) {
  const [open, setOpen] = useState(active);
  const [elapsed, setElapsed] = useState(0);
  const pinned = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const startedAt = useRef<number | null>(null);

  // Open while reasoning, fold away once the answer starts — unless the
  // reader has expressed a preference by clicking.
  useEffect(() => {
    if (!pinned.current) setOpen(active);
  }, [active]);

  // Live timer.
  useEffect(() => {
    if (!active) return;
    startedAt.current ??= Date.now();
    const id = setInterval(() => {
      setElapsed(Date.now() - (startedAt.current ?? Date.now()));
    }, 100);
    return () => clearInterval(id);
  }, [active]);

  // Keep the newest line in view as it streams.
  useEffect(() => {
    if (open && active && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [text, open, active]);

  if (!text && !active) return null;

  const seconds = ((durationMs ?? elapsed) / 1000).toFixed(1);
  const label = active ? "Thinking" : `Thought for ${seconds}s`;

  return (
    <div className="thinking" data-active={active} data-open={open}>
      <button
        type="button"
        className="thinking-toggle"
        aria-expanded={open}
        onClick={() => {
          pinned.current = true;
          setOpen((v) => !v);
        }}
      >
        <span className="thinking-pip" aria-hidden />
        <span>{label}</span>
        <svg
          className="thinking-chevron"
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          aria-hidden
        >
          <path
            d="M3 1.5 6.5 5 3 8.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {open && (
        <div className="thinking-body" ref={bodyRef}>
          {text}
        </div>
      )}
    </div>
  );
}
