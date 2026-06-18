import { useState, useRef, useEffect, useCallback } from "react";
import { trackEvent } from "@enter-pro/analytics-sdk";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Send,
  Bot,
  User,
  Trash2,
  Zap,
  ImageIcon,
  MessageSquare,
  Loader2,
  Download,
  Brain,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useUnifiedChat,
  CHAT_MODELS,
  IMAGE_MODELS,
  RATIOS,
  type ChatModelId,
  type ImageModelId,
  type Ratio,
  type Message,
  type InputMode,
} from "@/hooks/useUnifiedChat";

// ── Image Bubble ────────────────────────────────────────────────────────────

function ImageBubble({ url, prompt }: { url: string; prompt: string }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        {!loaded && (
          <div className="flex h-32 w-48 items-center justify-center rounded-xl border border-border bg-muted">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        <img
          src={url}
          alt={prompt}
          onLoad={() => setLoaded(true)}
          className={cn(
            "max-w-xs rounded-xl border border-border shadow-message object-cover transition-opacity duration-300",
            loaded ? "opacity-100" : "absolute inset-0 opacity-0 pointer-events-none"
          )}
          style={{ maxHeight: 360 }}
        />
      </div>
      {loaded && (
        <a
          href={url}
          download="generated-image.png"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit"
        >
          <Download className="h-3 w-3" />
          Download
        </a>
      )}
    </div>
  );
}

// ── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  const isWaiting = msg.isStreaming && !msg.content;

  return (
    <div className={cn("flex items-start gap-3", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
          !isUser && "bg-secondary border border-border"
        )}
        style={isUser ? { background: "var(--gradient-primary)", boxShadow: "var(--shadow-soft)" } : undefined}
      >
        {isUser ? (
          msg.isImagePrompt ? (
            <ImageIcon className="h-3.5 w-3.5 text-primary-foreground" />
          ) : (
            <User className="h-3.5 w-3.5 text-primary-foreground" />
          )
        ) : (
          <Bot className="h-3.5 w-3.5 text-foreground" />
        )}
      </div>

      {isUser ? (
        <div
          className="max-w-[80%] rounded-2xl rounded-tr-sm px-4 py-3 text-sm leading-relaxed text-primary-foreground"
          style={{ background: "var(--gradient-primary)", boxShadow: "var(--shadow-soft)" }}
        >
          {msg.isImagePrompt && (
            <span className="block text-[10px] font-medium opacity-70 mb-0.5 uppercase tracking-wide">🎨 Image prompt</span>
          )}
          <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
        </div>
      ) : (
        <div className="max-w-[80%] rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-3 text-sm leading-relaxed text-card-foreground shadow-message">
          {msg.isImagePending ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-xs">Generating image…</span>
            </div>
          ) : isWaiting ? (
            <div className="flex items-center gap-1">
              {[0, 1, 2].map((d) => (
                <span
                  key={d}
                  className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce"
                  style={{ animationDelay: `${d * 0.15}s` }}
                />
              ))}
            </div>
          ) : msg.imageUrl ? (
            <ImageBubble url={msg.imageUrl} prompt={msg.content} />
          ) : (
            <pre className="whitespace-pre-wrap font-sans">
              {msg.content}
              {msg.isStreaming && (
                <span className="inline-block w-1.5 h-4 bg-current animate-pulse ml-0.5 align-middle" />
              )}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ── Transformers Status Badge ────────────────────────────────────────────────

function TransformersBadge({
  status,
  onLoad,
}: {
  status: "idle" | "loading" | "ready" | "error";
  onLoad: () => void;
}) {
  if (status === "idle") {
    return (
      <button
        onClick={onLoad}
        className="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        title="Load Transformers.js for local AI features (sentiment, summaries)"
      >
        <Brain className="h-3 w-3" />
        <span>Load local AI</span>
      </button>
    );
  }
  if (status === "loading") {
    return (
      <div className="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>Loading local AI…</span>
      </div>
    );
  }
  if (status === "ready") {
    return (
      <div className="flex items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2 py-0.5 text-[10px] text-primary">
        <Sparkles className="h-3 w-3" />
        <span>Local AI ready</span>
      </div>
    );
  }
  return null;
}

// ── Suggestions ──────────────────────────────────────────────────────────────

const SUGGESTIONS = [
  { text: "Explain quantum computing simply", mode: "chat" as const },
  { text: "Write a Python sorting function", mode: "chat" as const },
  { text: "A serene mountain lake at sunset", mode: "image" as const },
  { text: "Futuristic city skyline with neon lights", mode: "image" as const },
];

// ── Page ─────────────────────────────────────────────────────────────────────

const Index = () => {
  const {
    messages,
    isLoading,
    isGeneratingImage,
    error,
    inputMode,
    setInputMode,
    send,
    clearMessages,
    transformers,
  } = useUnifiedChat();

  const [input, setInput] = useState("");
  const [selectedChatModel, setSelectedChatModel] = useState<ChatModelId>("big-pickle");
  const [selectedImageModel, setSelectedImageModel] = useState<ImageModelId>("pollinations");
  const [selectedRatio, setSelectedRatio] = useState<Ratio>("1:1");
  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const busy = isLoading || isGeneratingImage;

  const chatModelName = CHAT_MODELS.find((m) => m.id === selectedChatModel)?.name ?? "AI";
  const imageModelName = IMAGE_MODELS.find((m) => m.id === selectedImageModel)?.name ?? "";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [input]);

  // ── Handlers ───────────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    setInput("");
    trackEvent(inputMode === "chat" ? "message_sent" : "image_generation_requested", {
      eventType: "conversion",
      properties: { prompt: trimmed, model: inputMode === "chat" ? selectedChatModel : selectedImageModel },
    });
    await send(trimmed, selectedChatModel, selectedImageModel, selectedRatio);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [input, busy, inputMode, send, selectedChatModel, selectedImageModel, selectedRatio]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSummarize = useCallback(async () => {
    const text = messages
      .filter((m) => !m.isImagePrompt && !m.isImagePending && m.content)
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");
    if (!text || isSummarizing) return;
    setIsSummarizing(true);
    try {
      const summary = await transformers.summarize(text);
      setSummaryText(summary);
    } catch {
      setSummaryText("Could not summarize.");
    } finally {
      setIsSummarizing(false);
    }
  }, [messages, transformers, isSummarizing]);

  // ── Render ─────────────────────────────────────────────────────────────

  const placeholder =
    inputMode === "chat"
      ? `Message ${chatModelName}… (Enter to send)`
      : `Describe an image… (Enter to generate via ${imageModelName})`;

  return (
    <div className="flex h-full w-full flex-col bg-background">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3 shadow-message">
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{ background: "var(--gradient-primary)", boxShadow: "var(--shadow-soft)" }}
          >
            <Zap className="h-4 w-4 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-foreground">AI Studio</h1>
            <p className="text-xs text-muted-foreground">
              {inputMode === "chat" ? `Chat via ${chatModelName}` : `Generate via ${imageModelName}`}
              {messages.length > 0 && ` · ${messages.length} messages`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <TransformersBadge status={transformers.status} onLoad={transformers.ensureLoaded} />
          {messages.length > 4 && transformers.isReady && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSummarize}
              disabled={isSummarizing}
              className="gap-1 text-xs text-muted-foreground h-7"
            >
              {isSummarizing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Brain className="h-3 w-3" />
              )}
              Summarize
            </Button>
          )}
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearMessages}
              className="gap-1 text-xs text-muted-foreground hover:text-destructive h-7"
            >
              <Trash2 className="h-3 w-3" />
              Clear
            </Button>
          )}
        </div>
      </header>

      {/* ── Messages ────────────────────────────────────────────────────── */}
      <ScrollArea className="flex-1 scrollbar-thin">
        <div className="mx-auto max-w-2xl space-y-6 p-4 pb-2">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
              <div
                className="flex h-16 w-16 items-center justify-center rounded-2xl"
                style={{ background: "var(--gradient-primary)", boxShadow: "var(--shadow-soft)" }}
              >
                <Zap className="h-8 w-8 text-primary-foreground" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-foreground">AI Studio</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Chat, generate images, summarize — all in one place.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.text}
                    onClick={() => {
                      setInput(s.text);
                      setInputMode(s.mode);
                    }}
                    className="rounded-xl border border-border bg-card px-4 py-2.5 text-left text-sm text-muted-foreground shadow-message transition-all hover:border-primary/40 hover:text-foreground"
                  >
                    {s.mode === "image" && <span className="mr-1">🎨</span>}
                    {s.mode === "chat" && <span className="mr-1">💬</span>}
                    {s.text}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground/60">
                Toggle 💬 Chat / 🎨 Image mode below. Press <kbd className="rounded border bg-muted px-1">Enter</kbd> to send.
              </p>
            </div>
          )}

          {messages.map((msg, i) => (
            <MessageBubble key={i} msg={msg} />
          ))}

          {summaryText && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">📋 Summary</span>
                <button
                  onClick={() => setSummaryText(null)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  ✕
                </button>
              </div>
              <p className="mt-1 text-muted-foreground">{summaryText}</p>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* ── Bottom bar ──────────────────────────────────────────────────── */}
      <div className="border-t border-border bg-card p-4">
        <div className="mx-auto max-w-2xl space-y-2">
          {/* Controls row */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Input mode toggle */}
            <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-1">
              <button
                onClick={() => setInputMode("chat")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                  inputMode === "chat"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <MessageSquare className="h-3 w-3" />
                Chat
              </button>
              <button
                onClick={() => setInputMode("image")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                  inputMode === "image"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <ImageIcon className="h-3 w-3" />
                Image
              </button>
            </div>

            {/* Chat model selector (always visible) */}
            <Select value={selectedChatModel} onValueChange={(v) => setSelectedChatModel(v as ChatModelId)}>
              <SelectTrigger className="h-7 w-auto min-w-36 max-w-48 text-xs border-border bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHAT_MODELS.map((m) => (
                  <SelectItem key={m.id} value={m.id} className="text-xs">
                    <span className="font-medium">{m.name}</span>
                    <span className="ml-1.5 text-muted-foreground">{m.badge}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Image model selector (always visible) */}
            <Select value={selectedImageModel} onValueChange={(v) => setSelectedImageModel(v as ImageModelId)}>
              <SelectTrigger className="h-7 w-auto min-w-32 max-w-44 text-xs border-border bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {IMAGE_MODELS.map((m) => (
                  <SelectItem key={m.id} value={m.id} className="text-xs">
                    <span className="font-medium">{m.name}</span>
                    <span className="ml-1.5 text-muted-foreground">{m.badge}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Ratio buttons — only in image mode */}
            {inputMode === "image" && (
              <div className="flex items-center gap-1">
                {RATIOS.map((r) => (
                  <button
                    key={r}
                    onClick={() => setSelectedRatio(r)}
                    className={cn(
                      "rounded-md px-2 py-1 text-[11px] font-medium transition-all border",
                      selectedRatio === r
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-muted-foreground hover:text-foreground bg-background"
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Input row */}
          <div className="flex items-end gap-2 rounded-2xl border border-border bg-background p-2 shadow-message transition-all focus-within:border-primary/50">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              rows={1}
              disabled={busy}
              className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent p-1.5 text-sm outline-none placeholder:text-muted-foreground text-foreground disabled:opacity-50"
            />
            <Button
              variant="gradient"
              onClick={handleSend}
              disabled={!input.trim() || busy}
              size="sm"
              className="h-8 w-8 shrink-0 rounded-xl p-0"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>

          <p className="text-center text-[11px] text-muted-foreground">
            AI can make mistakes. Verify important information.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Index;
