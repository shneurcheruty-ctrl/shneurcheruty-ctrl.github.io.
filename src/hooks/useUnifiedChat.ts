import { useState, useCallback, useRef } from "react";
import type { Message } from "./useAIChat";
import type { ImageModelId, Ratio } from "./useAIImage";
import { useTransformers } from "./useTransformers";

export type { Message };
export { CHAT_MODELS } from "./useAIChat";
export type { ChatModelId } from "./useAIChat";
export { IMAGE_MODELS, RATIOS } from "./useAIImage";
export type { ImageModelId, Ratio } from "./useAIImage";

export type InputMode = "chat" | "image";

// ── Helpers copied from useAIChat ──────────────────────────────────────────

function getOpenCodeConfig() {
  const key = import.meta.env.VITE_OPENCODE_API_KEY || "";
  const baseUrl = import.meta.env.VITE_OPENCODE_BASE_URL || "https://opencode.ai/zen/v1";
  return { baseUrl, key };
}

function buildSystemPrompt(): { role: "system"; content: string } {
  return {
    role: "system",
    content: `You are a helpful, clear, and concise AI assistant.

Guidelines:
- Answer directly — no preamble or fluff.
- Use Markdown: **bold** for key terms, \`\`\`code-fenced blocks with language tags, bullet lists.
- Keep answers short, scannable, and jargon-free.`,
  };
}

// ── Image helpers copied from useAIImage ────────────────────────────────────

