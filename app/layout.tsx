import type { Metadata } from "next";
import "./globals.css";
import { AnalysisProvider } from "@/lib/analysisContext";

export const metadata: Metadata = {
  title: "DebugDNA — Diagnosability Regression Tester",
  description:
    "Detects regressions in failure diagnosability caused by code changes.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-white text-gray-900 antialiased">
        <AnalysisProvider>{children}</AnalysisProvider>
      </body>
    </html>
  );
}
