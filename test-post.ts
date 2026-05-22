async function test() {
  const form = new FormData();
  form.append("description", "A cute red apple");
  form.append("aspectRatio", "1:1");
  form.append("resolution", "1k");
  form.append("count", "1");
  form.append("images", new Blob(["hello"], { type: "image/jpeg" }), "hello.jpg");
  
  const res = await fetch("http://localhost:3000/api/generate-images", {
      method: "POST",
      body: form as any
  });

  const body = await res.text();
  console.log("Response stream:\n", body);
}
test();
