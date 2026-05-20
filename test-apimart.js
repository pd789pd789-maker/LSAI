import "dotenv/config";

async function test() {
  const rawOpenai = process.env.CUSTOM_OPENAI_API_KEY || "";
  const key = rawOpenai.split(",").map(k=>k.trim()).filter(Boolean)[0];
  
  const res = await fetch("https://api.apimart.ai/v1/images/generations", {
      method: "POST",
      headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + key
      },
      body: JSON.stringify({
          model: "gpt-image-2",
          prompt: "test 4k, highly detailed --ar 3:4",
          n: 1,
          size: "2448x3264"
      })
  });
  console.log("Status:", res.status);
  console.log("Response:", await res.text());
}
test();
