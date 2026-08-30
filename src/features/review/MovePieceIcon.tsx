type MovePieceKind = "pawn" | "knight" | "bishop" | "rook" | "queen" | "king";

function movePieceForSan(san: string): MovePieceKind {
  if (san.startsWith("O-O") || san.startsWith("0-0")) return "king";
  const piece = san[0];
  if (piece === "N") return "knight";
  if (piece === "B") return "bishop";
  if (piece === "R") return "rook";
  if (piece === "Q") return "queen";
  if (piece === "K") return "king";
  return "pawn";
}

function PieceShape({ piece }: { piece: MovePieceKind }) {
  if (piece === "pawn") {
    return <path d="M12 3.2a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4ZM8.8 18.2h6.4l-1.3-7.1h-3.8l-1.3 7.1ZM7 21h10v-2.8H7V21Z" />;
  }
  if (piece === "knight") {
    return <path d="M7.2 20.8h10.4v-2.6h-1.1l.2-3.5c.1-2.8-1.1-5-3.6-6.3l1-3.6-5.6 2.8L6.3 13l4.2.2-2.6 2.9.7 2.1H7.2v2.6Zm3.5-11.7a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />;
  }
  if (piece === "bishop") {
    return <path d="M12 2.7c2.4 2.3 3.7 4.2 3.7 6.1 0 1.8-1 3.3-2.5 4l2.1 5.3H17V21H7v-2.9h1.7l2.1-5.3a4.4 4.4 0 0 1-2.5-4c0-1.9 1.3-3.8 3.7-6.1Zm.8 3.7-2.6 3.1 1.3 1.1 2.6-3.1-1.3-1.1Z" />;
  }
  if (piece === "rook") {
    return <path d="M5.8 3h3v2.2h2V3h2.4v2.2h2V3h3v5.1l-2 1.8 1.1 8.2H19V21H5v-2.9h1.7l1.1-8.2-2-1.8V3Zm3.3 7.3-.9 7.8h7.6l-.9-7.8H9.1Z" />;
  }
  if (piece === "queen") {
    return <path d="M4.5 6.4a2 2 0 1 1 2.1-1.9c0 .4-.1.8-.3 1.1l3 3.2L11 5.2a2 2 0 1 1 2 0l1.7 3.6 3-3.2a2 2 0 1 1 1.8.8l-2.1 11.7H19V21H5v-2.9h1.6L4.5 6.4Zm3.7 11.7h7.6l1.4-8-3.4 3.1L12 8.8l-1.8 4.4-3.4-3.1 1.4 8Z" />;
  }
  return <path d="M10.8 2h2.4v2.2h2.2v2.3h-2.2v2h-2.4v-2H8.6V4.2h2.2V2Zm1.2 6.2c3.1 0 5.3 2.1 5.3 4.9 0 1.8-.9 3.4-2.4 4.3H18V21H6v-3.6h3.1a5 5 0 0 1-2.4-4.3c0-2.8 2.2-4.9 5.3-4.9Z" />;
}

export function MovePieceIcon({ san }: { san: string }) {
  const piece = movePieceForSan(san);
  return (
    <svg
      className="move-piece-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      data-testid={`move-piece-${san}`}
      data-piece={piece}
    >
      <PieceShape piece={piece} />
    </svg>
  );
}
