import { useId, useMemo } from "react";
import type { TranslationKey } from "../../i18n/translations";
import { RatingIconGlyph } from "../classification/RatingIcon";
import { ratingLabel } from "../classification/ratingPresentation";
import { squareCenter, type BoardOrientation, type GuidanceArrow } from "./boardGuidance";

interface BoardGuidanceOverlayProps {
  arrows: GuidanceArrow[];
  orientation: BoardOrientation;
  t: (key: TranslationKey, variables?: Record<string, string | number>) => string;
}

const BADGE_CORNERS = [
  { x: -24, y: -24, name: "top-left" },
  { x: 24, y: -24, name: "top-right" },
  { x: 24, y: 24, name: "bottom-right" },
  { x: -24, y: 24, name: "bottom-left" },
] as const;

function arrowGeometry(sourceSquare: string, targetSquare: string, orientation: BoardOrientation) {
  const source = squareCenter(sourceSquare, orientation);
  const target = squareCenter(targetSquare, orientation);
  const distance = Math.hypot(target.x - source.x, target.y - source.y) || 1;
  const unitX = (target.x - source.x) / distance;
  const unitY = (target.y - source.y) / distance;
  return {
    x1: source.x + unitX * 22,
    y1: source.y + unitY * 22,
    x2: target.x - unitX * 23,
    y2: target.y - unitY * 23,
  };
}

function arrowAppearance(arrow: GuidanceArrow) {
  if (arrow.tone === "blunder") {
    return { color: "var(--guidance-blunder)", outline: "var(--guidance-blunder-outline)", opacity: 0.94, width: 14 };
  }
  if (arrow.tone === "warning") {
    return { color: "var(--guidance-warning)", outline: "var(--guidance-warning-outline)", opacity: 0.94, width: 13 };
  }
  if (arrow.rank === 1) {
    return { color: "var(--guidance-candidate)", outline: "var(--guidance-candidate-outline)", opacity: 0.96, width: 16 };
  }
  if (arrow.rank === 2) {
    return { color: "var(--guidance-candidate)", outline: "var(--guidance-candidate-outline)", opacity: 0.76, width: 12 };
  }
  return { color: "var(--guidance-candidate)", outline: "var(--guidance-candidate-outline)", opacity: 0.58, width: 9 };
}

function preferredCornerIndex(arrow: GuidanceArrow, orientation: BoardOrientation): number {
  const source = squareCenter(arrow.sourceSquare, orientation);
  const target = squareCenter(arrow.targetSquare, orientation);
  const deltaX = target.x - source.x;
  const deltaY = target.y - source.y;
  const horizontalDirection = Math.abs(deltaX) < 1
    ? arrow.rank === 2 ? -1 : 1
    : Math.sign(deltaX);
  const verticalDirection = Math.abs(deltaY) < 1
    ? arrow.rank === 2 ? -1 : 1
    : Math.sign(deltaY);
  if (horizontalDirection < 0 && verticalDirection < 0) return 0;
  if (horizontalDirection >= 0 && verticalDirection < 0) return 1;
  if (horizontalDirection >= 0 && verticalDirection >= 0) return 2;
  return 3;
}

