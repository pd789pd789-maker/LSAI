import fs from "fs";

async function test() {
  const formData = new FormData();
  
  // Create a dummy image
  const buffer = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  const blob = new Blob([buffer], { type: "image/png" });
  formData.append("images", blob, "test.png");
  formData.append("description", "A beautiful test image");
  formData.append("count", "1");

  console.log("Sending request...");
  const res = await fetch("http://127.0.0.1:3000/api/generate-images", {
    method: "POST",
    body: formData as any
  });

  const reader = res.body?.getReader();
  if (!reader) {
    console.error("No reader");
    return;
  }
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    console.log("STREAM:", decoder.decode(value));
  }
}
test();
