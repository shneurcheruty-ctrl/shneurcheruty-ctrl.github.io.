import { useCallback } from "react";

export const IMAGE_MODELS = [
  { id: "pollinations", name: "Pollinations AI", badge: "Free" },
  { id: "automatic1111", name: "AUTOMATIC1111", badge: "Local" },
] as const;

export const RATIOS = ["1:1", "16:9", "9:16"] as const;

export type ImageModelId = (typeof IMAGE_MODELS)[number]["id"];
export type Ratio = (typeof RATIOS)[number];

// Pollinations sizes
function resolveImageSize(ratio: Ratio): { width: number; height: number } {
  switch (ratio) {
    case "16:9":
      return { width: 256, height: 144 };
    case "9:16":
      return { width: 144, height: 256 };
    default:
      return { width: 256, height: 256 };
  }
}

// A1111 sizes
function snapTo64(v: number): number {
  const rem = v % 64;
  if (rem === 0) return v;
  return Math.max(64, Math.round(v / 64) * 64);
}

function resolveA1111Size(ratio: Ratio): { width: number; height: number } {
  switch (ratio) {
    case "16:9":
      return { width: snapTo64(768), height: snapTo64(432) };
    case "9:16":
      return { width: snapTo64(432), height: snapTo64(768) };
    default:
      return { width: snapTo64(512), height: snapTo64(512) };
  }
}

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

// ── Hook ───────────────────────────────────────────────────────────────────
export function useAIImage() {
  const generateImage = useCallback(
    async (prompt: string, model: ImageModelId, ratio: Ratio) => {
      if (model === "automatic1111") {
        const { width, height } = resolveA1111Size(ratio);
        const baseUrl = getA1111Url();

        let probe;
        try { probe = await fetch(baseUrl, { method: "HEAD" }); }
        catch {
          throw new Error(`Cannot reach A1111 at ${baseUrl}. Start SD WebUI with --api flag:\n  ./webui.sh --api`);
        }

        const endpoint = `${baseUrl}/sdapi/v1/txt2img`;
        let resp;
        try {
          resp = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt, negative_prompt: "", width, height, seed: -1, steps: 20, cfg_scale: 7 }),
          });
        } catch { throw new Error(`A1111 POST failed (network error).`); }

        const bodyText = await resp.text();
        if (!resp.ok) {
          let detail = bodyText;
          try { const j = JSON.parse(bodyText); if (j.detail) detail = j.detail; } catch { /* raw */ }
          throw new Error(`A1111 HTTP ${resp.status}: ${detail || "(no detail)"}`);
        }
        let data;
        try { data = JSON.parse(bodyText); } catch { throw new Error(`A1111 bad JSON: ${bodyText.slice(0, 200)}`); }
        const b64 = data.images?.[0];
        if (!b64) throw new Error("A1111 returned no images");
        const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
        return { url: URL.createObjectURL(blob), instant: true };
      }

      // ── Pollinations ────────────────────────────────────────────────────
      const { width, height } = resolveImageSize(ratio);
      const encoded = encodeURIComponent(prompt);
      const seed = promptSeed(prompt);
      const url = `https://image.pollinations.ai/prompt/${encoded}?width=${width}&height=${height}&seed=${seed}&nologo=true`;
      return { url, instant: true };
    },
    []
  );

  return { generateImage };
}
