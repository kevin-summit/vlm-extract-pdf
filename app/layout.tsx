import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VLM PDF Extract",
  description: "Extract detailed information from PDFs with a vision language model",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
