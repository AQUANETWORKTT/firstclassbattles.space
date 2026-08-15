import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://firstclassbattles.space"),
  title: "First Class Battle Network",
  description: "First Class agency battle sheets, matching and poster downloads.",
  icons: {
    icon: [{ url: "/branding/first-class-logo.png", type: "image/png" }],
    shortcut: ["/branding/first-class-logo.png"],
    apple: [{ url: "/branding/first-class-logo.png", type: "image/png" }],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
