import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cinzel, cormorant } from "./fonts";
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
  title: "Oneliner",
  description: "Turn your story in one sentence into a movie trailer.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${cinzel.variable} ${cormorant.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
