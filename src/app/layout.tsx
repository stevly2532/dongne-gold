import type { Metadata } from "next";
import { ThemeProvider } from "@/components/ThemeProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "동네금빵",
  description: "매입·재고·예상 마진",
};

const themeInitScript = `(function(){try{var p=location.pathname;if(p==='/customer-display'||p.indexOf('/customer-display/')===0){document.documentElement.classList.remove('dark');document.documentElement.style.colorScheme='light';return;}var k='goldLedger_theme';var s=localStorage.getItem(k);var d=window.matchMedia('(prefers-color-scheme: dark)').matches;var t=s==='dark'||s==='light'?s:(d?'dark':'light');document.documentElement.classList.toggle('dark',t==='dark');document.documentElement.style.colorScheme=t;}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="flex min-h-full flex-col font-sans">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
