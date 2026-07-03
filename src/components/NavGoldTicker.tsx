"use client";

/** TradingView Single Quote — 높이 126 유지(등락률), 가로만 축소 */
const TV_W = 310;
const TV_H = 126;
/** 등락률 포함 전체가 보이는 범위에서 축소 */
const TV_SCALE = 0.62;

const TV_SINGLE_QUOTE_SRC =
  "https://s.tradingview.com/embed-widget/single-quote/?locale=kr#" +
  encodeURIComponent(
    JSON.stringify({
      symbol: "TVC:GOLD",
      width: TV_W,
      height: TV_H,
      colorTheme: "light",
      isTransparent: true,
      locale: "kr",
    }),
  );

type Props = {
  className?: string;
};

export function NavGoldTicker({ className = "" }: Props) {
  return (
    <div
      className={`nav-gold-ticker ${className}`.trim()}
      aria-label="GOLD 시세 TradingView"
      style={{
        width: TV_W * TV_SCALE,
        height: TV_H * TV_SCALE,
      }}
    >
      <iframe
        title="GOLD · TradingView"
        src={TV_SINGLE_QUOTE_SRC}
        width={TV_W}
        height={TV_H}
        frameBorder={0}
        scrolling="no"
        allowTransparency
        style={{
          border: 0,
          transform: `scale(${TV_SCALE})`,
          transformOrigin: "top left",
        }}
      />
    </div>
  );
}
