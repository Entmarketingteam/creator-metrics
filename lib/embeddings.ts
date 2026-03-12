import { GoogleGenAI } from "@google/genai";

const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GEMINI_API_KEY! });

export async function embedText(text: string): Promise<number[]> {
  const result = await genai.models.embedContent({
    model: "gemini-embedding-2-preview",
    contents: text,
    config: { outputDimensionality: 3072 },
  });
  return result.embeddings[0].values!;
}
