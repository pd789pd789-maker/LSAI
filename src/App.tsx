import React, { useState, useRef, useEffect } from "react";
import { UploadCloud, Image as ImageIcon, Sparkles, Loader2, RefreshCcw, Download, Trash2, Home, FolderOpen, ArrowRight, Settings2, PackageSearch, Check, X, AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { motion, AnimatePresence } from "motion/react";
import JSZip from "jszip";
import { saveAs } from "file-saver";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type GeneratedImage = {
  imageUrl: string;
  caption: string;
  isMock?: boolean;
  error?: string;
};

type Copywriting = {
  title: string;
  content: string;
};

type ImageGroup = {
  id: string;
  timestamp: number;
  description: string;
  settings: string;
  results: GeneratedImage[];
  copywriting?: Copywriting[];
};

export default function App() {
  const [currentView, setCurrentView] = useState<'home' | 'workspace'>('home');
  const [tab, setTab] = useState<'generate' | 'library'>('generate');
  
  // Library State
  const [library, setLibrary] = useState<ImageGroup[]>([]);
  
  useEffect(() => {
    const saved = localStorage.getItem("LIFESTYLE_LIBRARY");
    if (saved) {
      try {
        setLibrary(JSON.parse(saved));
      } catch (e) {}
    }
  }, []);

  const addToLibrary = (group: ImageGroup) => {
    const newLib = [group, ...library];
    setLibrary(newLib);
    localStorage.setItem("LIFESTYLE_LIBRARY", JSON.stringify(newLib));
  };

  const updateCurrentGroupInLibrary = (group: ImageGroup) => {
    setLibrary(prev => {
      const idx = prev.findIndex(g => g.id === group.id);
      if (idx !== -1) {
        const newLib = [...prev];
        newLib[idx] = group;
        localStorage.setItem("LIFESTYLE_LIBRARY", JSON.stringify(newLib));
        return newLib;
      } else {
        const newLib = [group, ...prev];
        localStorage.setItem("LIFESTYLE_LIBRARY", JSON.stringify(newLib));
        return newLib;
      }
    });
  };

  const deleteGroup = (id: string) => {
    const newLib = library.filter(g => g.id !== id);
    setLibrary(newLib);
    localStorage.setItem("LIFESTYLE_LIBRARY", JSON.stringify(newLib));
  };

  const downloadGroup = async (group: ImageGroup) => {
    const zip = new JSZip();
    const folder = zip.folder(`LIFESTYLE_${group.id.slice(0, 5)}`);
    if (!folder) return;

    for (let i = 0; i < group.results.length; i++) {
      const imgUrl = group.results[i].imageUrl;
      if (imgUrl) {
        try {
          const response = await fetch(imgUrl);
          const blob = await response.blob();
          folder.file(`image_${i + 1}.jpg`, blob);
        } catch (err) {
          console.error("图片下载失败", err);
        }
      }
    }
    const zipBlob = await zip.generateAsync({ type: "blob" });
    saveAs(zipBlob, `LIFESTYLE_${group.id.slice(0, 5)}.zip`);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setShowToast(true);
      setTimeout(() => setShowToast(false), 2000);
    }).catch(err => console.error("Copy failed", err));
  };

  const downloadSingleImage = async (url: string, index: number) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      saveAs(blob, `LIFESTYLE_Image_${index}.jpg`);
    } catch (err) {
      console.error("图片下载失败", err);
    }
  };

  // Generate State
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [aspectRatio, setAspectRatio] = useState("3:4");
  const [resolution, setResolution] = useState("1k");
  const [count, setCount] = useState<number>(4);

  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingImages, setGeneratingImages] = useState<Record<number, { progress: number; message: string; caption?: string; done: boolean; imageUrl?: string; error?: string }>>({});
  const [progressMsg, setProgressMsg] = useState("");
  const [progress, setProgress] = useState(0);
  const [currentGroup, setCurrentGroup] = useState<ImageGroup | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [previewState, setPreviewState] = useState<{ images: string[], index: number } | null>(null);
  const [showToast, setShowToast] = useState(false);
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      const newFiles = [...selectedFiles, ...files].slice(0, 9);
      setSelectedFiles(newFiles);
      setPreviewUrls(newFiles.map(f => URL.createObjectURL(f)));
      setCurrentGroup(null);
      setErrorMsg("");
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      const newFiles = [...selectedFiles, ...files].slice(0, 9);
      setSelectedFiles(newFiles);
      setPreviewUrls(newFiles.map(f => URL.createObjectURL(f)));
      setCurrentGroup(null);
      setErrorMsg("");
    }
  };

  const removeFile = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    const newFiles = [...selectedFiles];
    newFiles.splice(index, 1);
    setSelectedFiles(newFiles);
    setPreviewUrls(newFiles.map(f => URL.createObjectURL(f)));
  };

  const cancelGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsGenerating(false);
    setProgressMsg("已终止生成任务");
  };

  const clearWorkspace = () => {
    setCurrentGroup(null);
    setSelectedFiles([]);
    setPreviewUrls([]);
    setDescription("");
    setProgress(0);
    setErrorMsg("");
  };

  const resultsPanelRef = useRef<HTMLDivElement>(null);

  const generateImages = async () => {
    if (selectedFiles.length === 0) return;
    setIsGenerating(true);
    setErrorMsg("");
    setProgress(0);
    setProgressMsg("正在连接视觉引擎...");
    setGeneratingImages({});
    let currentGenImages: Record<number, any> = {};
    
    // Add small delay to let UI render the loading state, then scroll down on mobile
    setTimeout(() => {
      if (window.innerWidth < 1024 && resultsPanelRef.current) {
        resultsPanelRef.current.scrollIntoView({ behavior: 'smooth' });
      }
    }, 100);
    
    // Create new group for streaming updates
    const groupId = Date.now().toString() + Math.random().toString(36).substring(7);
    const initialGroup: ImageGroup = {
      id: groupId,
      timestamp: Date.now(),
      description: description || "未提供文字描述",
      settings: `${aspectRatio} | ${resolution} | ${count}张`,
      results: [],
      copywriting: []
    };
    setCurrentGroup(initialGroup);

    abortControllerRef.current = new AbortController();

    const formData = new FormData();
    selectedFiles.forEach(file => {
      formData.append("images", file);
    });
    formData.append("description", description);
    formData.append("aspectRatio", aspectRatio);
    formData.append("resolution", resolution);
    formData.append("count", count.toString());

    try {
      const response = await fetch("/api/generate-images", {
        method: "POST",
        headers: { "Accept": "text/event-stream" },
        body: formData,
        signal: abortControllerRef.current.signal
      });

      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("text/html")) {
        throw new Error("登录会话已过期，请刷新页面重新连接。");
      }

      if (!response.ok) {
        throw new Error("服务请求失败");
      }

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      
      let done = false;
      let finalGroup = { ...initialGroup };
      let buffer = "";

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          
          for (const line of lines) {
             if (line.trim() === "") continue;
             try {
                const event = JSON.parse(line);
                if (event.type === "progress") {
                   setProgress(event.progress);
                   setProgressMsg(event.message);
                } else if (event.type === "image_start") {
                   currentGenImages = { ...currentGenImages, [event.index]: { progress: 0, message: "准备渲染...", caption: event.caption, done: false } };
                   setGeneratingImages(currentGenImages);
                } else if (event.type === "image_progress") {
                   currentGenImages = {
                      ...currentGenImages,
                      [event.index]: { ...currentGenImages[event.index], progress: event.progress, message: event.message }
                   };
                   setGeneratingImages(currentGenImages);
                } else if (event.type === "copywriting") {
                   finalGroup.copywriting = event.data;
                   setCurrentGroup({...finalGroup});
                } else if (event.type === "image") {
                   currentGenImages = {
                      ...currentGenImages,
                      [event.index]: { ...currentGenImages[event.index], progress: 100, message: event.data.error ? "失败" : "完成", done: true, imageUrl: event.data.imageUrl, error: event.data.error }
                   };
                   setGeneratingImages(currentGenImages);
                   const newResults = [...(finalGroup.results || [])];
                   newResults[event.index] = event.data;
                   finalGroup.results = newResults.filter(Boolean);
                   setCurrentGroup({...finalGroup});
                } else if (event.type === "error") {
                   setErrorMsg(event.message);
                   setIsGenerating(false);
                   return;
                } else if (event.type === "done") {
                   setIsGenerating(false);
                   updateCurrentGroupInLibrary(finalGroup);
                }
             } catch (e) {
                console.error("Chunk parse error:", line);
             }
          }
        }
      }
      
      if (buffer.trim() !== "") {
         try {
            const event = JSON.parse(buffer);
            if (event.type === "progress") {
               setProgress(event.progress);
               setProgressMsg(event.message);
            } else if (event.type === "image") {
               const newResults = [...(finalGroup.results || [])];
               newResults[event.index] = event.data;
               finalGroup.results = newResults.filter(Boolean);
               setCurrentGroup({...finalGroup});
            } else if (event.type === "done") {
               setIsGenerating(false);
               updateCurrentGroupInLibrary(finalGroup);
            }
         } catch (e) {
            console.error("Final chunk parse error:", buffer);
         }
      }

    } catch (err: any) {
      if (err.name === 'AbortError') {
         setErrorMsg("已取消生成任务");
      } else {
         setErrorMsg(err.message);
      }
      setIsGenerating(false);
    } finally {
      setIsGenerating(false);
    }
  };

  if (currentView === 'home') {
    return (
      <div className="min-h-screen bg-[#0A0A0A] text-white flex flex-col items-center justify-center relative overflow-hidden font-sans selection:bg-red-500">
        <div className="absolute top-1/4 left-1/4 w-[250px] md:w-[400px] h-[250px] md:h-[400px] bg-[#FF2442]/20 blur-[90px] md:blur-[120px] rounded-full pointer-events-none mix-blend-screen animate-pulse"></div>
        <div className="absolute bottom-1/4 right-1/4 w-[200px] md:w-[300px] h-[200px] md:h-[300px] bg-white/10 blur-[80px] md:blur-[100px] rounded-full pointer-events-none mix-blend-screen animate-pulse delay-1000"></div>

        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="text-center z-10 max-w-3xl px-6 flex flex-col items-center"
        >
          <motion.div 
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.6 }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 bg-white/5 backdrop-blur-md mb-8 shadow-[0_0_15px_rgba(255,36,66,0.2)]"
          >
            <Sparkles className="w-4 h-4 text-[#FF2442]" />
            <span className="text-[10px] md:text-xs tracking-widest font-mono text-gray-200">LIFESTYLE STUDIO</span>
          </motion.div>
          
          <motion.h1 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.6 }}
            className="text-5xl md:text-7xl lg:text-8xl font-bold tracking-tighter mb-6 leading-[1.1]"
          >
            定义你的<br/><span className="text-transparent bg-clip-text bg-gradient-to-r from-[#FF2442] to-red-400">视觉张力</span>
          </motion.h1>
          
          <motion.p 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.6, duration: 0.6 }}
            className="text-base md:text-xl text-gray-400 mb-12 max-w-2xl mx-auto font-light leading-relaxed px-4 md:px-0"
          >
            融合尖端视觉引擎与专业构图算法构建的极简工作流。<br className="hidden md:block" />只需一张手摄产品图，全自动进行包装美学拆解、构建光影排版方案，<br className="hidden md:block" />一键重塑拥有顶流网感的爆款生活场景图与爆款体验文案。
          </motion.p>

          <motion.button 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.8, duration: 0.6 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setCurrentView('workspace')}
            className="group relative inline-flex items-center justify-center gap-3 bg-white text-black px-8 md:px-10 py-4 md:py-5 rounded-full font-bold text-base md:text-lg transition-all duration-300 shadow-[0_0_40px_rgba(255,255,255,0.2)] hover:shadow-[0_0_60px_rgba(255,36,66,0.4)] border border-transparent"
          >
            {isGenerating ? (
              <>
                 <Loader2 className="w-5 h-5 md:w-6 md:h-6 animate-spin" />
                 生成进行中，返回工作室
              </>
            ) : (
              <>
                 进入美学工作室
                 <ArrowRight className="w-5 h-5 md:w-6 md:h-6 group-hover:translate-x-1 transition-transform" />
              </>
            )}
          </motion.button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F6F8] text-[#111] font-sans selection:bg-red-200 flex h-screen overflow-hidden">
      
      {/* Sidebar Desktop */}
      <aside className="hidden md:flex w-64 bg-white border-r border-gray-200 flex-col z-20">
        <div className="p-6 flex items-center gap-3">
          <div className="bg-[#111] w-10 h-10 rounded-xl flex items-center justify-center shadow-md">
            <Sparkles className="w-5 h-5 text-[#FF2442]" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">LIFESTYLE</h1>
            <p className="text-[10px] text-gray-500 font-medium">高级感图文构建</p>
          </div>
        </div>

        <nav className="flex-1 px-4 space-y-2 mt-4">
          <button 
            onClick={() => setTab('generate')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-2xl font-medium transition-all group",
              tab === 'generate' ? "bg-[#111] text-white shadow-lg" : "text-gray-600 hover:bg-gray-100"
            )}
          >
            <Settings2 className={cn("w-5 h-5", tab === 'generate' ? "text-white" : "text-gray-400 group-hover:text-gray-600")} />
            <span className="text-sm">质感大片重构</span>
          </button>

          <button 
            onClick={() => setTab('library')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-2xl font-medium transition-all group",
              tab === 'library' ? "bg-[#111] text-white shadow-lg" : "text-gray-600 hover:bg-gray-100"
            )}
          >
            <FolderOpen className={cn("w-5 h-5", tab === 'library' ? "text-white" : "text-gray-400 group-hover:text-gray-600")} />
            <span className="text-sm">我的灵感库</span>
          </button>
        </nav>

        <div className="p-6">
          <button 
            onClick={() => setCurrentView('home')}
            className="w-full flex justify-center items-center gap-2 py-3 rounded-xl border border-gray-200 text-xs font-semibold text-gray-500 hover:bg-gray-50 hover:text-gray-800 transition-colors"
          >
            <Home className="w-4 h-4" /> 离开工作室
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative pb-16 md:pb-0">
        <header className="h-14 md:h-16 bg-white/80 backdrop-blur-md border-b border-gray-200 flex items-center px-4 md:px-8 z-10 sticky top-0">
          <h2 className="font-bold text-base md:text-lg">{tab === 'generate' ? '光影美学引擎 - 生活方式' : '灵感作品素材库'}</h2>
        </header>

        <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 md:p-8">
          {tab === 'generate' && (
            <div className="flex flex-col lg:flex-row gap-4 md:gap-6 min-h-full lg:h-full items-stretch lg:items-start">
              
              {/* Generate Config Panel */}
              <div className="w-full lg:w-80 xl:w-96 shrink-0 flex flex-col gap-5 bg-white rounded-2xl md:rounded-3xl p-5 border border-gray-100 shadow-sm relative z-0">
                
                {/* Upload Section */}
                <div>
                  <h3 className="text-sm font-bold mb-3 flex items-center justify-between">
                    1. 核心产品图 <span className="text-[10px] text-gray-400 font-normal">建议高光清晰</span>
                  </h3>
                  <div 
                    className={cn(
                      "relative group border-2 border-dashed rounded-2xl p-4 text-center transition-all duration-300 min-h-[140px] flex flex-col items-center justify-center overflow-hidden",
                      previewUrls.length > 0 ? "border-transparent bg-gray-50 items-start" : "border-gray-200 bg-gray-50 hover:bg-red-50 hover:border-red-300 cursor-pointer",
                      isGenerating && "opacity-50 pointer-events-none"
                    )}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleDrop}
                    onClick={() => { if (previewUrls.length < 9) fileInputRef.current?.click(); }}
                  >
                    <input type="file" hidden multiple ref={fileInputRef} accept="image/*" onChange={handleFileChange} />
                    {previewUrls.length > 0 ? (
                      <div className="w-full flex flex-col items-center justify-center">
                        <div className="flex flex-wrap gap-2 w-full">
                          {previewUrls.map((url, idx) => (
                            <div key={idx} className="relative aspect-square w-16 md:w-20 rounded-lg overflow-hidden shadow-sm group/item">
                              <img src={url} alt={`Preview ${idx + 1}`} className="w-full h-full object-cover" />
                              <div 
                                className="absolute inset-0 bg-black/50 opacity-0 group-hover/item:opacity-100 flex items-center justify-center transition-opacity cursor-pointer text-white text-xs"
                                onClick={(e) => removeFile(e, idx)}
                              >
                                删除
                              </div>
                            </div>
                          ))}
                          {previewUrls.length < 9 && (
                            <div 
                              className="relative aspect-square w-16 md:w-20 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:bg-gray-100 transition-colors"
                              onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                            >
                               <span className="text-gray-400 text-2xl">+</span>
                            </div>
                          )}
                        </div>
                        <p className="text-[10px] text-gray-500 mt-3 w-full text-left">已选 {previewUrls.length}/9 张</p>
                      </div>
                    ) : (
                      <>
                        <div className="bg-white p-2.5 rounded-full shadow-sm mb-2 text-[#FF2442] flex items-center justify-center mx-auto">
                          <UploadCloud className="w-5 h-5" />
                        </div>
                        <p className="text-[11px] font-semibold text-gray-600 text-center mx-auto">直接拖拽，或点击上传最多9张参考图</p>
                      </>
                    )}
                  </div>
                </div>

                {/* Settings Section */}
                <div className={cn(isGenerating && "opacity-50 pointer-events-none")}>
                  <h3 className="text-sm font-bold mb-2">2. 美学意境补充</h3>
                  <textarea 
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="如：一款成分温和的精华，希望放置在充满阳光的极简原木梳妆台，展现治愈松弛感..." 
                    className="w-full h-24 bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs resize-none focus:outline-none focus:border-[#FF2442] focus:ring-1 focus:ring-[#FF2442] transition-shadow placeholder:text-gray-400"
                  ></textarea>
                </div>

                <div className={cn("grid grid-cols-2 gap-3", isGenerating && "opacity-50 pointer-events-none")}>
                  <div>
                    <h3 className="text-xs font-bold mb-2">构图比例</h3>
                    <select 
                      value={aspectRatio} 
                      onChange={(e) => setAspectRatio(e.target.value)}
                      className="w-full bg-gray-50 border border-gray-200 text-xs rounded-xl px-2 py-2 focus:outline-none focus:border-[#111]"
                    >
                      <option value="3:4">3:4 (精选)</option>
                      <option value="9:16">9:16 (全面屏)</option>
                      <option value="2:3">2:3 (光影画幅)</option>
                    </select>
                  </div>
                  <div>
                    <h3 className="text-xs font-bold mb-2">输出品质</h3>
                    <select 
                      value={resolution} 
                      onChange={(e) => setResolution(e.target.value)}
                      className="w-full bg-gray-50 border border-gray-200 text-xs rounded-xl px-2 py-2 focus:outline-none focus:border-[#111]"
                    >
                      <option value="1k">1K 标准质感</option>
                      <option value="2k">2K 超清增强</option>
                      <option value="4k">4K 商业大片</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <h3 className="text-xs font-bold mb-2 flex justify-between">
                      构建镜数 <span className="text-[#FF2442] font-mono">{count} 屏</span>
                    </h3>
                    <input 
                      type="range" min="1" max="16" value={count} 
                      onChange={(e) => setCount(parseInt(e.target.value))}
                      className="w-full accent-[#FF2442] cursor-pointer"
                    />
                  </div>
                </div>

                {errorMsg && (
                  <div className="bg-red-50 text-red-600 p-3 rounded-lg text-xs border border-red-100 flex items-start gap-2">
                    <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>{errorMsg}</span>
                  </div>
                )}

                <div className="mt-2 flex gap-2">
                   {!isGenerating ? (
                     <button
                       onClick={generateImages}
                       disabled={selectedFiles.length === 0}
                       className={cn(
                         "flex-1 py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all",
                         (selectedFiles.length === 0)
                           ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                           : "bg-[#111] text-white hover:bg-[#FF2442] shadow-lg hover:shadow-[#FF2442]/30 active:scale-[0.98]"
                       )}
                     >
                        <Sparkles className="w-4 h-4" /> 深度重构
                     </button>
                   ) : (
                     <button
                       onClick={cancelGeneration}
                       className="flex-1 py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all bg-gray-100 text-[#111] hover:bg-gray-200 active:scale-[0.98]"
                     >
                        <X className="w-4 h-4" /> 停止任务
                     </button>
                   )}
                </div>
              </div>

              {/* Generation Results Panel */}
              <div 
                ref={resultsPanelRef}
                className="flex-1 w-full min-h-[600px] lg:h-full lg:min-h-0 flex flex-col bg-white rounded-2xl md:rounded-3xl border border-gray-100 shadow-xl overflow-hidden relative"
              >
                
                {/* Header Action Bar */}
                {currentGroup && !isGenerating && (
                  <div className="absolute top-4 right-4 z-10 flex gap-2">
                     <button 
                       onClick={clearWorkspace}
                       className="bg-white/90 backdrop-blur border border-gray-200 text-gray-600 hover:text-red-500 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition flex items-center gap-1.5"
                     >
                       <Trash2 className="w-3.5 h-3.5" /> 清空画板
                     </button>
                  </div>
                )}

                {/* Progress Overlay */}
                {isGenerating && (
                  <div className="sticky top-0 z-20 bg-white/90 backdrop-blur-md border-b border-gray-100 p-4 shrink-0">
                     <div className="flex items-center justify-between mb-3 w-full max-w-lg mx-auto">
                        <div className="flex items-center gap-2">
                           <Loader2 className="w-5 h-5 text-[#FF2442] animate-spin" />
                           <span className="text-sm font-bold tracking-wide">生成大片中...</span>
                        </div>
                        <span className="text-sm font-mono font-bold text-[#FF2442]">{Math.round(progress)}%</span>
                     </div>
                     <div className="w-full max-w-lg mx-auto bg-gray-100 h-1.5 rounded-full overflow-hidden mb-2">
                        <motion.div 
                          className="h-full bg-gradient-to-r from-red-400 to-[#FF2442]" 
                          animate={{ width: `${progress}%` }} 
                          transition={{ ease: "linear", duration: 0.5 }}
                        />
                     </div>
                     <p className="text-[10px] md:text-xs text-gray-500 text-center w-full max-w-lg mx-auto">{progressMsg}</p>
                  </div>
                )}

                <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
                  {!currentGroup && !isGenerating ? (
                    <div className="w-full h-full flex flex-col items-center justify-center text-gray-300 min-h-[300px]">
                       <PackageSearch className="w-12 h-12 md:w-16 md:h-16 mb-4 opacity-40 stroke-1" />
                       <p className="text-xs md:text-sm font-medium tracking-wide">高端生活场景大片将在此呈列</p>
                    </div>
                  ) : isGenerating ? (
                    <div className="pb-16 lg:pb-0 pt-2 lg:pt-0">
                      <div className="mb-6">
                         <h3 className="font-bold text-lg md:text-xl text-[#111] tracking-tight">并发渲染引擎启动</h3>
                         <p className="text-[10px] md:text-xs text-gray-400 mt-1 uppercase tracking-wider">{count} 张图片正在同时生成...</p>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 md:gap-5">
                        {Array.from({ length: Math.max(count, Object.keys(generatingImages).length) }).map((_, idx) => {
                          const genState = generatingImages[idx];
                          return (
                            <div key={idx} className="bg-gray-50 rounded-xl md:rounded-2xl overflow-hidden border border-gray-100 shadow-sm relative aspect-[3/4] flex flex-col items-center justify-center p-4">
                               {genState?.imageUrl ? (
                                  <motion.img 
                                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                                    src={genState.imageUrl || undefined} className="absolute inset-0 w-full h-full object-cover" alt="Draft" 
                                  />
                               ) : (
                                  <div className="w-full h-full flex flex-col items-center justify-center">
                                     <div className="w-full max-w-[80%] bg-gray-200 h-1.5 rounded-full overflow-hidden mb-4 shadow-inner">
                                       <motion.div 
                                         className="h-full bg-gradient-to-r from-red-400 to-[#FF2442]" 
                                         animate={{ width: `${genState?.progress || 0}%` }} 
                                         transition={{ ease: "linear", duration: 0.5 }}
                                       />
                                     </div>
                                     <p className="text-[10px] md:text-xs text-gray-500 font-medium text-center px-2">{genState?.message || "等待分配..."}</p>
                                  </div>
                               )}
                               {genState?.done && (
                                   <div className="absolute top-2 right-2 bg-green-500 text-white rounded-full p-1.5 shadow-md">
                                     <Check className="w-3 h-3" />
                                   </div>
                               )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : currentGroup ? (
                    <div className="pb-16 lg:pb-0 pt-2 lg:pt-0">
                      <div className="mb-6 md:mb-8 pr-16 md:pr-0">
                         <h3 className="font-bold text-lg md:text-xl text-[#111] tracking-tight">本组视觉档案</h3>
                         <p className="text-[10px] md:text-xs text-gray-400 mt-1 uppercase tracking-wider">{currentGroup.settings}</p>
                      </div>

                      {/* Display Grid */}
                      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 md:gap-5">
                        <AnimatePresence>
                          {currentGroup.results.map((item, idx) => (
                            <motion.div 
                               initial={{ opacity: 0, scale: 0.95 }}
                               animate={{ opacity: 1, scale: 1 }}
                               transition={{ delay: idx * 0.05 }}
                               key={idx}
                               className="bg-gray-50 rounded-xl md:rounded-2xl overflow-hidden border border-gray-100 group shadow-sm hover:shadow-lg transition-all relative"
                            >
                               <div className="relative aspect-[3/4] bg-gray-100 overflow-hidden">
                                  <img 
                                    src={item.imageUrl || undefined} 
                                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                                    alt={`Shot ${idx+1}`}
                                  />
                                  <div className="absolute top-2 right-2 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button 
                                      onClick={() => downloadSingleImage(item.imageUrl, idx + 1)}
                                      className="bg-white/90 p-2 rounded-full hover:bg-white shadow text-[#111] active:scale-90 transition-transform"
                                      title="保存大图"
                                    >
                                      <Download className="w-3.5 h-3.5" />
                                    </button>
                                    <button 
                                      onClick={() => setPreviewState({ images: currentGroup.results.map(r => r.imageUrl || ""), index: idx })}
                                      className="bg-white/90 p-2 rounded-full hover:bg-white shadow text-[#111] active:scale-90 transition-transform"
                                      title="鉴赏全图"
                                    >
                                      <ImageIcon className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                               </div>
                            </motion.div>
                          ))}
                        </AnimatePresence>
                      </div>

                      {/* Copywriting Section */}
                      {currentGroup.copywriting && currentGroup.copywriting.length > 0 && (
                        <div className="mt-12 md:mt-16 border-t border-gray-100 pt-8 md:pt-10">
                          <h3 className="font-bold text-base md:text-lg text-[#111] mb-6 flex items-center gap-2">
                             <span className="w-2 h-2 bg-[#FF2442] rounded-full"></span> 
                             场景匹配爆款文案
                          </h3>
                          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-5">
                             {currentGroup.copywriting.map((copy, idx) => (
                               <motion.div 
                                 initial={{ y: 20, opacity: 0 }}
                                 animate={{ y: 0, opacity: 1 }}
                                 transition={{ delay: 0.2 + (idx * 0.1) }}
                                 key={idx} 
                                 className="bg-gray-50/50 hover:bg-white border-2 border-transparent hover:border-gray-100 rounded-2xl p-5 md:p-6 flex flex-col relative group transition-all shadow-sm hover:shadow-lg"
                               >
                                  <div className="flex justify-between items-start mb-4">
                                     <h4 className="font-bold text-sm text-[#111] pr-10 leading-snug tracking-wide">{copy.title}</h4>
                                     <button 
                                        onClick={() => copyToClipboard(`${copy.title}\n\n${copy.content}`)}
                                        className="absolute top-5 right-5 bg-white border border-gray-200 text-gray-500 hover:text-[#FF2442] hover:border-[#FF2442] p-2 rounded-xl transition-all shadow-sm active:scale-95"
                                        title="一键复制到剪贴板"
                                     >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                                     </button>
                                  </div>
                                  <div className="text-[11px] md:text-xs text-gray-600 leading-relaxed overflow-y-auto max-h-40 md:max-h-48 mb-2 whitespace-pre-wrap flex-1 scrollbar-hide font-sans">
                                     {copy.content}
                                  </div>
                               </motion.div>
                             ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )}

          {tab === 'library' && (
            <div className="h-full flex flex-col gap-6">
              {library.length === 0 ? (
                <div className="flex-1 rounded-3xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center text-gray-400 bg-white shadow-sm min-h-[300px]">
                  <FolderOpen className="w-12 h-12 mb-4 opacity-30 stroke-1" />
                  <p className="text-xs md:text-sm tracking-wide">空空如也，快去工作室进行艺术重塑吧</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-6 md:gap-8 pb-10">
                  {library.map((group) => (
                    <div key={group.id} className="bg-white rounded-2xl md:rounded-3xl border border-gray-100 shadow-sm md:shadow-md p-4 md:p-8 relative overflow-hidden">
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between mb-6 pb-5 border-b border-gray-50">
                        <div className="mb-4 lg:mb-0">
                          <h4 className="font-bold text-sm md:text-base text-[#111] flex items-center gap-2">
                            {new Date(group.timestamp).toLocaleString()} 
                            <span className="bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-mono text-[10px] tracking-wider">{group.settings}</span>
                          </h4>
                          <p className="text-[11px] md:text-xs text-gray-400 mt-2 line-clamp-1 max-w-2xl font-light" title={group.description}>
                            美学设定: {group.description}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 md:gap-3">
                          <button 
                            onClick={() => downloadGroup(group)}
                            className="flex-1 lg:flex-none flex justify-center items-center gap-2 bg-[#111] hover:bg-gray-800 text-white px-4 py-2.5 rounded-xl text-xs font-semibold transition shadow-md"
                          >
                            <Download className="w-3.5 h-3.5" /> 典藏本辑 ({group.results.length}P)
                          </button>
                          <button 
                            onClick={() => deleteGroup(group.id)}
                            className="bg-red-50 hover:bg-red-100 text-red-600 p-2.5 rounded-xl transition"
                            title="销毁记录"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Display Grid */}
                      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 md:gap-5">
                        {group.results.map((img, i) => (
                          <div key={i} className="group relative rounded-xl overflow-hidden border border-gray-100 aspect-[3/4] shadow-sm">
                             {img.error ? (
                               <div className="w-full h-full bg-red-50 flex flex-col items-center justify-center p-4 text-center">
                                  <AlertCircle className="w-6 h-6 text-red-400 mb-2" />
                                  <span className="text-[10px] text-red-500 font-medium leading-tight">{img.error}</span>
                               </div>
                             ) : (
                               <img src={img.imageUrl || undefined} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" alt="lib" loading="lazy" />
                             )}
                             <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-3">
                                <div className="flex justify-end gap-1.5">
                                   <button 
                                     onClick={() => setPreviewState({ images: group.results.map(r => r.imageUrl || ""), index: i })}
                                     className="bg-white/20 p-2 rounded-lg hover:bg-white/40 backdrop-blur active:scale-95 transition"
                                     title="鉴赏全图"
                                   >
                                     <ImageIcon className="w-3.5 h-3.5 text-white" />
                                   </button>
                                   <button 
                                     onClick={() => downloadSingleImage(img.imageUrl, i + 1)}
                                     className="bg-white/20 p-2 rounded-lg hover:bg-white/40 backdrop-blur active:scale-95 transition"
                                     title="保存大图"
                                   >
                                     <Download className="w-3.5 h-3.5 text-white" />
                                   </button>
                                   <button 
                                     onClick={() => {
                                        const newResults = group.results.filter((_, idx) => idx !== i);
                                        if (newResults.length === 0) {
                                            deleteGroup(group.id);
                                        } else {
                                            updateCurrentGroupInLibrary({ ...group, results: newResults });
                                        }
                                     }}
                                     className="bg-red-500/80 p-2 rounded-lg hover:bg-red-500 backdrop-blur active:scale-95 transition"
                                     title="剔除废片"
                                   >
                                     <Trash2 className="w-3.5 h-3.5 text-white" />
                                   </button>
                                </div>
                                <p className="text-[10px] text-white font-medium line-clamp-3 leading-snug" title={img.caption}>
                                  {img.caption}
                                </p>
                             </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Mobile Bottom Navigation */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-white/95 backdrop-blur-lg border-t border-gray-200 flex justify-around items-center z-40 px-4 pb-safe shadow-[0_-5px_15px_rgba(0,0,0,0.05)]">
        <button 
          onClick={() => setTab('generate')}
          className={cn("flex flex-col items-center gap-1", tab === 'generate' ? "text-[#111]" : "text-gray-400")}
        >
          <Settings2 className="w-5 h-5" />
          <span className="text-[10px] font-bold">美学构建</span>
        </button>
        
        <button 
          onClick={() => setCurrentView('home')}
          className="flex flex-col items-center gap-1 text-gray-400 -mt-6"
        >
           <div className="bg-[#111] w-12 h-12 rounded-full flex items-center justify-center border-4 border-[#F5F6F8] shadow-sm transform hover:scale-105 active:scale-95 transition-all">
              <Home className="w-5 h-5 text-white" />
           </div>
        </button>

        <button 
          onClick={() => setTab('library')}
          className={cn("flex flex-col items-center gap-1", tab === 'library' ? "text-[#111]" : "text-gray-400")}
        >
          <FolderOpen className="w-5 h-5" />
          <span className="text-[10px] font-bold">灵感典藏</span>
        </button>
      </div>

      {/* Toast Notification */}
      <AnimatePresence>
        {showToast && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }} 
            animate={{ opacity: 1, y: 0 }} 
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-24 md:bottom-10 left-1/2 -translate-x-1/2 z-[100] bg-[#111] text-white px-6 py-3 rounded-full shadow-2xl font-medium text-sm flex items-center gap-2 whitespace-nowrap"
          >
            <Check className="w-4 h-4 text-green-400" />
            <span>内容已存入剪贴板</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Lightbox / Preview Modal */}
      <AnimatePresence>
        {previewState && previewState.images[previewState.index] && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-sm flex items-center justify-center p-4 md:p-8"
            onClick={() => setPreviewState(null)}
          >
            <button className="absolute top-6 right-6 text-white/50 hover:text-white p-2 transition-colors z-[101]">
              <X className="w-8 h-8" />
            </button>
            <button 
               className="absolute left-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white transition-colors z-[101] bg-black/20 hover:bg-black/40 rounded-full p-2"
               onClick={(e) => { e.stopPropagation(); setPreviewState({ ...previewState, index: (previewState.index - 1 + previewState.images.length) % previewState.images.length }); }}
            >
               <ChevronLeft className="w-8 h-8 md:w-10 md:h-10" />
            </button>
            <button 
               className="absolute right-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white transition-colors z-[101] bg-black/20 hover:bg-black/40 rounded-full p-2"
               onClick={(e) => { e.stopPropagation(); setPreviewState({ ...previewState, index: (previewState.index + 1) % previewState.images.length }); }}
            >
               <ChevronRight className="w-8 h-8 md:w-10 md:h-10" />
            </button>
            <motion.img 
              key={previewState.images[previewState.index]}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              src={previewState.images[previewState.index] || undefined} 
              className="max-w-full max-h-[85vh] object-contain rounded-md shadow-2xl relative z-[100]" 
              alt="Preview Fullscreen" 
              onClick={(e) => e.stopPropagation()}
            />
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/80 font-medium text-sm tracking-widest pointer-events-none">
              {previewState.index + 1} / {previewState.images.length}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
