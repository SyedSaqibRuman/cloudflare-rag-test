import { useEffect, useRef, useState } from "react";
import { askStream } from "../api";
import { useCompanies } from "../context";
import { Button, Badge, ErrorBanner } from "../components/ui";
import Markdown from "../components/Markdown";

const START = "__START_RESPONSE__";

export default function AskConsole() {
  const { company, companies } = useCompanies();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(null);
  const [draftIndex, setDraftIndex] = useState(null);
  const abortRef = useRef(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  const send = async () => {
    const question = input.trim();
    if (!question || streaming) return;
    if (!company) {
      setError("Select a company in the sidebar before asking a question.");
      return;
    }

    setError(null);
    const userMsg = { role: "user", content: question };
    const assistantMsg = { role: "assistant", content: "", streaming: true };
    setMessages((m) => [...m, userMsg, assistantMsg]);
    setDraftIndex(messages.length + 1);
    setInput("");
    setStreaming(true);

    const history = messages
      .filter((m) => !(m.role === "assistant" && m.streaming))
      .map((m) => ({ role: m.role, content: m.content }));
    const fullHistory = history;

    const controller = new AbortController();
    abortRef.current = controller;

    let started = false;

    try {
      await askStream({
        question,
        history: fullHistory,
        company,
        signal: controller.signal,
        onToken: (token) => {
          if (token === START) {
            started = true;
            setMessages((m) => m.map((msg, i) => (i === draftIndex ? { ...msg, content: "" } : msg)));
            return;
          }
          if (token === "Thinking...") {
            setMessages((m) => m.map((msg, i) => (i === draftIndex ? { ...msg, content: "Thinking…", streaming: true } : msg)));
            return;
          }
          setMessages((m) =>
            m.map((msg, i) => (i === draftIndex ? { ...msg, content: msg.content + token, streaming: started } : msg))
          );
        },
        onError: (errMsg) => {
          setMessages((m) => m.map((msg, i) => (i === draftIndex ? { ...msg, content: `Error: ${errMsg}`, streaming: false } : msg)));
        },
      });
    } catch (e) {
      if (e.name !== "AbortError") {
        setMessages((m) => m.map((msg, i) => (i === draftIndex ? { ...msg, content: `Error: ${e.message}`, streaming: false } : msg)));
      }
    } finally {
      setStreaming(false);
      setDraftIndex(null);
      abortRef.current = null;
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const stop = () => {
    abortRef.current?.abort();
  };

  const clear = () => {
    if (streaming) return;
    setMessages([]);
    setError(null);
  };

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-50">Ask Console</h1>
          <p className="text-sm text-slate-400 mt-1">Test the RAG assistant with live streaming responses</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={company ? "green" : "amber"}>{company ? `Company: ${company}` : "No company selected"}</Badge>
          <Button variant="ghost" onClick={clear} disabled={streaming || messages.length === 0}>
            Clear
          </Button>
        </div>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      <div className="flex-1 overflow-y-auto rounded-xl border border-slate-800 bg-slate-900/70 p-5">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-500/15 text-indigo-300">
              <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            </div>
            <p className="text-sm font-medium text-slate-300">Ask anything about the selected company</p>
            <p className="mt-1 max-w-sm text-xs text-slate-500">
              Questions are answered using the company's vector knowledge base, hybrid search, and its configured LLM.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {messages.map((msg, i) =>
              msg.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-indigo-500/20 border border-indigo-500/30 px-4 py-2.5 text-sm text-slate-100">
                    {msg.content}
                  </div>
                </div>
              ) : (
                <div key={i} className="flex justify-start">
                  <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-slate-950 border border-slate-800 px-4 py-3">
                    {msg.streaming && msg.content === "" && (
                      <span className="inline-flex gap-1">
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400 [animation-delay:0.15s]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400 [animation-delay:0.3s]" />
                      </span>
                    )}
                    {msg.content === "Thinking…" ? (
                      <span className="text-sm italic text-slate-500">Thinking…</span>
                    ) : (
                      msg.content !== "" && <Markdown text={msg.content} />
                    )}
                  </div>
                </div>
              )
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            placeholder="Type a question and press Enter…"
            className="flex-1 resize-none rounded-lg bg-slate-950 border border-slate-700 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
          />
          {streaming ? (
            <Button variant="danger" onClick={stop}>
              Stop
            </Button>
          ) : (
            <Button onClick={send} disabled={!input.trim() || !company}>
              Send
            </Button>
          )}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          {companies.length === 0
            ? "No companies available — create one in the Companies page first."
            : "Streaming via SSE · enter to send · shift+enter for newline"}
        </p>
      </div>
    </div>
  );
}
