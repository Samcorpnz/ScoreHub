import type { Shot } from "../screenshots";

export function Screenshot({ shot, eager = false }: { readonly shot: Shot; readonly eager?: boolean }) {
  return (
    <figure className="screenshot">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={shot.src}
        alt={shot.alt}
        width={shot.width}
        height={shot.height}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
      />
      <figcaption>{shot.caption}</figcaption>
    </figure>
  );
}

export function ScreenshotRow({ shots }: { readonly shots: readonly Shot[] }) {
  return (
    <div className="screenshot-row">
      {shots.map(shot => (
        <Screenshot key={shot.src} shot={shot} />
      ))}
    </div>
  );
}
