import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Game Studio",
  description: "Create HTML5 games through natural language conversation",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
