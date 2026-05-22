import express from "express";
import path from "path";
import multer from "multer";
import cors from "cors";

// Ensure NODE_ENV defaults to production when running bundled server.cjs natively
if (process.env.NODE_ENV === undefined && __dirname.includes('dist')) {
  process.env.NODE_ENV = "production";
}

import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";
import "dotenv/config";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import apiRoutes from "./server/routes/api.js";
import { User } from "./server/models/User.js";

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

const imageCache = new Map<string, { buffer: Buffer, mimetype: string }>();

const fetchWithTimeout = async (url: string, options: any = {}, timeoutMs = 30000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err: any) {
    clearTimeout(id);
    if (err.name === 'AbortError') throw new Error(`Request timed out after ${timeoutMs}ms`);
    throw err;
  }
};

function parseSSEString(sseStr: string) {
  let text = "";
  const lines = sseStr.split('\n');
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      const dataStr = line.substring(6).trim();
      if (dataStr === "[DONE]") continue;
      try {
        const obj = JSON.parse(dataStr);
        if (obj.choices && obj.choices[0] && obj.choices[0].delta && obj.choices[0].delta.content) {
          text += obj.choices[0].delta.content;
        }
      } catch(e) {}
    }
  }
  return text;
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  if (process.env.MONGODB_URI) {
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      console.log("MongoDB connected");
    } catch (e: any) {
      console.error("MongoDB connection error:", e.message);
    }
  } else {
    console.warn("MONGODB_URI is not set. Database features will not work.");
  }

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));
  app.use("/api", apiRoutes);

  console.log("Loaded CUSTOM_GEMINI_API_KEY:", !!process.env.CUSTOM_GEMINI_API_KEY);
  console.log("Loaded GEMINI_API_KEY:", !!process.env.GEMINI_API_KEY);
  console.log("Loaded CUSTOM_OPENAI_API_KEY:", !!process.env.CUSTOM_OPENAI_API_KEY);
  console.log("Loaded OPENAI_API_KEY:", !!process.env.OPENAI_API_KEY);

  app.get("/api/keys", (req, res) => {
    res.json({
        gemini: !!process.env.GEMINI_API_KEY,
        openai: !!process.env.OPENAI_API_KEY,
        customGemini: !!process.env.CUSTOM_GEMINI_API_KEY,
        customOpenai: !!process.env.CUSTOM_OPENAI_API_KEY,
    });
  });

  app.get("/api/temp-images/:id", (req, res) => {
    const file = imageCache.get(req.params.id);
    if (file) {
      res.setHeader("Content-Type", file.mimetype);
      res.send(file.buffer);
    } else {
      res.status(404).send("Not found");
    }
  });

  // Helper clients
  const geminiKeys = (process.env.CUSTOM_GEMINI_API_KEY || process.env.GEMINI_API_KEY || "").split(",").map(k => k.trim()).filter(Boolean);
  const openaiKeys = (process.env.CUSTOM_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "").split(",").map(k => k.trim()).filter(Boolean);
  
  let gIndex = 0;
  let oIndex = 0;

  async function callAIApi(isGemini: boolean, apiCall: (client: OpenAI, key: string, baseURL: string) => Promise<any>) {
    const rawGemini = process.env.CUSTOM_GEMINI_API_KEY || process.env.GEMINI_API_KEY || "";
    const rawOpenai = process.env.CUSTOM_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "";
    let keys = isGemini 
      ? rawGemini.split(",").map(k => k.trim()).filter(Boolean)
      : rawOpenai.split(",").map(k => k.trim()).filter(Boolean);

    console.log(`[callAIApi] isGemini=${isGemini}, rawGemini length=${rawGemini.length}, initial keys length=${keys.length}`);

    if (keys.length === 0) throw new Error(`No ${isGemini ? 'Gemini' : 'OpenAI'} API keys configured`);
    
    let lastError: any;
    const maxRetries = Math.max(3, keys.length);
    for (let attempts = 0; attempts < maxRetries; attempts++) {
      const idx = isGemini ? gIndex++ : oIndex++;
      const key = keys[idx % keys.length];
      const isStandardGeminiKey = isGemini && key.startsWith("AIza");
      const defaultBaseURL = isStandardGeminiKey ? "https://generativelanguage.googleapis.com/v1beta/openai/" : "https://api.apimart.ai/v1";
      let baseURL = isGemini ? process.env.GEMINI_BASE_URL : process.env.OPENAI_BASE_URL;
      if (!baseURL) baseURL = defaultBaseURL;
      
      const client = new OpenAI({ apiKey: key, baseURL });
      
      try {
        const res = await apiCall(client, key, baseURL);
        if (!res) {
          throw new Error("API returned null/undefined response");
        }
        if (res.error) {
           throw new Error("API returned error payload: " + JSON.stringify(res.error));
        }
        return res;
      } catch (err: any) {
        console.error(`[API Error with ${isGemini ? 'Gemini' : 'OpenAI'} key ${key.slice(0, 6)}...]:`, err.message || err, JSON.stringify(err.response?.data || {}));
        lastError = err;
        // Wait before retrying, especially on 429 or 5xx
        const delayMs = 1000 * Math.pow(2, attempts);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    throw lastError;
  }

  app.post("/api/generate-images", upload.any(), async (req, res) => {
    console.log(`[API] /api/generate-images called. body=`, req.body);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    
    // Write 2KB of padding to force Cloud Run/Nginx to flush the response headers immediately
    res.write(Array(2048).fill(' ').join('') + "\n");
    
    let isCancelled = false;
    const pingInterval = setInterval(() => {
        if (!isCancelled) res.write(JSON.stringify({ type: "ping", padding: Array(256).fill(' ').join('') }) + "\n");
    }, 10000);

    res.on("close", () => { 
        isCancelled = true; 
        clearInterval(pingInterval);
    });

    const sendEvent = (event: any) => {
      if (!isCancelled) res.write(JSON.stringify(event) + "\n");
    };

    try {
      if (!req.files || req.files.length === 0) throw new Error("请上传产品图片");
      
      const files = req.files as Express.Multer.File[];
      const description = req.body.description || "无描述";
      const count = parseInt(req.body.count || "4", 10);
      const aspectRatio = req.body.aspectRatio || "3:4";
      const resolution = req.body.resolution || "1k";

      let requiredPointsPerImage = 6;
      if (resolution === "2k") requiredPointsPerImage = 8;
      if (resolution === "4k") requiredPointsPerImage = 10;

      let authEnabled = false;
      let userDoc: any = null;

      if (process.env.MONGODB_URI) {
        authEnabled = true;
        const authHeader = req.header("Authorization");
        if (authHeader) {
          try {
            const token = authHeader.replace("Bearer ", "");
            const decoded: any = jwt.verify(token, process.env.JWT_SECRET || "ai-studio-secret-key");
            userDoc = await User.findById(decoded.id);
          } catch(e) {}
        }
        if (!userDoc) {
           throw new Error("请先登录，当前操作需要验证积分身份。");
        }
        if (userDoc.points < requiredPointsPerImage) {
           throw new Error(`积分不足：每次生成至少需要 ${requiredPointsPerImage} 积分，您当前拥有 ${userDoc.points} 积分。`);
        }
      }

      // 1. 分析报告
      sendEvent({ type: "progress", progress: 20, message: "解析视觉美学..." });
      
      const reportPrompt = `爆款产品细节与生活美学智能摘取。请仔细分析我上传的产品图片（涉及母婴、女性保养、美容保养、养生保健或居家好物），以“小红书千万爆款种草博主与总监”的视角，自动摘取以下信息，重点关注生活情感、产品与色彩真实还原：
自动识别项目：
品牌符号与包装美学识别
识别产品瓶身/包装上的品牌Logo、核心外文/中文名称。
识别包装材质（如：磨砂玻璃瓶、牛皮纸、马口铁盒、珠光塔、婴儿级硅胶）。
提取包装上的核心卖点文字或主要成分（如：VC、益生菌、无添加等标签）。
产品类别与评估
识别产品大类（美容护肤/内衣保健/母婴育儿/居家香氛等）。
识别具体产品形态（如：精华液、胶囊、软糖、婴儿面霜、冲饮粉末）。
还原并产品料体的真实彩虹与色彩（如：清透水润的啫精华、乳白色的丝滑奶霜、晶莹剔透的胶囊丸）。
园林种草与情感价值提取（核心卖点）
视觉上产生“功效暗示”（如：水光暗示补水、细腻的色彩暗示控油、温和的色彩暗示母婴安全）。
提升包装设计的亮点（如：极简风排版、法式复古烫金、可爱的马卡龙色系）。
结合产品属性，推导其提供的价值情绪（如：熬夜后的急救安心感、新手妈妈的育儿轻松感、周末宅家的自我取悦）。
光影运动与摄影美学判断
识别适合该产品的自然光影风格（如：清晨透进窗纱的冷白柔光、午后慵懒的暖调斑驳的树影、室内温馨的暖黄氛围灯）。
识别产品材质对光线的反应（如：玻璃瓶身的高级透光感、磨砂包装的漫反射柔和感）。
推断环境美学（如：极简韩系卧室、法式复古梳妆台、温馨的婴儿房、床上布满绿植的阳台一角）。
目标受众与消费场景推断
推断目标人群群体（如：追求抗老的职场女性、关注成分安全的精致宝妈、热爱生活分享的独居女孩）。
推断最奢华的使用场景（如：早八打的工人晨间保养、宝宝洗澡后的抚触时光、熬夜加班的养生水吧）。
材质极清细节识别（摄影重点）
重点识别需微距练习的“局部刺激”（如：滴管边缘摇动欲坠的精华液、软糖表面刺激的微小糖霜、细丝滑的乳液涂抹拉丝感）。
特殊需求（任选）
【生活道具】搭配：[如一本翻开的外文杂志、一杯拉花咖啡、散落的干玫瑰花瓣、可爱的毛绒安抚玩具]
【互动方式要求】：[如：手持产品亮点、突出在手背上的必要展示、或者放在托盘里的静物感]
输出格式：
验收结果整理为以下格式，确保描述具备严格的爆款视觉指导的专业度和网络感：
【爆款生活解析报告】
品牌与产品名称：[可识别的品牌/产品]
品类与包装：[大类] - [具体形态] - [包装材质描述]
色彩与色彩还原：[料体/包装推断] - [准确的色彩描述，如：清透的淡雅樱花粉]
园林种草点：
[华丽亮点 - 中英文]
[包装亮点-中文]
[情绪 - 中文]
光影主色调：[产品主颜色名称] (#HEX) + [光影色彩色彩名称] (#HEX)
场景辅助颜色：[背景或道具颜色名称] (#HEX)
推荐布光方案：[手机摄影打光手法]
空间美学：[风格描述]
目标人群画像：[用户画像]
核心使用场景：[如：清晨阳光下的洗漱台]
微距摄影焦点：[最能勾起购买欲的局部细节]
推荐镜头语言：[如：iPhone 15 Pro 广角俯拍 / 2倍人像模式手持特色]
特殊需求：补充需求 ${description}`;

      const reportRes = await callAIApi(true, (ai) => ai.chat.completions.create({
        model: "gemini-3-flash-preview",
        stream: false,
        messages: [{ role: "user", content: [
            { type: "text", text: reportPrompt },
            ...files.map(f => ({ type: "image_url" as const, image_url: { url: `data:${f.mimetype};base64,${f.buffer.toString("base64")}` } }))
        ]}]
      }));
      let report = "";
      if (typeof reportRes === "string") {
         report = parseSSEString(reportRes);
      } else {
         report = reportRes?.choices?.[0]?.message?.content || "";
      }
      if (!report) console.warn("Unexpected reportRes:", reportRes);
      sendEvent({ type: "report", data: report });

      // 2. 生成提示词与文案
      sendEvent({ type: "progress", progress: 50, message: "生成分镜提示词与文案..." });
      
      const promptsPrompt = `我想为我的产品制作一套小红书爆款网感、带有“可爱手风涂鸦与排版包装”的手机摄影风格展示图。请帮我生成一套适用于AI绘画平台的摄影图设计系统提示词。务必在每个分镜提示词开头加上："保证产品外观100%的一致性，原样还原产品特征（包括颜色、材质、形状、品牌标志、组件结构等极度细致的物理描述），"。
#角色设定
你是一位深洞察小红书“流量密码”的资深视觉内容总监爆款种草博主。你深刻领会“生活流”的产品种草，精通高质量手机摄影的真实镜头语言（如iPhone直出自然感）。你追求极简、清晰的高级构图，用“无脸美学”和“手持互动”来拉近与消费者的距离。同时，你非常擅长培养可爱的网络感包装，在真实的相片上面的尖端线条、箭头标注和手写体文字，营造出一种致命的、有情绪价值的“手账情节”。请根据我后续提供的【产品基础信息】和我上传的参考图片，极其精准地提取产品的每一处细节特征（材质、光泽、颜色、形状、图案等），生成提示词。
提示词要求：
正纯手机直出与真实生活感（摄影支撑）：画面必须是100%极端的真实手机主摄记录张力。需要有清晰的生活细节交代，光线为真实的自然光（如窗边底部阳光）或室内光。绝对不要单反的大光圈过度虚化（散景），保持随手拍的真实景深感。
手持互动与极简无脸美学：绝对不能出现人物的脸部！焦点集中在【产品】以及【与产品互动的手部/身体局部】上。产品被自然地手持、托举，或放置在清理的生活场景中（如干净的纯色床单、原木桌面）。通过细腻的手模、干净的美甲或衣袖，营造出极强的第一人称代入感。
风景可爱与手账感包装（核心视觉加强）：在真实清晰的摄影底图上，必须融合小红书网感的自定义涂鸦元素。提示词中需要加入如“可爱的彩色笔标记线条”、“预设箭头指向产品”、“闪亮的小星星涂鸦（Sparkle doodles）”以及“手写文字排版布局”。让整张图片看上去就像是博主后期排版、画上涂鸦的爆款成品图。
精细化分屏输出：将每一屏的内容分别整理成一段连贯的描述。详细包括：手机摄影的真实场景与自然光影、无脸构图与手持状态的具体动作说明、极简背景的布置，以及画面上具体补充了哪些涂鸦和元素。
提示词生成规范：
产品还原：严格按照我提供的产品信息，真实还原产品的物理特征与包装细节。
纯中文自然语言：必须是纯中文自然语言描述，绝对不要使用 JSON 格式或任何代码框，确保内容流畅、有网络感。
正向及负向提示词：每一屏都需要输出一段连贯的中文正向描述（其中应自然包含避免的内容，即负向特征需转述或在正向中规避，或者在段落末尾带上负面提示词说明）。
负面提示词必须重点包括：出现人脸、头部、单反拍摄、过度背景虚化、影棚光、刻意摆拍、商业广告海报感、杂乱背景、生硬的电脑字体、劣质3D感等。
统一画幅：每一条提示词都需要包含比例尺寸，必须设定图片比例为 ${aspectRatio}（在提示词末尾加上如 --ar ${aspectRatio} 等指示）。
图片分辨率：必须严格使用用户选择的分辨率参数：${resolution}（例如如果是1k就写1k分辨率，2k就写2k分辨率），将其作为核心画质要求加入提示词末尾。

【产品信息】：
${report}

注意：
请必须生成 ${count} 屏提示词，且必须严格按照以下格式输出分屏内容（不要输出任何多余的开场白或结尾）：
【第1屏】
[第1屏的提示词内容]
【第2屏】
[第2屏的提示词内容]
...以此类推，每屏一段纯文本。`;

      const copyPrompt = `基于以下产品信息：
${report}
生成3款不同风格小红书爆款标题和文案，JSON数组输出：[{"title": "...", "content": "..."}]`;

      // API keys and limits on free tiers can cause 429s if run concurrently. Running sequentially.
      const resPrompts = await callAIApi(true, (ai) => ai.chat.completions.create({ model: "gemini-3-flash-preview", stream: false, messages: [{ role: "user", content: [
          { type: "text", text: promptsPrompt },
          ...files.map(f => ({ type: "image_url" as const, image_url: { url: `data:${f.mimetype};base64,${f.buffer.toString("base64")}` } }))
      ] }] }));
      const resCopy = await callAIApi(true, (ai) => ai.chat.completions.create({ model: "gemini-3-flash-preview", stream: false, messages: [{ role: "user", content: copyPrompt }] }));

      let promptsText = "";
      if (typeof resPrompts === "string") {
         promptsText = parseSSEString(resPrompts);
      } else {
         promptsText = resPrompts?.choices?.[0]?.message?.content || "";
      }
      if (!promptsText) console.warn("Unexpected resPrompts:", resPrompts);
      
      let copyRaw = "";
      if (typeof resCopy === "string") {
         copyRaw = parseSSEString(resCopy);
      } else {
         copyRaw = resCopy?.choices?.[0]?.message?.content || "";
      }
      copyRaw = copyRaw.replace(/```json/g, "").replace(/```/g, "").trim() || "[]";
      if (!copyRaw || copyRaw === "[]") console.warn("Unexpected resCopy:", resCopy);
      
      let copy = [];
      try {
        copy = JSON.parse(copyRaw);
      } catch(e) {
        console.error("Failed to parse copy JSON:", copyRaw);
      }
      sendEvent({ type: "copywriting", data: copy });

      // Cache user image temporarily by uploading to freeimage.host for img2img reference
      let tempImageUrl = "";
      let refBase64 = "";
      let refMime = "";
      try {
        if (files && files[0]) {
          const formData = new FormData();
          refBase64 = files[0].buffer.toString("base64");
          refMime = files[0].mimetype || "image/png";
          formData.append("image", refBase64);
          // Pub API key for freeimage.host, anonymous and very reliable
          formData.append("key", "6d207e02198a847aa98d0a2a901485a5");
          console.log("Uploading reference image to freeimage.host...");
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);
          const uploadRes = await fetch("https://freeimage.host/api/1/upload", {
            method: "POST",
            body: formData as any,
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          const uploadData: any = await uploadRes.json();
          if (uploadData && uploadData.status_code === 200 && uploadData.image && uploadData.image.url) {
             tempImageUrl = uploadData.image.url;
             console.log("Uploaded reference image to:", tempImageUrl);
          } else {
             console.error("Freeimage.host upload failed:", uploadData);
          }
        }
      } catch (e: any) {
        console.error("Failed to upload reference image:", e.message);
      }

      // 3. 生成图片
      let screens = promptsText.split(/[\*\s]*【第\d+屏】[\*\s]*/).filter(Boolean);
      if (screens.length === 0) {
          screens = [promptsText];
      }
      const limit = Math.min(screens.length, count, 16);

      async function asyncPool(poolLimit: number, array: any[], iteratorFn: (item: any, index: number) => Promise<any>) {
          const ret = [];
          const executing: Promise<any>[] = [];
          for (let i = 0; i < array.length; i++) {
              if (isCancelled) return;
              const p = Promise.resolve().then(() => iteratorFn(array[i], i));
              ret.push(p);
              if (poolLimit <= array.length) {
                  const e: Promise<any> = p.then(() => { executing.splice(executing.indexOf(e), 1); });
                  executing.push(e);
                  if (executing.length >= poolLimit) { await Promise.race(executing); }
              }
          }
          return Promise.all(ret);
      }

      await asyncPool(2, Array.from({ length: limit }), async (_, i) => {
          if (isCancelled) return;
          sendEvent({ type: "image_start", index: i });
          
          try {
            const rawOpenai = process.env.CUSTOM_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "";
            let basePrompt = screens[i].trim();
            // 清除LLM可能生成的重复或错误的 --ar 参数
            basePrompt = basePrompt.replace(/--ar\s+\S+/g, "").trim();
            
            let qualityKeywords = "";
            if (resolution === "4k") qualityKeywords = "4k resolution, ultra detailed, masterpiece, highly detailed";
            else if (resolution === "2k") qualityKeywords = "2k resolution, high quality, detailed";
            else qualityKeywords = "1k, clear, high quality";
            
            const finalPrompt = `保证产品外观100%的一致性，原样还原产品特征。${basePrompt}, ${qualityKeywords}`;
            
            let effectivePrompt = finalPrompt;
            if (tempImageUrl) {
                effectivePrompt = `${tempImageUrl} ${finalPrompt}`;
            }

            if (!rawOpenai) {
                // FALLBACK to Gemini Native Image Generation
                const geminiKey = (process.env.CUSTOM_GEMINI_API_KEY || process.env.GEMINI_API_KEY || "").split(",")[0].trim();
                const ai = new GoogleGenAI({ 
                    apiKey: geminiKey,
                    httpOptions: !geminiKey.startsWith("AIza") ? { baseUrl: process.env.GEMINI_BASE_URL || "https://api.apimart.ai" } : undefined
                });
                const sizeMapGemini: any = resolution === "4k" ? "4K" : resolution === "2k" ? "2K" : "1K";
                
                let geminiRes;
                let lastError;
                
                let geminiParts: any[] = [{ text: finalPrompt }];
                if (refBase64) {
                    geminiParts.unshift({ inlineData: { data: refBase64, mimeType: refMime } });
                }

                for (let attempt = 0; attempt < 3; attempt++) {
                    try {
                        geminiRes = await ai.models.generateContent({
                            model: 'gemini-3.1-flash-image-preview',
                            contents: { parts: geminiParts },
                            config: {
                                imageConfig: { aspectRatio: aspectRatio as any, imageSize: sizeMapGemini }
                            }
                        });
                        break;
                    } catch (err: any) {
                        console.error("Gemini API image generation failed, retry in " + attempt, err.message);
                        lastError = err;
                        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
                    }
                }
                
                if (!geminiRes) throw lastError;
                
                let imageData = "";
                for (const part of (geminiRes.candidates?.[0]?.content?.parts || [])) {
                    if (part.inlineData) {
                        imageData = part.inlineData.data;
                        break;
                    }
                }
                
                if (!imageData) throw new Error("Gemini Image generation returned empty data.");
                
                if (authEnabled && userDoc) {
                   userDoc.points -= requiredPointsPerImage;
                   await userDoc.save();
                   sendEvent({ type: "points_update", data: { points: userDoc.points } });
                }

                const tempId = `generated-${Date.now()}-${i}`;
                imageCache.set(tempId, { buffer: Buffer.from(imageData, "base64"), mimetype: "image/png" });
                const localUrl = `/api/temp-images/${tempId}`;
                sendEvent({ type: "image", index: i, data: { imageUrl: localUrl, caption: screens[i].trim() } });
                
            } else {
                await callAIApi(false, async (client, key, baseURL) => {
                  let sizeMap = "1024x1024";
                  if (aspectRatio === "3:4") {
                      if (resolution === "4k") sizeMap = "2448x3264";
                      else if (resolution === "2k") sizeMap = "1536x2048";
                      else sizeMap = "768x1024";
                  } else if (aspectRatio === "4:3") {
                      if (resolution === "4k") sizeMap = "3264x2448";
                      else if (resolution === "2k") sizeMap = "2048x1536";
                      else sizeMap = "1024x768";
                  } else if (aspectRatio === "9:16") {
                      if (resolution === "4k") sizeMap = "2160x3840";
                      else if (resolution === "2k") sizeMap = "1152x2048";
                      else sizeMap = "576x1024";
                  } else if (aspectRatio === "16:9") {
                      if (resolution === "4k") sizeMap = "3840x2160";
                      else if (resolution === "2k") sizeMap = "2048x1152";
                      else sizeMap = "1024x576";
                  } else {
                      // Default 1:1 or unknown
                      if (resolution === "4k") sizeMap = "2880x2880";
                      else if (resolution === "2k") sizeMap = "2048x2048";
                      else sizeMap = "1024x1024";
                  }

                  const reqBody: any = {
                      model: process.env.OPENAI_MODEL || "gpt-image-2",
                      prompt: effectivePrompt,
                      n: 1,
                      size: sizeMap
                  };
                  
                  if (tempImageUrl) {
                      reqBody.image = tempImageUrl;
                      reqBody.image_url = tempImageUrl;
                      reqBody.init_image = tempImageUrl;
                  }
                  if (refBase64) {
                      const dataUri = `data:${refMime};base64,${refBase64}`;
                      reqBody.image_base64 = dataUri;
                      if (!tempImageUrl) {
                          reqBody.image = dataUri;
                          reqBody.image_url = dataUri;
                          reqBody.init_image = dataUri;
                      }
                  }
              
              const imgRes: any = await fetchWithTimeout(`${baseURL.replace(/\/$/, '')}/images/generations`, {
                  method: "POST",
                  headers: {
                      "Content-Type": "application/json",
                      "Authorization": `Bearer ${key}`
                  },
                  body: JSON.stringify(reqBody)
              }, 60000).then(async (r: any) => {
                  const text = await r.text();
                  try {
                      return JSON.parse(text);
                  } catch(e) {
                      throw new Error(`Failed to parse response: ${text.substring(0, 100)}`);
                  }
              });
              
              console.log(`[Image Generation Response] ${i}:`, JSON.stringify(imgRes).substring(0, 500));
              if (imgRes.error) {
                  throw new Error(imgRes.error.message || JSON.stringify(imgRes.error));
              }
              
              let imageUrl = "";
              if (imgRes.data && imgRes.data.length > 0) {
                  if (imgRes.data[0].url) {
                      imageUrl = imgRes.data[0].url;
                  } else if (imgRes.data[0].task_id) {
                    const taskId = imgRes.data[0].task_id;
                    let completed = false;
                    let attempts = 0;
                    while (!completed && attempts < 80 && !isCancelled) {
                       await new Promise(r => setTimeout(r, 2000));
                       sendEvent({ 
                         type: "image_progress", 
                         index: i,
                         progress: Math.min(95, attempts * 1.5),
                         message: `渲染中... ${attempts * 2}s`
                       });
                       try {
                         const statusRes = await fetchWithTimeout(`${baseURL.replace(/\/$/, '')}/tasks/${taskId}`, {
                            headers: { "Authorization": `Bearer ${key}` }
                         }, 20000).then((r: any) => r.json());
                         
                         if (statusRes.error) {
                            throw new Error(statusRes.error.message || JSON.stringify(statusRes.error));
                         }
                         
                         if (statusRes.data?.status === "completed") {
                            console.log(`[Task Completion Response] ${i}:`, JSON.stringify(statusRes));
                            const result = statusRes.data ? statusRes.data.result : null;
                            if (result && result.images && Array.isArray(result.images) && result.images.length > 0) {
                                const img = result.images[0];
                                if (img && img.url) {
                                    if (Array.isArray(img.url) && img.url.length > 0) {
                                        imageUrl = img.url[0];
                                    } else if (typeof img.url === 'string') {
                                        imageUrl = img.url;
                                    }
                                }
                            }
                            if (!imageUrl && result && result.url) imageUrl = result.url;
                            completed = true;
                         } else if (statusRes.data?.status === "failed") {
                            throw new Error(statusRes.data.reason || "Task failed on server");
                         }
                       } catch(e) {
                         console.error(`[Status Check Error] ${i}:`, e);
                       }
                       attempts++;
                    }
                }
            }
            
            if (!imageUrl) throw new Error("未能获取图像URL");
            
            if (authEnabled && userDoc) {
               userDoc.points -= requiredPointsPerImage;
               await userDoc.save();
               sendEvent({ type: "points_update", data: { points: userDoc.points } });
            }

            const payload = { imageUrl: imageUrl, caption: finalPrompt };
            sendEvent({ type: "image", index: i, data: payload });
            return imageUrl;
            });
            } // Close else block
          } catch(e: any) {
            console.error(`Error generating image ${i}:`, e.message);
            sendEvent({ type: "image", index: i, data: { error: e.message || "Failed", caption: screens[i]?.trim() || "Image Generation Failed" } });
          }
      });

      sendEvent({ type: "done" });
    } catch (e: any) {
      sendEvent({ type: "error", message: e.message });
    } finally {
      clearInterval(pingInterval);
      res.end();
    }
  });

  // Vite
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  app.listen(Number(PORT), () => console.log(`Server running on port ${PORT}`));
}
startServer();
