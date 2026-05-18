interface Props {
  eyebrow: string;
  title: string;
  description: string;
  comingNext: string[];
}

export function StubPage({ eyebrow, title, description, comingNext }: Props) {
  return (
    <div className="max-w-3xl mx-auto px-6 md:px-8 py-6">
      <div className="text-[11px] tracking-widest uppercase text-slate-500">{eyebrow}</div>
      <h2 className="text-xl font-semibold text-slate-900 mt-1">{title}</h2>
      <p className="text-sm text-slate-500 mt-1">{description}</p>

      <div className="card mt-6 border-brand-100 bg-brand-50/30">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-brand-100 text-brand-600 flex items-center justify-center flex-shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 9v4M12 17h.01"/>
              <circle cx="12" cy="12" r="10"/>
            </svg>
          </div>
          <div className="flex-1">
            <div className="font-semibold text-slate-900">Coming next</div>
            <p className="text-sm text-slate-600 mt-1">
              This page is a placeholder. The functionality below is on the roadmap — share screenshots
              and I&apos;ll build it out.
            </p>
            <ul className="mt-4 space-y-1.5 text-sm text-slate-700">
              {comingNext.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <svg className="text-brand-500 mt-0.5 flex-shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12l5 5L20 7"/>
                  </svg>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
