import { useCallback, useState } from "react";

export const CHAT_MODELS = [
  { id: "big-pickle", name: "Big Pickle", badge: "Free" },
  { id: "deepseek-v4-flash-free", name: "DeepSeek V4 Flash Free", badge: "Free" },
  { id: "mimo-v2.5-free", name: "MiMo V2.5 Free", badge: "Free" },
  { id: "north-mini-code-free", name: "North Mini Code Free", badge: "Free" },
  { id: "nemotron-3-ultra-free", name: "Nemotron 3 Ultra Free", badge: "Free" },
] as const;

export type ChatModelId = (typeof CHAT_MODELS)[number]["id"];

export type Message = {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  isImagePrompt?: boolean;
  isImagePending?: boolean;
  imageUrl?: string;
};

function getOpenCodeConfig() {
  const key = import.meta.env.VITE_OPENCODE_API_KEY || "";
  const baseUrl = import.meta.env.VITE_OPENCODE_BASE_URL || "https://opencode.ai/zen/v1";
  return { baseUrl, key };
}

export function useAIChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  const sendMessage = useCallback(async (text: string, modelId: ChatModelId, _messages: Message[]) => {
    setIsLoading(true);
    setError(null);

    setMessages((prev) => [...prev, { role: "user", content: text }]);

    try {
      const { key: apiKey, baseUrl } = getOpenCodeConfig();
      const url = `${baseUrl}/chat/completions`;

      const systemPrompt: { role: "system"; content: string } = {
        role: "system",
        content: `You are a helpful, clear, and concise AI assistant.

Guidelines:
- Answer directly — no preamble or fluff.
- Use Markdown: **bold** for key terms, \`\`\`code-fenced blocks with language tags, bullet lists.
- Keep answers short, scannable, and jargon-free.`,
      };

      const conversation = [
        systemPrompt,
        ..._messages
          .filter((msg) => !msg.isImagePrompt && !msg.isImagePending)
          .map((msg) => ({ role: msg.role, content: msg.content } as const)),
      ];
      conversation.push({ role: "user", content: text });

      // Try streaming first; fall back to non-streaming if it fails
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
          throw new Error(`Failed to connect to OpenCode.ai. Check your API key and network connection. ${fetchErr instanceof Error ? fetchErr.message : ""}`);
        }
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(
          `AI request failed: ${response.status} ${response.statusText}. ${errorText}`
        );
      }

      if (useStreaming) {
        // Stream the response via SSE
        const reader = response.body?.getReader();
        if (!reader) {
          // ReadableStream not available — read full body instead
          useStreaming = false;
        } else {
          // Add a placeholder for the streaming response
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

                  if (delta.reasoning_content) {
                    reasoningContent += delta.reasoning_content;
                  }
                  if (delta.content) {
                    fullContent += delta.content;
                  }

                  setMessages((prev) => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last?.isStreaming) {
                      let display = fullContent;
                      if (!display && reasoningContent) {
                        display = "_🧠 Thinking..._";
                      }
                      updated[updated.length - 1] = { ...last, content: display };
                    }
                    return updated;
                  });

                  if (finishReason) break;
                } catch {
                  // Skip malformed JSON chunks
                }
              }
            }
          } catch {
            streamError = true;
          }

          if (streamError) {
            // Streaming failed mid-way — remove placeholder and fall through to non-streaming
            setMessages((prev) => prev.filter((m) => !m.isStreaming));
            useStreaming = false;
          } else {
            // Finalise streaming
            const finalContent = fullContent || (reasoningContent ? `_🧠 Reasoning:_\n\n${reasoningContent}` : "No response.");
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last?.isStreaming) {
                updated[updated.length - 1] = { role: "assistant", content: finalContent, isStreaming: false };
              }
              return updated;
            });
          }
        }
      }

      if (!useStreaming) {
        // Non-streaming fallback — read the full body at once
        const responseText = await response.text();
        let data = null;
        try {
          data = JSON.parse(responseText);
        } catch {
          // ignore
        }

        const choice = data?.choices?.[0]?.message;
        let content =
          choice?.content ||
          choice?.reasoning_content ||
          data?.choices?.[0]?.text ||
          data?.reply ||
          (typeof responseText === "string" ? responseText : "No response.");

        if (choice?.reasoning_content && !choice?.content) {
          content = `_🧠 Reasoning:_\n\n${choice.reasoning_content}\n\n---\n_⏳ The response was cut off. Try asking again or rephrase for a shorter answer._`;
        }

        setMessages((prev) => [...prev, { role: "assistant", content }]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send message.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    clearMessages,
  };
}
