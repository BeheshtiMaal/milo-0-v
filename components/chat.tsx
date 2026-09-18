"use client";

import { useEffect, useRef, useState } from "react";
import ThinkingBlock from "./thinking-block";

type Turn = {
  id: string;
  role: "user" | "bot";
  text: string;
  thinking?: string;
  thinkingMs?: number;
  streaming?: boolean;
  usage?: { in: number; out: number };
};

export default function Chat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    transcript.current?.scrollTo({ top: transcript.current.scrollHeight });
  }, [turns]);

  function resize() {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  function patch(id: string, fn: (t: Turn) => Turn) {
    setTurns((prev) => prev.map((t) => (t.id === id ? fn(t) : t)));
  }

  async function send() {
    const message = draft.trim();
    if (!message || busy) return;

    setError(null);
    setDraft("");
    requestAnimationFrame(resize);

    const botId = crypto.randomUUID();
    const history = turns.map(({ role, text }) => ({ role, text }));

    setTurns((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", text: message },
      { id: botId, role: "bot", text: "", thinking: "", streaming: true },
    ]);
    setBusy(true);

    const controller = new AbortController();
    abort.current = controller;
    const startedAt = Date.now();
    let sawAnswer = false;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`The chatbot process returned ${res.status}.`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;

          const event = JSON.parse(line.slice(6)) as {
            type: "thinking" | "text" | "usage" | "error";
            text?: string;
            in?: number;
            out?: number;
          };

          if (event.type === "thinking") {
            patch(botId, (t) => ({ ...t, thinking: (t.thinking ?? "") + event.text }));
          } else if (event.type === "text") {
            if (!sawAnswer) {
              sawAnswer = true;
              const ms = Date.now() - startedAt;
              patch(botId, (t) => ({ ...t, thinkingMs: ms }));
            }
            patch(botId, (t) => ({ ...t, text: t.text + event.text }));
          } else if (event.type === "usage") {
            patch(botId, (t) => ({
              ...t,
              usage: { in: event.in ?? 0, out: event.out ?? 0 },
            }));
          } else if (event.type === "error" && event.text) {
            setError(event.text);
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(
          (err as Error).message ||
            "Could not reach the chatbot. Check that the process starts from your terminal."
        );
      }
    } finally {
      patch(botId, (t) => ({
        ...t,
        streaming: false,
        thinkingMs: t.thinkingMs ?? Date.now() - startedAt,
      }));
      setBusy(false);
      abort.current = null;
      field.current?.focus();
    }
  }

  return (
    <div className="shell">
      <header className="masthead">
        <h1>Console</h1>
        <span className="status">
          <span className="dot" aria-hidden />
          {busy ? "Working" : "Ready"}
        </span>
      </header>

      <div className="transcript" ref={transcript}>
        {turns.length === 0 && (
          <div className="empty">
            <strong>Ask the first question.</strong>
            Answers stream in as the process writes them. Reasoning shows above
            each answer and folds away once the reply begins.
          </div>
        )}

        {turns.map((turn) =>
          turn.role === "user" ? (
            <div key={turn.id} className="turn turn-user">
              {turn.text}
            </div>
          ) : (
            <div key={turn.id} className="turn turn-bot">
              <ThinkingBlock
                text={turn.thinking ?? ""}
                active={Boolean(turn.streaming) && !turn.text}
                durationMs={turn.thinkingMs}
              />
              <Answer text={turn.text} streaming={Boolean(turn.streaming)} />
              {turn.usage && !turn.streaming && (
                <p className="usage">
                  {turn.usage.in} tokens in, {turn.usage.out} out
                </p>
              )}
            </div>
          )
        )}

        {error && <div className="error">{error}</div>}
      </div>

      <div className="composer">
        <div className="composer-field">
          <textarea
            ref={field}
            rows={1}
            value={draft}
            placeholder="Send a message"
            onChange={(e) => {
              setDraft(e.target.value);
              resize();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          {busy ? (
            <button
              type="button"
              className="send send-stop"
              onClick={() => abort.current?.abort()}
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="send"
              disabled={!draft.trim()}
              onClick={send}
            >
              Send
            </button>
          )}
        </div>
        <p className="hint">Enter sends, Shift + Enter adds a line.</p>
      </div>
    </div>
  );
}

/** Renders the answer, keeping fenced code blocks intact. */
function Answer({ text, streaming }: { text: string; streaming: boolean }) {
  if (!text) return streaming ? <span className="caret" /> : null;

  const parts = text.split(/```/);

  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <pre key={i}>
            <code>{part.replace(/^[a-z]*\n/i, "")}</code>
          </pre>
        ) : (
          part
            .split(/\n{2,}/)
            .filter(Boolean)
            .map((para, j, all) => (
              <p key={`${i}-${j}`} style={{ whiteSpace: "pre-wrap" }}>
                {para}
                {streaming &&
                  i === parts.length - 1 &&
                  j === all.length - 1 && <span className="caret" />}
              </p>
            ))
        )
      )}
    </>
  );
}
