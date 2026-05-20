import express from "express";
import path from "path";
import multer from "multer";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { createServer as createViteServer } from "vite";
import "dotenv/config";

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB limit
});

const imageCache = new Map<string, { buffer: Buffer, mimetype: string }>();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  const openaiKeys = [
    "sk-eoOYqKkL7d7jupObsaFPu6K8Wun9u1t8Yu21rRY0s2BRFFaJ",
    "sk-y8fqFeOz4Yzk12wl62b97pjb8aBHDYPABVKG6fTELAVJhdD2",
    "sk-HDRNAPkWxockGjGMOrUmH6t2efc8Y2I4B3Z9xvJIlzjpndbb"
  ];
  
  const geminiKeys = [
    "sk-kvhOwF1zT9BNOPa90QH5YCGesNeW3DqvOY6tfRzYaouup3Dx",
    "sk-LEhPYznQH24Gclagj2Dry9jNOaaPrTslt9MMfALt31V0Z3vJ",
    "sk-c4aAhWVDzCczxc6uW3UQzbFdk0NszluxVzJk12a5Cvg5PJM6"
  ];
  
  let oaiIndex = 0;
  let gemIndex = 0;

  function getAiClient() {
    const key = process.env.GEMINI_API_KEY || geminiKeys[gemIndex++ % geminiKeys.length];
    // APIMart usually expects the base URL to NOT include /v1beta
    const baseUrl = process.env.GEMINI_BASE_URL || (key.startsWith("sk-") ? "https://api.apimart.ai" : undefined);

    const additionalOptions: any = { 
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      } 
    };
    if (baseUrl) {
       additionalOptions.httpOptions.baseUrl = baseUrl;
    }
    return new GoogleGenAI({ apiKey: key, ...additionalOptions });
  }

  function getOpenAiClient() {
    const key = process.env.OPENAI_API_KEY || openaiKeys[oaiIndex++ % openaiKeys.length];
    const baseUrl = process.env.OPENAI_BASE_URL || (key.startsWith("sk-") ? "https://api.apimart.ai/v1" : undefined);

    const additionalOptions: any = {};
    if (baseUrl) {
       additionalOptions.baseURL = baseUrl;
    }
    return new OpenAI({ apiKey: key, ...additionalOptions });
  }

  // Diagnostic Endpoint
  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "ok", 
      env: process.env.NODE_ENV,
      hasGeminiKey: !!process.env.GEMINI_API_KEY,
      hasOpenAIKey: !!process.env.OPENAI_API_KEY
    });
  });

  app.get("/api/uploads/:id", (req, res) => {
    const data = imageCache.get(req.params.id);
    if (data) {
      res.setHeader("Content-Type", data.mimetype);
      res.send(data.buffer);
    } else {
      res.status(404).end();
    }
  });

  app.post("/api/generate-images", upload.any(), async (req, res) => {
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    
    // Flush some initial padding if proxy buffers
    res.write(" ".repeat(4096) + "\n");

    let isCancelled = false;
    res.on("close", () => {
      if (!res.writableEnded) {
        isCancelled = true;
      }
    });

    const sendEvent = (event: any) => {
      if (!isCancelled) {
        // Appending 4KB spaces to ensure proxy buffers are flushed, ignored by JSON.parse
        res.write(JSON.stringify(event) + " ".repeat(4096) + "\n");
      }
    };

    try {
      const gKey = process.env.GEMINI_API_KEY || geminiKeys[0];
      if (!gKey) {
        sendEvent({ type: "error", message: "系统配置缺失 (G-KEY)" });
        return res.end();
      }

      if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
        sendEvent({ type: "error", message: "请上传至少一张源图片" });
        return res.end();
      }

      const files = req.files as Express.Multer.File[];

      const ai = getAiClient();
      const openai = getOpenAiClient();

      const description = req.body.description || "无详细描述";
      const count = parseInt(req.body.count || "4", 10);
      const aspectRatio = req.body.aspectRatio || "3:4";
      const resolution = req.body.resolution || "1k";

      console.log(`[1/4] 开始流式处理，预设描述: ${description}, 数量: ${count}, 比例: ${aspectRatio}`);

      let referenceImageUrls: string[] = [];
      const inlineDataParts = files.map((file) => {
        const base64Image = file.buffer.toString("base64");
        const b64DataUri = `data:${file.mimetype};base64,${base64Image}`;
        referenceImageUrls.push(b64DataUri);
        return { inlineData: { data: base64Image, mimeType: file.mimetype } };
      });
      
      try {
        const uploadPromises = files.map(async (file, index) => {
          const blob = new Blob([file.buffer], { type: file.mimetype });
          const form = new FormData();
          form.append('file', blob, 'image.jpg');
          const uploadRes = await fetch('https://tmpfiles.org/api/v1/upload', {
             method: 'POST',
             body: form
          });
          const uploadJson = await uploadRes.json();
          if (uploadJson?.data?.url) {
             referenceImageUrls[index] = uploadJson.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
             console.log(`[Image Cache] Uploaded inline reference image ${index} to: ${referenceImageUrls[index]}`);
          }
        });
        await Promise.all(uploadPromises);
      } catch (e) {
        console.error("Failed to upload reference images to tmpfiles", e);
      }
      
      // Step 1: Image Analysis Report
      sendEvent({ type: "progress", progress: 10, message: "正在进行视觉美学解析与元素提取..." });
      const prompt1 = `任务说明
爆款产品细节与生活美学智能提取。请仔细分析我上传的产品图片（涉及母婴、女性保养、美容护肤、养生保健或居家好物），以“小红书千万级爆款种草博主与视觉总监”的视角，自动提取以下信息，重点注重生活氛围感、产品质感与色彩真实还原：
自动识别项目：
品牌符号与包装美学识别
识别产品瓶身/包装上的品牌Logo、核心外文/中文名称。
识别包装材质（如：磨砂玻璃瓶、环保牛皮纸、马口铁盒、珠光软管、婴儿级硅胶）。
提取包装上的核心卖点文字或主要成分（如：VC、益生菌、无添加等标签）。
产品品类与质感判断
识别产品大类（美容护肤/内服保健/母婴育儿/居家香氛等）。
识别具体产品形态（如：精华液、胶囊、软糖、婴儿面霜、冲饮粉末）。
识别并还原产品料体的真实质感与色彩（如：清透水润的啫喱、乳白色的丝滑奶霜、晶莹剔透的胶囊丸）。
视觉种草与情绪价值提取（核心卖点）
提取视觉上的“功效暗示”（如：水光感暗示补水、清爽质地暗示控油、温和的色彩暗示母婴安全）。
提取包装设计的视觉亮点（如：极简ins风排版、法式复古烫金、可爱的马卡龙色系）。
结合产品属性，推导其提供的情绪价值（如：熬夜后的急救安心感、新手妈妈的育儿松弛感、周末宅家的自我取悦）。
光影氛围与摄影美学判断
识别适合该产品的自然光影风格（如：清晨透进窗纱的冷白柔光、午后慵懒的暖调斑驳树影、室内温馨的暖黄氛围灯）。
识别产品材质对光线的反应（如：玻璃瓶身的高级折射透光感、磨砂包装的漫反射柔和感）。
推断环境美学风格（如：极简韩系卧室、法式复古梳妆台、温馨的宝宝婴儿床畔、充满绿植的阳台一角）。
目标受众与消费场景推断
推断目标受众群体（如：追求高效抗老的职场女性、注重成分安全的精致宝妈、热爱生活分享的独居女孩）。
推断最高频的使用场景（如：早八打工人的晨间护肤、宝宝洗澡后的抚触时光、熬夜加班的养生水吧）。
材质极清细节识别（摄影重点）
重点识别需微距展现的“诱人局部”（如：滴管边缘摇摇欲坠的精华液、软糖表面诱人的微小糖霜、细腻丝滑的乳液涂抹拉丝感）。
特殊需求（可选）
【生活道具搭配】：[如：一本翻开的外文杂志、一杯拉花咖啡、散落的干玫瑰花瓣、可爱的毛绒安抚玩具]
【互动方式要求】：[如：手持产品特写、涂抹在手背上的质感展示、或者放在托盘里的静物感]
输出格式：
请将识别结果整理为以下格式，确保描述具备顶级爆款视觉指导的专业度和网感：
【爆款生活方式视觉解析报告】
品牌与品名：[识别到的品牌/产品名称]
品类与包装：[大类] - [具体形态] - [包装材质描述]
质感与色彩还原：[料体/包装推断] - [精确的色彩描述，如：清透的淡雅樱花粉]
视觉种草点：
[质感亮点 - 中英文]（如：Watery & Refreshing 清透水润感）
[包装亮点 - 中英文]
[情绪价值 - 中英文]（如：Healing & Relaxing 治愈松弛感）
光影主色调：[产品主色名称] (#HEX) + [光影氛围色彩名称] (#HEX)
场景辅助色：[背景或道具颜色名称] (#HEX) （如：燕麦色/奶油白/低饱和灰粉）
推荐布光方案：[手机摄影打光手法，如：窗边自然柔光直射 + 侧面反光板补光]
空间美学风格：[风格描述，如：韩系极简奶油风居家空间]
目标受众画像：[用户画像，如：成分党精致宝妈]
核心使用场景：[如：清晨阳光下的洗漱台]
微距摄影焦点：[最能勾起购买欲的局部细节，如：挤出在虎口处的一抹面霜]
推荐镜头语言：[如：iPhone 15 Pro 广角俯拍 / 2倍人像模式手持特写]
特殊需求：${description}`;

      const response1 = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt1 },
              ...inlineDataParts
            ]
          }
        ]
      });

      if (isCancelled) return res.end();
      const report = response1.text || "";
      console.log("[2/4] 解析报告生成完毕，正在构建分屏分镜与文案...");

      sendEvent({ type: "progress", progress: 30, message: "正在构建手账风分屏镜头语言与网感文案..." });

      // Step 2 & 3 in parallel: Image Prompts and Copywriting
      const prompt2 = `复制以下提示词给大模型
任务说明
我想为我的产品制作一套极具小红书爆款网感、带有“可爱手账风涂鸦与排版包装”的手机摄影风格展示图。
【重要指令】：请你务必、必须生成并且仅生成 ${count} 屏适用于 AI 绘画平台的摄影图设计系统提示词。不管怎样都要生成 ${count} 屏，绝不可少出或多出！
#角色设定
你是一名深谙小红书“流量密码”的资深视觉内容总监兼爆款种草博主。你极度擅长“生活流”的产品种草，精通高质量手机摄影的真实镜头语言（如 iPhone 直出自然感）。你追求极简、干净的高级构图，主张用“无脸美学”和“手持互动”来拉近与消费者的距离。同时，你非常擅长后期网感包装，喜欢在真实的相片上叠加可爱的手绘线条、箭头标注和手写体文字，营造出一种极其生动、有情绪价值的“手账 Plog”氛围。请根据我后续提供的【产品基础信息】，生成出图提示词。
##提示词视觉要求：
纯正手机直出与真实生活感（摄影底座）：画面底图必须是 100% 极度真实的手机主摄记录质感。需要有清晰的生活细节交代，光线为真实的自然光（如窗边柔和阳光）或室内温馨光。绝对不要单反的大光圈过度虚化（Bokeh），保持随手拍的真实空气感。
手持互动与极简无脸美学：绝对不能出现人物的脸部！视觉焦点集中在【产品】以及【与产品互动的手部/身体局部】上。产品被自然地手持、托举，或放置在纯净的生活场景中（如干净的纯色床单、原木桌面）。通过纤细的手模、干净的美甲或衣袖，营造出极强的第一人称代入感。
可爱涂鸦与手账感包装（核心视觉加成）：在真实干净的摄影底图上，必须融合极具小红书网感的手绘涂鸦元素。提示词中需要加入诸如“可爱的彩色马克笔线条（Cute marker lines）”、“手绘箭头指向产品（Hand-drawn arrows pointing to the product）”、“闪亮的小星星涂鸦（Sparkle doodles）”以及“手写体文字排版风格（Handwritten text layout style）”。让整张图片看起来就像是被博主精心排版、画过涂鸦的爆款成品图。
精细化分屏输出：将每一屏的内容分别整理成一段连贯的描述。详细包含：手机摄影的真实场景与自然光影、无脸构图与手持状态的具体动作说明、极简背景的布置，以及画面上具体叠加了哪些涂鸦线条和手绘元素。
##提示词生成规范：
产品极度还原：严格根据我提供的产品信息，真实还原产品的物理特征与包装细节，绝不允许 AI 扭曲变形。
纯中文自然语言：切记，必须是纯中文自然语言描述，绝对不要使用 JSON 格式或任何代码框，确保内容流畅、生动、有网感。
正负面提示词全包含：每一屏都需要输出完整的【中文正向提示词】以及【负面提示词】。
负面提示词必须重点包含：出现人脸、头部、单反拍摄、背景过度虚化、影棚光、刻意摆拍、商业广告海报感、杂乱背景、生硬的电脑字体、劣质 3D 感等。
统一画幅：每一条提示词都需要包含比例尺寸，默认设置比例为小红书黄金竖屏 ${aspectRatio}。
强制切分符号：请强制在每屏提示词的开头使用格式“【第X屏】”（例如【第1屏】、【第2屏】... 一直到【第${count}屏】）。请严格数清楚屏数，必须刚好是 ${count} 屏，如果不到 ${count} 屏说明任务失败！
只输出提示词：你的任务是生成详细的文本提示词框架，不要直接生成图片。
#初始化
请确认你已理解上述要求。接下来我会发送具体的【产品信息】，请立即执行带有手绘涂鸦包装感和手持无脸美学的小红书手机直出风格分屏提示词生成，一共生成 ${count} 屏，绝不可少出！
【产品基础信息】:
${report}`;

      const prompt3 = `
基于以下【爆款生活方式视觉解析报告】，撰写 3 款不同风格的超级爆款小红书标题和文案（如：极简高级风、治愈生活风、干货种草风）。
要求排版具有极其强烈的小红书高级感，善用 Emoji。

【视觉解析报告】：
${report}

请严格以纯 JSON 数组格式输出，包含 3 个对象，结构如下：
[ { "title": "标题...", "content": "正文内容..." } ]
不要带 markdown。
      `;

      const [res2, res3] = await Promise.all([
        ai.models.generateContent({ 
           model: "gemini-3.5-flash", 
           contents: prompt2,
           config: { maxOutputTokens: 8192 }
        }),
        ai.models.generateContent({ 
           model: "gemini-3.5-flash", 
           contents: prompt3,
           config: { maxOutputTokens: 8192 }
        })
      ]);

      if (isCancelled) return res.end();

      // Parse Copywriting
      let copywriting = [];
      try {
        let cwText = (res3.text || "[]").replace(/```json/g, "").replace(/```/g, "").trim();
        copywriting = JSON.parse(cwText);
        sendEvent({ type: "copywriting", data: copywriting });
      } catch (e) {
        console.error("解析文案失败");
      }

      // Parse Image Prompts
      let imagePrompts = [];
      try {
        const text = res2.text || "";
        const screens = text.split(/【第\d+屏】|第\d+屏[:：]|#\s*第\d+屏/).map(s => s.trim()).filter(s => s.length > 5);
        
        let validScreens = screens;
        if (validScreens.length > count) {
           validScreens = validScreens.slice(-count);
        } else if (validScreens.length === 0) {
           validScreens = [text];
        }
        
        while (validScreens.length < count && validScreens.length > 0) {
           // Duplicate the last screen with a slight variation to fulfill the count
           validScreens.push(validScreens[validScreens.length - 1] + " (不同角度)");
        }

        imagePrompts = validScreens.map((screenText, index) => {
          return {
             scene_prompt: screenText,
             caption: `智能极简美学大片 第${index + 1}屏`
          };
        });
      } catch (e) {
        sendEvent({ type: "error", message: "镜头解析失败，请重试。" });
        return res.end();
      }

      console.log(`[3/4] 镜头提取完毕 (${imagePrompts.length}个)，开始生成纯正质感大片...`);
      sendEvent({ type: "progress", progress: 45, message: "正在开始渲染质感摄影大片..." });

      // Step 4: Render Images concurrently (Max 2 at a time to prevent APIMart 429 Too Many Requests)
      let dallexSize: "1024x1024" | "1024x1792" | "1792x1024" = "1024x1792";
      if (aspectRatio === "1:1") dallexSize = "1024x1024";
      // DALL-E 3 supports 1024x1792 for vertical formats like 3:4, 9:16, 2:3
      
      const pLimit = (concurrency: number) => {
         const queue: any[] = [];
         let activeCount = 0;
         const next = () => {
            activeCount--;
            if (queue.length > 0) {
               queue.shift()();
            }
         };
         return async (fn: any) => {
            if (activeCount >= concurrency) {
               await new Promise(resolve => queue.push(resolve));
            }
            activeCount++;
            try {
               return await fn();
            } finally {
               next();
            }
         };
      };
      const limit = pLimit(10);
      
      const generationPromises = imagePrompts.map((promptItem, i) => limit(async () => {
        if (isCancelled) return;

        let imageUrl = "";
        let errMsg = "";
        try {
          const innerOpenai = getOpenAiClient(); // Round-robin key for each parallel request!
          const baseUrl = innerOpenai.baseURL;
          const isApimart = baseUrl.includes("apimart");
          const defaultModel = isApimart ? "gpt-image-2" : "dall-e-3";
          const modelName = process.env.OPENAI_MODEL || defaultModel;

          const finalPrompt = `RAW photo, smartphone photography style. Extremely high quality, ${resolution} resolution concept. ${promptItem.scene_prompt} --ar ${aspectRatio.replace(':', ':')} --v 6.0 --iw 2.0`;

          sendEvent({ type: "image_start", index: i, caption: promptItem.caption });

          const response = await fetch(`${baseUrl.replace(/\/$/, '')}/images/generations`, {
             method: "POST",
             headers: {
                "Authorization": `Bearer ${innerOpenai.apiKey}`,
                "Content-Type": "application/json"
             },
             body: JSON.stringify({
                model: modelName,
                prompt: finalPrompt,
                image: referenceImageUrls,
                n: 1,
                size: dallexSize,
                style: "vivid"
             })
          });
          
          if (!response.ok) {
             const errText = await response.text();
             throw new Error(`[API Error ${response.status}] ${errText.slice(0, 500)}`);
          }
          
          const imgRes: any = await response.json();
          
          if (imgRes.error) {
             throw new Error(imgRes.error.message || JSON.stringify(imgRes.error));
          }
          
          if (imgRes.data && imgRes.data[0]) {
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
                     const statusRes = await fetch(`${baseUrl.replace(/\/$/, '')}/tasks/${taskId}`, {
                        headers: { "Authorization": `Bearer ${innerOpenai.apiKey}` }
                     }).then((r: any) => r.json());
                     
                     if (statusRes.error) {
                        throw new Error(statusRes.error.message || JSON.stringify(statusRes.error));
                     }
                     
                     if (statusRes.data?.status === "completed") {
                        imageUrl = statusRes.data.result?.images?.[0]?.url?.[0] || statusRes.data.result?.images?.[0]?.url || "";
                        completed = true;
                     } else if (statusRes.data?.status === "failed") {
                        throw new Error(statusRes.data.reason || "Task failed on server");
                     }
                   } catch(e){}
                   attempts++;
                }
             }
          }
        } catch (err: any) {
          console.error("生成单张图片失败:", i, err?.message);
          errMsg = err?.message || "生成失败";
        }

        if (!isCancelled) {
           const resultItem = {
             imageUrl,
             caption: promptItem.caption,
             isMock: !imageUrl,
             error: errMsg
           };
           sendEvent({ type: "image", index: i, data: resultItem });
        }
      }));
      
      sendEvent({ type: "progress", progress: 50, message: "并发渲染所有画面..." });
      
      await Promise.all(generationPromises);

      if (!isCancelled) {
        sendEvent({ type: "progress", progress: 100, message: "渲染任务全部完成" });
        sendEvent({ type: "done" });
      }
      res.end();

    } catch (error: any) {
      console.error("整体流程报错:", error);
      sendEvent({ type: "error", message: error.message || "请求处理发生未知错误" });
      res.end();
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Global Error Handler for API routes
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
     if (req.path.startsWith('/api')) {
        console.error('API Error:', err);
        // For SSE if headers are already sent
        if (res.headersSent) {
           res.write(`data: ${JSON.stringify({ type: "error", message: err.message || "Unknown error" })}\n\n`);
           return res.end();
        }
        res.status(500).json({ error: err.message || "Internal server error" });
     } else {
        next(err);
     }
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
