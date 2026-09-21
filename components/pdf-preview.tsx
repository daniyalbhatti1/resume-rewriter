"use client";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { CircleAlert, LoaderCircle } from "lucide-react";

function PdfPage({ pdf, number }: { pdf: PDFDocumentProxy; number: number }) {
  const container = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0), [text, setText] = useState("");
  useEffect(() => {
    const observer = new ResizeObserver(entries => setWidth(Math.floor(entries[0].contentRect.width)));
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!width) return;
    let cancelled = false;
    let render: { cancel: () => void; promise: Promise<void> } | undefined;
    void pdf.getPage(number).then(async page => {
      if (cancelled || !canvas.current) return;
      const scale = width / page.getViewport({ scale: 1 }).width;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: scale * ratio });
      canvas.current.width = Math.floor(viewport.width); canvas.current.height = Math.floor(viewport.height);
      canvas.current.style.width = "100%"; canvas.current.style.height = "auto";
      render = page.render({ canvas: canvas.current, viewport });
      await render.promise;
      const content = await page.getTextContent();
      if (!cancelled) setText(content.items.map(i => "str" in i ? i.str : "").join(" "));
    }).catch(error => { if (!cancelled && error?.name !== "RenderingCancelledException") console.error("PDF page could not render", error); });
    return () => { cancelled = true; render?.cancel(); };
  }, [pdf, number, width]);
  return <div ref={container} className="pdf-page"><canvas ref={canvas} role="img" aria-label={`Resume page ${number} of ${pdf.numPages}`} aria-describedby={`pdf-text-${number}`}/><p id={`pdf-text-${number}`} className="visually-hidden">{text}</p></div>;
}
export default function PdfPreview({ url }: { url: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null), [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false; let task: { destroy: () => Promise<void> } | undefined;
    setPdf(null); setError("");
    void import("pdfjs-dist").then(async lib => {
      if (cancelled) return;
      lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const loading = lib.getDocument({ url, standardFontDataUrl: "/pdfjs-fonts/" }); task = loading;
      const document = await loading.promise;
      if (!cancelled) setPdf(document);
    }).catch(() => { if (!cancelled) setError("The preview could not load. Use Open PDF to view the file, or update it and try again."); });
    return () => { cancelled = true; void task?.destroy(); };
  }, [url]);
  if (error) return <div className="alert error" role="alert"><CircleAlert size={18}/>{error}</div>;
  if (!pdf) return <div className="pdf-loading" role="status"><LoaderCircle size={20} className="spin"/>Loading your PDF…</div>;
  return <div className="pdf-pages">{Array.from({ length: pdf.numPages }, (_, i) => <PdfPage key={i} pdf={pdf} number={i + 1}/>)}</div>;
}
