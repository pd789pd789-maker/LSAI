import axios from "axios";
async function test() {
  try {
    const res = await axios.get("https://api.apimart.ai/v1/models", {
      headers: { Authorization: "Bearer sk-kvhOwF1zT9BNOPa90QH5YCGesNeW3DqvOY6tfRzYaouup3Dx" }
    });
    console.log(res.data.data.map(d => d.id).join(", "));
  } catch (e) {
    console.log("Error:", e.message);
  }
}
test();
