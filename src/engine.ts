import type { Step } from './board.ts';

export interface Occupant {
  side: '红' | '黑';
  piece: string;
}

export interface ScoredMove {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  piece: string;
  capture: string;
  check: boolean;
  hanging: boolean;
  score: number;
  note: string;
}

const VALUE: Record<string, number> = {
  车: 9, 马: 4, 炮: 4.5, 砲: 4.5, 相: 2, 象: 2, 仕: 2, 士: 2, 兵: 1, 卒: 1, 帅: 100, 将: 100,
};

type Board = Map<string, Occupant>;

function key(x: number, y: number): string {
  return `${x},${y}`;
}

function onBoard(x: number, y: number): boolean {
  return x >= 1 && x <= 9 && y >= 1 && y <= 10;
}

function palace(side: '红' | '黑', x: number, y: number): boolean {
  if (x < 4 || x > 6) return false;
  return side === '黑' ? y >= 1 && y <= 3 : y >= 8 && y <= 10;
}

function ownSide(side: '红' | '黑', y: number): boolean {
  return side === '黑' ? y <= 5 : y >= 6;
}

export function positionFromSteps(steps: readonly Step[]): Board {
  const board: Board = new Map();
  const put = (x: number, y: number, side: '红' | '黑', piece: string) => {
    board.set(key(x, y), { side, piece });
  };
  ['车', '马', '象', '士', '将', '士', '象', '马', '车'].forEach((piece, i) => put(i + 1, 1, '黑', piece));
  put(2, 3, '黑', '砲');
  put(8, 3, '黑', '砲');
  for (const x of [1, 3, 5, 7, 9]) put(x, 4, '黑', '卒');
  for (const x of [1, 3, 5, 7, 9]) put(x, 7, '红', '兵');
  put(2, 8, '红', '炮');
  put(8, 8, '红', '炮');
  ['车', '马', '相', '仕', '帅', '仕', '相', '马', '车'].forEach((piece, i) => put(i + 1, 10, '红', piece));
  for (const step of steps) {
    const from = board.get(key(step.fromX, step.fromY));
    board.delete(key(step.fromX, step.fromY));
    const side = step.side.startsWith('黑') ? '黑' : '红';
    board.set(key(step.toX, step.toY), { side, piece: from?.piece || step.piece });
  }
  return board;
}

function clone(board: Board): Board {
  return new Map(board);
}

function findKing(board: Board, side: '红' | '黑'): { x: number; y: number } | null {
  const name = side === '红' ? '帅' : '将';
  for (const [at, occ] of board) {
    if (occ.side === side && occ.piece === name) {
      const [x, y] = at.split(',').map(Number);
      return { x: x ?? 0, y: y ?? 0 };
    }
  }
  return null;
}

function facing(board: Board): boolean {
  const red = findKing(board, '红');
  const black = findKing(board, '黑');
  if (!red || !black || red.x !== black.x) return false;
  const step = red.y > black.y ? 1 : -1;
  for (let y = black.y + step; y !== red.y; y += step) {
    if (board.has(key(red.x, y))) return false;
  }
  return true;
}

function ray(board: Board, x: number, y: number, dx: number, dy: number, capture: boolean): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  let cx = x + dx;
  let cy = y + dy;
  if (!capture) {
    while (onBoard(cx, cy) && !board.has(key(cx, cy))) {
      out.push({ x: cx, y: cy });
      cx += dx;
      cy += dy;
    }
    return out;
  }
  while (onBoard(cx, cy) && !board.has(key(cx, cy))) {
    cx += dx;
    cy += dy;
  }
  if (!onBoard(cx, cy)) return out;
  cx += dx;
  cy += dy;
  while (onBoard(cx, cy) && !board.has(key(cx, cy))) {
    cx += dx;
    cy += dy;
  }
  if (onBoard(cx, cy)) out.push({ x: cx, y: cy });
  return out;
}

