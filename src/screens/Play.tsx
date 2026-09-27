import { type ReactNode, useRef, useState } from "react";
import type { MenuEntry, StatusKey } from "../ui";
import { Icon, Menu, Status, anchorOf } from "../ui";

export type ReadinessRow = {
  id: string;
  status: StatusKey;
  title: string;
  sub: string;
  action?: { label: string; run: () => void; disabled?: boolean };
};

export type Readiness = {
  status: StatusKey;
  word: string;
  headline: string;
  detail: string;
  rows: ReadinessRow[];
};

export default function Play({ readiness, pickers, launchButtons, launchNote }: {
  readiness: Readiness;
  pickers: ReactNode;
  launchButtons: ReactNode;
  launchNote: string | null;
}) {
  return <div className="as-screen as-play">
    <div className="as-stack-loose">
      <div className="as-stack-tight">
        <Status status={readiness.status} cut="var(--bg)">{readiness.word}</Status>
        <h1 className="display as-flat as-display">{readiness.headline}</h1>
        <p className="body k-muted k-measure as-flat">{readiness.detail}</p>
      </div>
      <div className="k-card k-card-flush" role="list" aria-label="Readiness">
        {readiness.rows.map((row) => <div className="k-row as-static as-divided" role="listitem" key={row.id}>
          <Status status={row.status} />
          <div className="k-row-body"><span className="k-row-title">{row.title}</span><span className="k-row-sub" title={row.sub}>{row.sub}</span></div>
          {row.action && <span className="k-row-trail"><button type="button" className="k-btn k-btn-quiet as-btn-compact" disabled={row.action.disabled} onClick={row.action.run}>{row.action.label}</button></span>}
        </div>)}
      </div>
    </div>
    <aside className="k-card as-launch-card" aria-label="This launch">
      <p className="k-eyebrow as-flat">This launch</p>
      {pickers}
      <div className="as-stack-tight as-launch-actions">{launchButtons}</div>
      {launchNote && <p className="subtext k-muted as-flat as-center">{launchNote}</p>}
    </aside>
  </div>;
}

/** A picker row in the launch card: small label over the choice, chevron on the right. */
export function PickerRow({ label, value, items }: { label: string; value: string; items: MenuEntry[] }) {
  const button = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<ReturnType<typeof anchorOf> | null>(null);
  return <>
    <button ref={button} type="button" className="k-row as-picker-row" aria-haspopup="menu" aria-expanded={!!anchor} onClick={() => setAnchor((current) => current ? null : anchorOf(button.current!))}>
      <div className="k-row-body"><span className="k-row-sub">{label}</span><span className="k-row-title as-ellipsis">{value}</span></div>
      <span className="k-row-trail"><Icon name="chevron" /></span>
    </button>
    {anchor && <Menu anchor={anchor} items={items} label={label} returnFocus={button.current} onClose={() => setAnchor(null)} />}
  </>;
}
