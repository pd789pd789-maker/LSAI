import "dotenv/config";
import OpenAI from "openai";

async function test() {
  const oIndex = 0;
  const rawOpenai = process.env.CUSTOM_OPENAI_API_KEY || "";
  const keys = rawOpenai.split(",").map(k => k.trim()).filter(Boolean);
  
  const key = keys[0];
  const baseURL = "https://api.apimart.ai/v1";
  console.log("Using key:", key);
  const client = new OpenAI({ apiKey: key, baseURL });
  
  try {
    const res = await client.images.generate({
        model: "gpt-image-2",
        prompt: "A beautiful sunset over the mountains",
        n: 1
    });
    console.log("Success:", JSON.stringify(res, null, 2));
  } catch (err: any) {
    console.error("Error:", err.message);
    if (err.response) console.error(err.response.data);
  }
}

test();
