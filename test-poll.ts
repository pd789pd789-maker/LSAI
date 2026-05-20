import "dotenv/config";
import OpenAI from "openai";

async function test() {
  const rawOpenai = process.env.CUSTOM_OPENAI_API_KEY || "";
  const keys = rawOpenai.split(",").map(k => k.trim()).filter(Boolean);
  
  const key = keys[0];
  const baseURL = "https://api.apimart.ai/v1";
  
  try {
    const statusRes = await fetch(`${baseURL.replace(/\/$/, '')}/tasks/task_01KS290RNHGY6MPK2FW398HQCY`, {
        headers: { "Authorization": `Bearer ${key}` }
    });
    console.log("Status:", statusRes.status);
    const data = await statusRes.text();
    console.log("Response:", data);
  } catch (err: any) {
    console.error("Error:", err.message);
  }
}

test();