function promptSeed(prompt: string): number {
  let hash = 0;
  for (let i = 0; i < prompt.length; i++) {
    hash = ((hash << 5) - hash + prompt.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getA1111Url(): string {
  if (import.meta.env.DEV) return "/a1111";
  return import.meta.env.VITE_A1111_URL || "http://127.0.0.1:7860";
}

function resolveImageSize(ratio: Ratio): { width: number; height: number } {
  switch (ratio) {
    case "16:9": return { width: 256, height: 144 };
    case "9:16": return { width: 144, height: 256 };
    default:     return { width: 256, height: 256 };
  }
}

function snapTo64(v: number): number {
  const rem = v % 64;
  if (rem === 0) return v;
  // Round to nearest multiple of 64 (minimum 64)
  return Math.max(64, Math.round(v / 64) * 64);
}

function resolveA1111Size(ratio: Ratio): { width: number; height: number } {
  switch (ratio) {
    case "16:9": return { width: snapTo64(768), height: snapTo64(432) };
    case "9:16": return { width: snapTo64(432), height: snapTo64(768) };
    default:     return { width: snapTo64(512), height: snapTo64(512) };
  }
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useUnifiedChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<InputMode>("chat");

  // Transformers.js
  const tf = useTransformers();

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  // ── Send chat message (streaming) ──────────────────────────────────────
  const sendChat = useCallback(async (text: string, modelId: string) => {
    setIsLoading(true);
    setError(null);

    const userMsg: Message = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const { key: apiKey, baseUrl } = getOpenCodeConfig();
      const url = `${baseUrl}/chat/completions`;

      const conversation = [
        buildSystemPrompt(),
        ...messages
          .filter((msg) => !msg.isImagePrompt && !msg.isImagePending)
          .map((msg) => ({ role: msg.role, content: msg.content } as const)),
      ];
      conversation.push({ role: "user", content: text } as const);

      let response;
      let useStreaming = true;

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

      try {
        response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: modelId,
            messages: conversation,
            stream: true,
            max_tokens: 4096,
            temperature: 0.5,
          }),
        });
      } catch {
        useStreaming = false;
        try {
          response = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({
              model: modelId,
              messages: conversation,
              max_tokens: 4096,
              temperature: 0.5,
            }),
          });
        } catch (fetchErr) {
          throw new Error(
            `Failed to connect. Check your API key and network. ${fetchErr instanceof Error ? fetchErr.message : ""}`
          );
        }
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`AI request failed: ${response.status}. ${errorText}`);
      }

      if (useStreaming) {
        const reader = response.body?.getReader();
        if (!reader) {
          useStreaming = false;
        } else {
          setMessages((prev) => [...prev, { role: "assistant", content: "", isStreaming: true }]);

          const decoder = new TextDecoder();
          let buffer = "";
          let fullContent = "";
          let reasoningContent = "";
          let streamError = false;

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() || "";

              for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                const data = line.slice(6).trim();
                if (data === "[DONE]") break;
                try {
                  const chunk = JSON.parse(data);
                  const delta = chunk?.choices?.[0]?.delta || {};
                  const finishReason = chunk?.choices?.[0]?.finish_reason;
                  if (delta.reasoning_content) reasoningContent += delta.reasoning_content;
                  if (delta.content) fullContent += delta.content;

                  setMessages((prev) => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last?.isStreaming) {
                      updated[updated.length - 1] = {
                        ...last,
                        content: fullContent || (reasoningContent ? "_🧠 Thinking..._" : ""),
                      };
                    }
                    return updated;
                  });
                  if (finishReason) break;
                } catch { /* skip malformed */ }
              }
            }
          } catch {
            streamError = true;
          }

          if (streamError) {
            setMessages((prev) => prev.filter((m) => !m.isStreaming));
            useStreaming = false;
          } else {
            const finalContent =
              fullContent ||
              (reasoningContent ? `_🧠 Reasoning:_\n\n${reasoningContent}` : "No response.");
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last?.isStreaming) {
                updated[updated.length - 1] = {
                  role: "assistant",
                  content: finalContent,
                  isStreaming: false,
                };
              }
              return updated;
            });
          }
        }
      }

      if (!useStreaming) {
        const responseText = await response.text();
        let data = null;
        try { data = JSON.parse(responseText); } catch { /* ignore */ }

        const choice = data?.choices?.[0]?.message;
        let content =
          choice?.content ||
          choice?.reasoning_content ||
          data?.choices?.[0]?.text ||
          data?.reply ||
          responseText;

        if (choice?.reasoning_content && !choice?.content) {
          content = `_🧠 Reasoning:_\n\n${choice.reasoning_content}\n\n---\n_⏳ Response was cut off._`;
        }

        setMessages((prev) => [...prev, { role: "assistant", content }]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send message.");
    } finally {
      setIsLoading(false);
    }
  }, [messages]);

  // ── Generate image ────────────────────────────────────────────────────
  const generateImage = useCallback(
    async (prompt: string, model: ImageModelId, ratio: Ratio) => {
      setIsGeneratingImage(true);
      setError(null);

      const userMsg: Message = { role: "user", content: prompt, isImagePrompt: true };
      setMessages((prev) => [...prev, userMsg]);
      // Placeholder for image loading
      setMessages((prev) => [...prev, { role: "assistant", content: prompt, isImagePending: true }]);

      try {
        let result: { url: string };

        if (model === "automatic1111") {
          const { width, height } = resolveA1111Size(ratio);
          const baseUrl = getA1111Url();

          let probe;
          try { probe = await fetch(baseUrl, { method: "HEAD" }); } catch {
            throw new Error(
              `Cannot reach A1111 at ${baseUrl}. Start SD WebUI with --api flag:\n  ./webui.sh --api`
            );
          }

          const resp = await fetch(`${baseUrl}/sdapi/v1/txt2img`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt,
              negative_prompt: "",
              width,
              height,
              seed: -1,
              steps: 20,
              cfg_scale: 7,
              sampler_name: "Euler",
              save_images: false,
            }),
          });

          const bodyText = await resp.text();
          if (!resp.ok) {
            let detail = bodyText;
            try { const j = JSON.parse(bodyText); if (j.detail) detail = j.detail; } catch { /* raw */ }
            throw new Error(`A1111 HTTP ${resp.status}: ${detail}`);
          }
          const data = JSON.parse(bodyText);
          const b64 = data.images?.[0];
          if (!b64) throw new Error("A1111 returned no images");
          const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
          result = { url: URL.createObjectURL(blob) };
        } else {
          // Pollinations
          const { width, height } = resolveImageSize(ratio);
          const encoded = encodeURIComponent(prompt);
          const seed = promptSeed(prompt);
          result = {
            url: `https://image.pollinations.ai/prompt/${encoded}?width=${width}&height=${height}&seed=${seed}&nologo=true`,
          };
        }

        // Replace the placeholder with the actual image
        setMessages((prev) => {
          const updated = [...prev];
          for (let i = updated.length - 1; i >= 0; i--) {
            if (updated[i]?.isImagePending) {
              updated[i] = { role: "assistant", content: prompt, imageUrl: result.url };
              break;
            }
          }
          return updated;
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Image generation failed";
        setError(msg);
        // Remove the placeholder on error
        setMessages((prev) => prev.filter((m) => !m.isImagePending));
      } finally {
        setIsGeneratingImage(false);
      }
    },
    []
  );

  // ── Send (routes to chat or image depending on inputMode) ──────────────
  const send = useCallback(
    async (text: string, chatModelId: string, imageModelId: ImageModelId, ratio: Ratio) => {
      if (inputMode === "image") {
        await generateImage(text, imageModelId, ratio);
      } else {
        await sendChat(text, chatModelId);
      }
    },
    [inputMode, generateImage, sendChat]
  );

  return {
    messages,
    isLoading,
    isGeneratingImage,
    error,
    inputMode,
    setInputMode,
    send,
    sendChat,
    generateImage,
    clearMessages,
    transformers: tf,
  };
}
