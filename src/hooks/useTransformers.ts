import { useState, useRef, useCallback } from "react";

export type Sentiment = { label: string; score: number };
export type Intent = { label: "image" | "chat" | "summarize"; score: number };

type Pipeline = any;
type PipelineType =
  | "sentiment-analysis"
  | "zero-shot-classification"
  | "summarization"
  | "feature-extraction";

/**
 * Hook that lazily loads @xenova/transformers and exposes useful local-AI pipelines.
 * Gracefully degrades — if loading fails the app keeps working without Transformers.
 */
export function useTransformers() {
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const pipelines = useRef<Map<PipelineType, Pipeline>>(new Map());
  const loadPromise = useRef<Promise<void> | null>(null);

  const ensureLoaded = useCallback(async () => {
    if (status === "ready" || status === "loading") return;
    if (loadPromise.current) return loadPromise.current;

    setStatus("loading");
    loadPromise.current = (async () => {
      try {
        const { pipeline, env } = await import("@xenova/transformers");
        env.allowLocalModels = false;
        env.remoteHost = "https://huggingface.co";
        env.remotePathTemplate = "{model}/resolve/{revision}/onnx/{file}";

        // Pre-warm the most useful pipeline (tiny model)
        const sentimentPipe = await pipeline("sentiment-analysis", "Xenova/distilbert-base-uncased-finetuned-sst-2-english", {
          quantized: true,
        });
        pipelines.current.set("sentiment-analysis", sentimentPipe);

        setStatus("ready");
      } catch (err) {
        console.warn("[Transformers.js] Failed to load:", err);
        setStatus("error");
        setError(err instanceof Error ? err.message : "Failed to load Transformers.js");
      }
    })();

    return loadPromise.current;
  }, [status]);

  /** Classify message sentiment (positive / negative) */
  const classifySentiment = useCallback(
    async (text: string): Promise<Sentiment[]> => {
      await ensureLoaded();
      const pipe = pipelines.current.get("sentiment-analysis");
      if (!pipe) return [{ label: "neutral", score: 1 }];
      try {
        const result = await pipe(text);
        return result as Sentiment[];
      } catch {
        return [{ label: "neutral", score: 1 }];
      }
    },
    [ensureLoaded]
  );

  /** Zero-shot intent detection — is this about images, chat, or summarization? */
  const detectIntent = useCallback(
    async (text: string): Promise<Intent> => {
      await ensureLoaded();
      const pipe = pipelines.current.get("zero-shot-classification");
      if (!pipe) return { label: "chat", score: 1 };

      try {
        const result = await pipe(text, ["image generation", "chat conversation", "summarization"], {
          multiLabel: false,
        });
        const labels: string[] = result.labels;
        const scores: number[] = result.scores;
        const bestIdx = scores.indexOf(Math.max(...scores));
        const labelMap: Record<string, Intent["label"]> = {
          "image generation": "image",
          "chat conversation": "chat",
          summarization: "summarize",
        };
        return {
          label: labelMap[labels[bestIdx]] || "chat",
          score: scores[bestIdx],
        };
      } catch {
        return { label: "chat", score: 1 };
      }
    },
    [ensureLoaded]
  );

  /** Summarize a block of text */
  const summarize = useCallback(
    async (text: string): Promise<string> => {
      const pipe = pipelines.current.get("summarization");
      if (!pipe) return text;

      // Load summarization pipeline on demand
      try {
        const { pipeline } = await import("@xenova/transformers");
        const sumPipe = await pipeline("summarization", "Xenova/distilbart-cnn-6-6", {
          quantized: true,
        });
        pipelines.current.set("summarization", sumPipe);
        const result = await sumPipe(text, { max_length: 130, min_length: 30 });
        return (result as any)[0]?.summary_text || text;
      } catch {
        return text;
      }
    },
    []
  );

  return {
    status,
    error,
    isReady: status === "ready",
    isLoading: status === "loading",
    ensureLoaded,
    classifySentiment,
    detectIntent,
    summarize,
  };
}
