import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Resume Rewriter — Your experience, well told",
  description: "Tailor your LaTeX resume to a job, review every change, and export a PDF.",
  icons: { icon: "/favicon.svg" },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