function destinations(board: Board, x: number, y: number, occ: Occupant): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  const push = (tx: number, ty: number) => {
    if (!onBoard(tx, ty)) return;
    const target = board.get(key(tx, ty));
    if (target && target.side === occ.side) return;
    out.push({ x: tx, y: ty });
  };
  if (occ.piece === '车') {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let cx = x + dx;
      let cy = y + dy;
      while (onBoard(cx, cy)) {
        const target = board.get(key(cx, cy));
        if (!target) out.push({ x: cx, y: cy });
        else {
          if (target.side !== occ.side) out.push({ x: cx, y: cy });
          break;
        }
        cx += dx;
        cy += dy;
      }
    }
  } else if (occ.piece === '炮' || occ.piece === '砲') {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (const sq of ray(board, x, y, dx, dy, false)) out.push(sq);
      for (const sq of ray(board, x, y, dx, dy, true)) {
        const target = board.get(key(sq.x, sq.y));
        if (target && target.side !== occ.side) out.push(sq);
      }
    }
  } else if (occ.piece === '马') {
    for (const [dx, dy] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) {
      const legX = x + (Math.abs(dx) === 2 ? Math.sign(dx) : 0);
      const legY = y + (Math.abs(dy) === 2 ? Math.sign(dy) : 0);
      if (board.has(key(legX, legY))) continue;
      push(x + dx, y + dy);
    }
  } else if (occ.piece === '相' || occ.piece === '象') {
    for (const [dx, dy] of [[2, 2], [2, -2], [-2, 2], [-2, -2]]) {
      const tx = x + dx;
      const ty = y + dy;
      if (!ownSide(occ.side, ty)) continue;
      if (board.has(key(x + dx / 2, y + dy / 2))) continue;
      push(tx, ty);
    }
  } else if (occ.piece === '仕' || occ.piece === '士') {
    for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const tx = x + dx;
      const ty = y + dy;
      if (!palace(occ.side, tx, ty)) continue;
      push(tx, ty);
    }
  } else if (occ.piece === '帅' || occ.piece === '将') {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const tx = x + dx;
      const ty = y + dy;
      if (!palace(occ.side, tx, ty)) continue;
      push(tx, ty);
    }
  } else if (occ.piece === '兵' || occ.piece === '卒') {
    const forward = occ.side === '红' ? -1 : 1;
    push(x, y + forward);
    if ((occ.side === '红' && y <= 5) || (occ.side === '黑' && y >= 6)) {
      push(x + 1, y);
      push(x - 1, y);
    }
  }
  return out;
}

function attacks(board: Board, side: '红' | '黑', x: number, y: number): boolean {
  for (const [at, occ] of board) {
    if (occ.side === side) continue;
    const [px, py] = at.split(',').map(Number);
    if (destinations(board, px ?? 0, py ?? 0, occ).some((sq) => sq.x === x && sq.y === y)) return true;
  }
  return false;
}

function inCheck(board: Board, side: '红' | '黑'): boolean {
  if (facing(board)) return true;
  const king = findKing(board, side);
  if (!king) return true;
  return attacks(board, side, king.x, king.y);
}

function applyMove(board: Board, fromX: number, fromY: number, toX: number, toY: number): Board {
  const next = clone(board);
  const occ = next.get(key(fromX, fromY));
  next.delete(key(fromX, fromY));
  if (occ) next.set(key(toX, toY), occ);
  return next;
}

function noteFor(move: { piece: string; capture: string; check: boolean; hanging: boolean }): string {
  const parts: string[] = [];
  if (move.capture) parts.push(`吃${move.capture}`);
  if (move.check) parts.push('将军');
  if (move.hanging) parts.push('走完这枚子可能被吃');
  else parts.push('这枚子暂时安全');
  return parts.join('，');
}

export function advise(steps: readonly Step[], side: '红' | '黑'): ScoredMove[] {
  const board = positionFromSteps(steps);
  const scored: ScoredMove[] = [];
  for (const [at, occ] of board) {
    if (occ.side !== side) continue;
    const [x, y] = at.split(',').map(Number);
    const fromX = x ?? 0;
    const fromY = y ?? 0;
    for (const to of destinations(board, fromX, fromY, occ)) {
      const next = applyMove(board, fromX, fromY, to.x, to.y);
      if (inCheck(next, side)) continue;
      const captured = board.get(key(to.x, to.y));
      const enemy = side === '红' ? '黑' : '红';
      const givesCheck = inCheck(next, enemy);
      const hanging = attacks(next, side, to.x, to.y) && !attacks(next, enemy, to.x, to.y);
      const forward = side === '红' ? fromY - to.y : to.y - fromY;
      let score = (captured ? VALUE[captured.piece] ?? 0 : 0) + forward * 0.08;
      if ((occ.piece === '车' || occ.piece === '马' || occ.piece === '炮' || occ.piece === '砲') && ownSide(side, fromY) && !ownSide(side, to.y)) score += 0.35;
      if (givesCheck) score += 0.5;
      if (hanging) score -= (VALUE[occ.piece] ?? 1) + 1;
      if (captured && hanging) score -= 0.4;
      scored.push({
        fromX, fromY, toX: to.x, toY: to.y, piece: occ.piece,
        capture: captured?.piece ?? '', check: givesCheck, hanging, score,
        note: noteFor({ piece: occ.piece, capture: captured?.piece ?? '', check: givesCheck, hanging }),
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

export function describeCandidates(moves: readonly ScoredMove[], limit = 8): string {
  return moves.slice(0, limit).map((move, index) => (
    `${index + 1}. (${move.fromX},${move.fromY})→(${move.toX},${move.toY}) ${move.piece} ${move.note}`
  )).join('\n');
}
