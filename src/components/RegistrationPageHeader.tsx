import type { ReactNode } from "react";

type Props = {
  title: string;
  description: ReactNode;
  actions?: ReactNode;
};

/** 매입·매출 등록 — 페이지 제목을 흰 카드 밖(매입장부 레이아웃)에 둠 */
export function RegistrationPageHeader({ title, description, actions }: Props) {
  return (
    <header className="mb-1">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="purchase-ledger-header-title">{title}</h1>
          <p className="purchase-ledger-header-desc">{description}</p>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
    </header>
  );
}
