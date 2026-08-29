import { useId, useMemo } from "react";
import type { TranslationKey } from "../../i18n/translations";
import { squareCenter, type BoardOrientation, type GuidanceArrow } from "./boardGuidance";

interface BoardGuidanceOverlayProps {
  arrows: GuidanceArrow[];
  orientation: BoardOrientation;
  t: (key: TranslationKey, variables?: Record<string, string | number>) => string;
}

function arrowGeometry(sourceSquare: string, targetSquare: string, orientation: BoardOrientation) {
  const source = squareCenter(sourceSquare, orientation);
  const target = squareCenter(targetSquare, orientation);
  const distance = Math.hypot(target.x - source.x, target.y - source.y) || 1;
  const unitX = (target.x - source.x) / distance;
  const unitY = (target.y - source.y) / distance;
  return {
    x1: source.x + unitX * 18,
    y1: source.y + unitY * 18,
    x2: target.x - unitX * 34,
    y2: target.y - unitY * 34,
    target,
  };
}

function arrowAppearance(arrow: GuidanceArrow) {
  if (arrow.tone === "blunder") return { color: "#b83232", opacity: 0.92, width: 14 };
  if (arrow.tone === "warning") return { color: "#d36c28", opacity: 0.88, width: 13 };
  if (arrow.rank === 1) return { color: "#23834d", opacity: 0.94, width: 18 };
  if (arrow.rank === 2) return { color: "#23834d", opacity: 0.7, width: 13 };
  return { color: "#23834d", opacity: 0.5, width: 9 };
}

export function BoardGuidanceOverlay({ arrows, orientation, t }: BoardGuidanceOverlayProps) {
  const rawId = useId();
  const markerPrefix = rawId.replace(/[^a-zA-Z0-9_-]/g, "");
  const destinationIndexes = useMemo(() => {
    const seen = new Map<string, number>();
    return arrows.map((arrow) => {
      const index = seen.get(arrow.targetSquare) ?? 0;
      seen.set(arrow.targetSquare, index + 1);
      return index;
    });
  }, [arrows]);
  const destinationTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const arrow of arrows) totals.set(arrow.targetSquare, (totals.get(arrow.targetSquare) ?? 0) + 1);
    return totals;
  }, [arrows]);

  if (arrows.length === 0) return null;

  return (
    <div className="board-guidance" role="img" aria-label={t("guidanceOverlayLabel")}>
      <svg viewBox="0 0 800 800" aria-hidden="true" preserveAspectRatio="none">
        <defs>
          {arrows.map((arrow, index) => {
            const appearance = arrowAppearance(arrow);
            const headSize = appearance.width >= 18 ? 30 : appearance.width >= 13 ? 26 : 22;
            return (
              <marker
                key={`marker-${arrow.key}`}
                id={`${markerPrefix}-arrow-${index}`}
                markerWidth={headSize}
                markerHeight={headSize}
                refX={headSize - 2}
                refY={headSize / 2}
                orient="auto"
                markerUnits="userSpaceOnUse"
              >
                <path
                  d={`M0,0 L0,${headSize} L${headSize},${headSize / 2} z`}
                  fill={appearance.color}
                  fillOpacity={appearance.opacity}
                />
              </marker>
            );
          })}
        </defs>
        {arrows.map((arrow, index) => {
          const geometry = arrowGeometry(arrow.sourceSquare, arrow.targetSquare, orientation);
          const appearance = arrowAppearance(arrow);
          return (
            <line
              key={`line-${arrow.key}`}
              data-testid={`guidance-arrow-${arrow.rank ?? "played"}`}
              data-source={arrow.sourceSquare}
              data-target={arrow.targetSquare}
              data-tone={arrow.tone}
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
          );
        })}
        {arrows.map((arrow, index) => {
          const target = squareCenter(arrow.targetSquare, orientation);
          const total = destinationTotals.get(arrow.targetSquare) ?? 1;
          const labelIndex = destinationIndexes[index];
          const x = Math.min(734, Math.max(66, target.x));
          const y = Math.min(780, Math.max(20, target.y + (labelIndex - (total - 1) / 2) * 34));
          const appearance = arrowAppearance(arrow);
          const text = arrow.rank
            ? `${arrow.rank} · ${arrow.evaluation}${arrow.played ? ` · ${arrow.warningSymbol ?? "●"}` : ""}`
            : arrow.warningSymbol ?? "!";
          return (
            <g
              key={`label-${arrow.key}`}
              className="guidance-label"
              data-testid={`guidance-label-${arrow.rank ?? "played"}`}
              data-label-x={x}
              data-label-y={y}
              transform={`translate(${x} ${y})`}
            >
              <rect x="-66" y="-15" width="132" height="30" rx="10" fill="#fffdf8" stroke={appearance.color} strokeWidth="3" />
              <text textAnchor="middle" dominantBaseline="central" fill="#20372b">{text}</text>
            </g>
          );
        })}
      </svg>
      <span className="sr-only">
        {arrows.map((arrow) => arrow.rank
          ? t("guidanceRankedArrow", {
            rank: arrow.rank,
            evaluation: arrow.evaluation ?? "—",
            from: arrow.sourceSquare,
            to: arrow.targetSquare,
          })
          : t(arrow.tone === "blunder" ? "guidanceBlunderArrow" : "guidanceWarningArrow", {
            from: arrow.sourceSquare,
            to: arrow.targetSquare,
          })).join(" ")}
      </span>
    </div>
  );
}
