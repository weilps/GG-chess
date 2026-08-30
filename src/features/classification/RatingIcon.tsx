import type { MoveClassificationId } from "../../types";

interface RatingIconProps {
  classification: MoveClassificationId;
  label?: string;
  decorative?: boolean;
  className?: string;
}

/**
 * Original ChessMate glyphs. The silhouettes intentionally remain distinct
 * at list size so classification never depends on colour alone.
 */
export function RatingIconGlyph({ classification }: { classification: MoveClassificationId }) {
  switch (classification) {
    case "brilliant":
      return <>
        <path d="M8 3.5v11M16 3.5v11" />
        <circle cx="8" cy="19" r="1" fill="currentColor" stroke="none" />
        <circle cx="16" cy="19" r="1" fill="currentColor" stroke="none" />
      </>;
    case "great":
      return <>
        <path d="M12 5v10" />
        <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
        <path d="M5.5 8.5 3.5 7M18.5 8.5 20.5 7M12 2V1" />
      </>;
    case "best":
      return <>
        <path d="m4 8 4.2 3L12 4l3.8 7L20 8l-1.5 10h-13L4 8Z" />
        <path d="M6 21h12" />
      </>;
    case "excellent":
      return <>
        <path d="M12 20V5" />
        <path d="m6.5 10.5 5.5-5.5 5.5 5.5" />
        <path d="M6 20h12" />
      </>;
    case "good":
      return <path d="m4.5 12.5 4.6 4.6L19.7 6.5" />;
    case "inaccuracy":
      return <>
        <path d="M3.5 15.5c2.2-7 5.2 7 8 0s5.7 7 9 0" />
        <path d="M4 20h16" />
      </>;
    case "mistake":
      return <>
        <path d="M12 3.5 21 20H3L12 3.5Z" />
        <path d="M12 9v5.2M12 17.5h.01" />
      </>;
    case "miss":
      return <>
        <path d="M14.8 4.5A8.5 8.5 0 1 0 20 10" />
        <path d="M12 8a4 4 0 1 0 4 4" />
        <path d="m14 10 6-6M16 4h4v4" />
      </>;
    case "blunder":
      return <>
        <path d="m5 5 14 14M19 5 5 19" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      </>;
    case "notRated":
      return <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M7.5 12h9" />
      </>;
  }
}

export function RatingIcon({
  classification,
  label,
  decorative = false,
  className = "",
}: RatingIconProps) {
  return (
    <svg
      className={`rating-icon ${className}`.trim()}
      data-rating-icon={classification}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={decorative ? "true" : undefined}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      focusable="false"
    >
      <RatingIconGlyph classification={classification} />
    </svg>
  );
}
