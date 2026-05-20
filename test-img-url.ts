import "dotenv/config";
import OpenAI from "openai";

async function test() {
  const rawOpenai = process.env.CUSTOM_OPENAI_API_KEY || "";
  const keys = rawOpenai.split(",").map(k => k.trim()).filter(Boolean);
  const key = keys[0];
  const baseURL = "https://api.apimart.ai/v1";
  const client = new OpenAI({ apiKey: key, baseURL });
  
  try {
    const res: any = await client.images.generate({
        model: "gpt-image-2",
        prompt: "https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png a highly detailed product in a forest --v 6.0",
        n: 1
    });
    console.log("Success:", JSON.stringify(res, null, 2));
  } catch (err: any) {
    console.error("Error:", err.message);
  }
}
test();
