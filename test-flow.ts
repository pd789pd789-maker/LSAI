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
    const res: any = await client.images.generate({
        model: "gpt-image-2",
        prompt: "A beautiful sunset over the mountains",
        n: 1
    });
    console.log("Success:", JSON.stringify(res, null, 2));
    
    let taskId = res.data?.[0]?.task_id;
    if (!taskId) return;
    
    for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const statusRes = await fetch(`${baseURL.replace(/\/$/, '')}/tasks/${taskId}`, {
            headers: { "Authorization": `Bearer ${key}` }
        }).then(r => r.json());
        
        console.log("Poll status:", statusRes.data?.status);
        if (statusRes.data?.status === "completed") {
             console.log("Completed!");
             console.log("Result:", JSON.stringify(statusRes.data.result, null, 2));
             break;
        } else if (statusRes.data?.status === "failed") {
             console.log("Failed!", statusRes.data);
             break;
        }
    }
    
  } catch (err: any) {
    console.error("Error:", err.message);
    if (err.response) console.error(err.response.data);
  }
}

test();