export function BoardGuidanceOverlay({ arrows, orientation, t }: BoardGuidanceOverlayProps) {
  const rawId = useId();
  const markerPrefix = rawId.replace(/[^a-zA-Z0-9_-]/g, "");
  const descriptionId = `${markerPrefix}-description`;
  const badgeCornerIndexes = useMemo(() => {
    const usedByDestination = new Map<string, Set<number>>();
    return arrows.map((arrow) => {
      const used = usedByDestination.get(arrow.targetSquare) ?? new Set<number>();
      usedByDestination.set(arrow.targetSquare, used);
      const preferred = preferredCornerIndex(arrow, orientation);
      const index = [0, 1, 2, 3]
        .map((offset) => (preferred + offset) % BADGE_CORNERS.length)
        .find((candidate) => !used.has(candidate)) ?? preferred;
      used.add(index);
      return index;
    });
  }, [arrows, orientation]);

  if (arrows.length === 0) return null;

  return (
    <div className="board-guidance">
      <svg
        viewBox="0 0 800 800"
        role="img"
        aria-label={t("guidanceOverlayLabel")}
        aria-describedby={descriptionId}
        preserveAspectRatio="none"
      >
        <defs>
          {arrows.map((arrow, index) => {
            const appearance = arrowAppearance(arrow);
            const headLength = appearance.width * 2.45;
            const headHeight = appearance.width * 2.05;
            return (
              <marker
                key={`marker-${arrow.key}`}
                id={`${markerPrefix}-arrow-${index}`}
                markerWidth={headLength}
                markerHeight={headHeight}
                refX={headLength - 2}
                refY={headHeight / 2}
                orient="auto"
                markerUnits="userSpaceOnUse"
              >
                <path
                  d={`M2,2 L2,${headHeight - 2} L${headLength - 2},${headHeight / 2} Z`}
                  fill={appearance.color}
                  fillOpacity={appearance.opacity}
                  stroke={appearance.outline}
                  strokeOpacity={Math.max(0.76, appearance.opacity)}
                  strokeWidth="5"
                  strokeLinejoin="round"
                  paintOrder="stroke fill"
                />
              </marker>
            );
          })}
        </defs>
        {arrows.map((arrow, index) => {
          const geometry = arrowGeometry(arrow.sourceSquare, arrow.targetSquare, orientation);
          const appearance = arrowAppearance(arrow);
          return (
            <g key={`arrow-${arrow.key}`}>
              <line
                aria-hidden="true"
                x1={geometry.x1}
                y1={geometry.y1}
                x2={geometry.x2}
                y2={geometry.y2}
                stroke={appearance.outline}
                strokeOpacity={Math.max(0.7, appearance.opacity)}
                strokeWidth={appearance.width + 6}
                strokeLinecap="round"
              />
              <line
                data-testid={`guidance-arrow-${arrow.rank ?? "played"}`}
                data-source={arrow.sourceSquare}
                data-target={arrow.targetSquare}
                data-tone={arrow.tone}
                data-head-visible="true"
                x1={geometry.x1}
                y1={geometry.y1}
                x2={geometry.x2}
                y2={geometry.y2}
                stroke={appearance.color}
                strokeOpacity={appearance.opacity}
                strokeWidth={appearance.width}
                strokeLinecap="round"
                markerEnd={`url(#${markerPrefix}-arrow-${index})`}
              />
            </g>
          );
        })}
        {arrows.map((arrow, index) => {
          const target = squareCenter(arrow.targetSquare, orientation);
          const corner = BADGE_CORNERS[badgeCornerIndexes[index]];
          const x = target.x + corner.x;
          const y = target.y + corner.y;
          return (
            <g
              key={`badge-${arrow.key}`}
              className={`guidance-badge rating-${arrow.classification}`}
              data-testid={`guidance-label-${arrow.rank ?? "played"}`}
              data-label-x={x}
              data-label-y={y}
              data-corner={corner.name}
              transform={`translate(${x} ${y})`}
            >
              <circle className="guidance-score-circle" r="22" />
              <text className="guidance-score" textAnchor="middle" dominantBaseline="central">
                {arrow.evaluation ?? "—"}
              </text>
              <circle className="guidance-icon-circle" cx="-14" cy="-14" r="10" />
              <g
                className="guidance-rating-icon"
                transform="translate(-20.6 -20.6) scale(.55)"
                fill="none"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <RatingIconGlyph classification={arrow.classification} />
              </g>
            </g>
          );
        })}
      </svg>
      <span id={descriptionId} className="sr-only">
        {arrows.map((arrow) => arrow.played
          ? t(arrow.tone === "blunder" ? "guidanceBlunderArrow" : "guidanceWarningArrow", {
            classification: ratingLabel(arrow.classification, t),
            evaluation: arrow.evaluation ?? "—",
            from: arrow.sourceSquare,
            to: arrow.targetSquare,
          })
          : t("guidanceRankedArrow", {
            rank: arrow.rank ?? "—",
            classification: ratingLabel(arrow.classification, t),
            evaluation: arrow.evaluation ?? "—",
            from: arrow.sourceSquare,
            to: arrow.targetSquare,
          })).join(" ")}
      </span>
    </div>
  );
}
