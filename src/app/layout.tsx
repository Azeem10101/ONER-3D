import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ONER — Every tonne starts at a chimney",
  description:
    "An environmental AI autopilot. Follow the plume from an industrial plant to the sky, then back down to the water it poisoned.",
  openGraph: {
    title: "ONER — Every tonne starts at a chimney",
    description:
      "A scroll-driven journey through the air and water emissions of an industrial facility.",
    type: "website",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* `bg-ink` matches the WebGL clear colour, so there is no flash of
          white between the server HTML and the first rendered frame. */}
      <body className="min-h-full bg-[#0b100f] text-white">{children}</body>
    </html>
  );
}
