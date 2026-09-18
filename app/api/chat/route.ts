import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = process.env.CHAT_MODEL ?? "gpt-5.6-luna";
const BASE_URL = process.env.CHAT_BASE_URL ?? "https://api.avalai.ir/v1";
const SYSTEM_PROMPT =
  process.env.CHAT_SYSTEM_PROMPT ??
  "You are a helpful assistant. Answer clearly and concisely.";

/**
 * Some models return reasoning in a separate `reasoning_content` field, others
 * wrap it in tags inside the normal content. Both are handled. If your model
 * uses different markers, change these two.
 */
const OPEN = "<think>";
const CLOSE = "</think>";

type Mode = "text" | "thinking";

/** Splits tagged reasoning out of the content stream, tolerating tags that
 *  arrive split across two chunks. */
function createSplitter(emit: (mode: Mode, text: string) => void) {
  let mode: Mode = "text";
  let buffer = "";

  const heldTail = (s: string, tag: string) => {
    for (let n = Math.min(s.length, tag.length - 1); n > 0; n--) {
      if (tag.startsWith(s.slice(s.length - n))) return n;
    }
    return 0;
  };

  return {
    push(chunk: string) {
      buffer += chunk;

      for (;;) {
        const tag = mode === "text" ? OPEN : CLOSE;
        const at = buffer.indexOf(tag);
        if (at === -1) break;
        if (at > 0) emit(mode, buffer.slice(0, at));
        buffer = buffer.slice(at + tag.length);
        mode = mode === "text" ? "thinking" : "text";
      }

      const held = heldTail(buffer, mode === "text" ? OPEN : CLOSE);
      const ready = buffer.slice(0, buffer.length - held);
      if (ready) emit(mode, ready);
      buffer = buffer.slice(buffer.length - held);
    },
    flush() {
      if (buffer) emit(mode, buffer);
      buffer = "";
    },
  };
}

type ClientTurn = { role: "user" | "bot"; text: string };

export async function POST(req: Request) {
  const apiKey = process.env.AVALAI_API_KEY;
  if (!apiKey) {
    return new Response("AVALAI_API_KEY is not set on the server.", {
      status: 500,
    });
  }

  const { message, history = [] } = (await req.json()) as {
    message?: string;
    history?: ClientTurn[];
  };

  if (typeof message !== "string" || !message.trim()) {
    return new Response("A message is required.", { status: 400 });
  }

  const client = new OpenAI({ apiKey, baseURL: BASE_URL });

  // The browser holds the transcript, so the whole conversation is rebuilt
  // each turn — same effect as the `messages` list in the terminal version.
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history
      .filter((t) => t.text.trim())
      .map((t) => ({
        role: t.role === "bot" ? ("assistant" as const) : ("user" as const),
        content: t.text,
      })),
    { role: "user", content: message },
  ];

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;

      const send = (payload: Record<string, unknown>) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
        );
      };

      const splitter = createSplitter((mode, text) => send({ type: mode, text }));

      try {
        const completion = await client.chat.completions.create(
          {
            model: MODEL,
            messages,
            stream: true,
            stream_options: { include_usage: true },
          },
          { signal: req.signal }
        );

        for await (const chunk of completion) {
          const delta = chunk.choices[0]?.delta as
            | { content?: string | null; reasoning_content?: string | null }
            | undefined;

          const reasoning = delta?.reasoning_content;
          if (reasoning) send({ type: "thinking", text: reasoning });
          if (delta?.content) splitter.push(delta.content);

          if (chunk.usage) {
            send({
              type: "usage",
              in: chunk.usage.prompt_tokens,
              out: chunk.usage.completion_tokens,
            });
          }
        }

        splitter.flush();
      } catch (err) {
        splitter.flush();
        send({ type: "error", text: describe(err) });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

/** Same failure cases the terminal version printed, worded for a reader. */
function describe(err: unknown): string {
  if (err instanceof OpenAI.APIError) {
    if (err.status === 401) return "The API key was rejected. Check AVALAI_API_KEY.";
    if (err.status === 429)
      return "Rate limited or out of quota. Wait a moment and send it again.";
    if (err.status === 404)
      return `The model ${MODEL} was not found on this endpoint.`;
    return `The API returned ${err.status}: ${err.message}`;
  }
  if (err instanceof Error && err.name === "AbortError") return "";
  return `Could not reach ${BASE_URL}.`;
}
