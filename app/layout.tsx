import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Navbar from "./navbar";
import BanknoteBackground from "./banknote-background";
import { WalletProvider } from "@/lib/wallet-context";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "MoneyFund",
    template: "%s | MoneyFund",
  },
  description: "MoneyFund — The World's Biggest Hedge Fun.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased pt-14`}
      >
        <WalletProvider>
          <BanknoteBackground />
          <Navbar />
          {children}
        </WalletProvider>
      </body>
    </html>
  );
}
