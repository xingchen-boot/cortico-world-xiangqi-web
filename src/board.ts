export interface Step {
  side: string;
  piece: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

const BLACK_BACK = ['车', '马', '象', '士', '将', '士', '象', '马', '车'];
const RED_BACK = ['车', '马', '相', '仕', '帅', '仕', '相', '马', '车'];

export function startingBoard(): Map<string, string> {
  const board = new Map<string, string>();
  const put = (x: number, y: number, piece: string) => board.set(`${x},${y}`, piece);
  BLACK_BACK.forEach((piece, i) => put(i + 1, 1, piece));
  put(2, 3, '砲');
  put(8, 3, '砲');
  for (const x of [1, 3, 5, 7, 9]) put(x, 4, '卒');
  for (const x of [1, 3, 5, 7, 9]) put(x, 7, '兵');
  put(2, 8, '炮');
  put(8, 8, '炮');
  RED_BACK.forEach((piece, i) => put(i + 1, 10, piece));
  return board;
}

export function applySteps(steps: readonly Step[]): Map<string, string> {
  const board = startingBoard();
  for (const step of steps) {
    board.delete(`${step.fromX},${step.fromY}`);
    board.set(`${step.toX},${step.toY}`, step.piece);
  }
  return board;
}

export function renderBoard(board: Map<string, string>): string {
  const lines = ['x从左到右是1到9，y从上到下是1到10。黑方底线 y=1，红方底线 y=10。'];
  for (let y = 1; y <= 10; y++) {
    const cells: string[] = [];
    for (let x = 1; x <= 9; x++) cells.push(board.get(`${x},${y}`) ?? '·');
    lines.push(`${y} ${cells.join('')}`);
  }
  return lines.join('\n');
}

export function parseRecord(text: string): Step[] {
  const steps: Step[] = [];
  const re = /(红方|黑方)\s*(\S+)\s*[（(](\d+)\s*[,，]\s*(\d+)[）)]\s*[→>]+\s*[（(](\d+)\s*[,，]\s*(\d+)[）)]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    steps.push({
      side: match[1] ?? '',
      piece: match[2] ?? '',
      fromX: Number(match[3]),
      fromY: Number(match[4]),
      toX: Number(match[5]),
      toY: Number(match[6]),
    });
  }
  return steps;
}
