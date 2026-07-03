import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "고객 화면 · 동네금빵",
  description: "매입 진행 안내 · 대기 시 한국금거래소 시세",
};

export default function CustomerDisplayLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-0 overflow-hidden"
      style={{ backgroundColor: "#efeae0" }}
    >
      {children}
    </div>
  );
}
