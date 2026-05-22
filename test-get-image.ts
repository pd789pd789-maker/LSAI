async function test() {
  const res = await fetch("http://localhost:3000/api/temp-images/123");
  console.log(res.status);
}
test();
