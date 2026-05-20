import "dotenv/config";
import OpenAI from "openai";

async function test() {
  const geminiKeys = (process.env.CUSTOM_GEMINI_API_KEY || "").split(",").map(k => k.trim()).filter(Boolean);
  const client = new OpenAI({ apiKey: geminiKeys[0], baseURL: process.env.GEMINI_BASE_URL || "https://api.apimart.ai/v1" });
  
  try {
    const res = await client.chat.completions.create({
      model: "gemini-3-flash-preview",
      messages: [{ role: "user", content: "Hello" }],
      stream: false
    });
    console.log("Success with stream=false:");
    console.log(JSON.stringify(res, null, 2));
  } catch(e: any) {
    console.error("Error:", e.message);
  }
}
test();
