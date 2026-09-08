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
  metadataBase: new URL("https://virtualis-hajsza-demo.simplepixel.chatgpt.site"),
  title: "Kapj el, ha tudsz! – Online hajsza",
  description: "Taktikai, térképes üldözés Budapesten és romániai városok valódi úthálózatán.",
  openGraph: {
    title: "Kapj el, ha tudsz!",
    description: "Hívd meg a barátaidat, válasszatok szerepet, és indulhat az online hajsza Romániában.",
    type: "website",
    locale: "hu_HU",
    images: [{ url: "/og.png", width: 1746, height: 909, alt: "Kapj el, ha tudsz! – Online hajsza Romániában" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Kapj el, ha tudsz!",
    description: "Online taktikai hajsza a barátaiddal.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="hu">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
