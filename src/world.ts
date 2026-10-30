import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Logger, ToolDef, World, WorldHost } from 'cortico/core/types.ts';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { applySteps, renderBoard, type Step } from './board.ts';
import { advise } from './engine.ts';
import type { XiangqiConfig } from './config.ts';
import { XIANGQI_TOOL_DECLS } from './tools.ts';

const PET_PORT = 7797;
const GAME_URL = 'https://chess.z3web.cn/game/single/';
const FILE_X = [58, 147, 235, 324, 412, 501, 589, 678, 766];
const RANK_Y = [54, 134, 213, 293, 372, 452, 531, 611, 690, 770];

interface PageState {
  turn: string;
  level: string;
  steps: Step[];
  over: boolean;
  outcome: '' | '胜' | '负' | '结束';
}

function browserPath(configured: string): string {
  const given = configured.trim();
  if (given && existsSync(given)) return given;
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  const found = candidates.find((path) => existsSync(path));
  if (!found) throw new Error('没有找到 Edge 或 Chrome，打不开象棋网页。');
  return found;
}

function usefulLesson(lesson: string): string {
  const text = lesson.replace(/[。！]/g, '').trim();
  if (!text || text === '无' || text.startsWith('无')) return '';
  if (/不必过度反应|暂无实质|只是调整|只是占位|虚张声势|不必急|需先|暂缓|护住|化解|避让|盯着|压向我/.test(text)) return '';
  return text.slice(0, 40);
}

function parseDecision(content: string): { thought: string; lesson: string; from: { x: number; y: number }; to: { x: number; y: number } } | null {
  const lesson = usefulLesson(content.match(/反思[:：]\s*([^\n]+)/)?.[1]?.trim() ?? '');
  const thought = (content.match(/想法[:：]\s*([^\n]+)/)?.[1]?.trim() ?? '').slice(0, 40);
  const after = content.split(/走[:：]/).pop() ?? '';
  const pairs = [...after.matchAll(/(\d+)\s*[,，]\s*(\d+)/g)];
  if (pairs.length < 2) return null;
  const from = parseSquare(`${pairs[pairs.length - 2][1]},${pairs[pairs.length - 2][2]}`);
  const to = parseSquare(`${pairs[pairs.length - 1][1]},${pairs[pairs.length - 1][2]}`);
  if (!from || !to || (from.x === to.x && from.y === to.y)) return null;
  return { thought, lesson, from, to };
}

function isContinue(text: string): boolean {
  const body = text.replace(/^.*老大[:：]/, '').replace(/[啊呀吧呢哦哇\s，。！？,.!]/g, '');
  return ['继续', '继续下', '接着下', '接着走', '再走', '往下走', '继续下啊'].includes(body);
}

function parseSquare(raw: string): { x: number; y: number } | null {
  const match = raw.trim().match(/^(\d+)\s*[,，]\s*(\d+)$/);
  if (!match) return null;
  const x = Number(match[1]);
  const y = Number(match[2]);
  if (x < 1 || x > 9 || y < 1 || y > 10) return null;
  return { x, y };
}

function readLessons(file: string): string[] {
  if (!file || !existsSync(file)) return [];
  return readFileSync(file, 'utf8').split(/\n+/).map((line) => usefulLesson(line)).filter(Boolean).slice(-24);
}

function writeLessons(file: string, lines: string[]): void {
  if (!file) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, lines.slice(-24).join('\n') + (lines.length ? '\n' : ''), 'utf8');
}

function describe(state: PageState): string {
  if (state.over) return '这盘已经结束。';
  const board = renderBoard(applySteps(state.steps));
  const last = state.steps[state.steps.length - 1];
  const lastLine = last ? `上一手：${last.side}${last.piece} (${last.fromX},${last.fromY})→(${last.toX},${last.toY})。` : '';
  return `${lastLine}轮到${state.turn || '未知'}。\n${board}`;
}

export class XiangqiWorld implements World {
  readonly id = 'xiangqi-web';
  private readonly cfg: XiangqiConfig;
  private log: Logger | null = null;
  private host: WorldHost | null = null;
  private browser: Browser | null = null;
  private page: Page | null = null;
  private playing = false;
  private stopPlay = false;
  private seenCursor = 0;
  private side: '红方' | '黑方' = '红方';
  private notes: string[] = [];
  private lastSpoken = '';
  private readonly dataDir: string;

  constructor(cfg: XiangqiConfig, dataDir: string) {
    this.cfg = cfg;
    this.dataDir = dataDir;
  }

  private lessonsPath(): string {
    const configured = this.cfg.lessonsFile.trim();
    return configured || join(this.dataDir, 'xiangqi-lessons.txt');
  }

  envPromptVars(): Record<string, string> | null {
    return {
      how: '老大让下才开局。开了之后本地算着，不把棋盘送进聊天。',
    };
  }

  tools(): ToolDef[] {
    const handlers: Record<string, ToolDef['handler']> = {
      xiangqi_start: (args) => this.startGame(args),
      xiangqi_look: () => this.look(),
      xiangqi_move: (args) => this.move(args),
    };
    return XIANGQI_TOOL_DECLS.map((decl) => ({ ...decl, handler: handlers[decl.name] ?? (async () => '没有这个工具。') }));
  }

  async start(host: WorldHost): Promise<void> {
    this.log = host.log;
    this.host = host;
  }

  async stop(): Promise<void> {
    this.stopPlay = true;
    const browser = this.browser;
    this.browser = null;
    this.page = null;
    if (browser) await browser.close().catch(() => undefined);
  }

  private async startGame(args: Record<string, unknown>): Promise<string> {
    if (this.playing) return '已经在下。结束这一轮，不要再调用工具，也不要翻聊天记录。';
    const level = '初级';
    const side = args.side === '黑' ? '黑方' : '红方';
    this.side = side;
    this.seenCursor = this.host?.store.latestCursor() ?? 0;
    await this.ensurePage();
    const page = this.page;
    if (!page) return '浏览器没有打开。';
    const current = await this.readState();
    const inProgress = (current.turn === '红方' || current.turn === '黑方') && !current.over;
    if (!inProgress) this.notes = [];
    if (!inProgress) {
      await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.dismissInstallPrompt();
      await page.waitForFunction('document.body && document.body.innerText.includes("开始游戏")', { timeout: 20000 });
      await page.evaluate(`(() => {
        const click = (label) => {
          const el = [...document.querySelectorAll("button,label,span,div")].find((node) => node.textContent && node.textContent.trim() === label);
          if (el) el.click();
        };
        click(${JSON.stringify(side)});
        click(${JSON.stringify(level)});
        click("开始游戏");
      })()`);
      await this.waitForTurn(side, 20000);
    }
    this.stopPlay = false;
    this.playing = true;
    void this.playLoop();
    return `棋盘已打开，你执${side === '红方' ? '红' : '黑'}。接下来只看棋盘自己下。结束这一轮，不要再调用象棋工具，也不要翻聊天记录。老大发来消息再回他。`;
  }

  private async look(): Promise<string> {
    if (this.playing) return '正在下，只看棋盘。结束这一轮，不要翻聊天记录。';
    if (!this.page) return '还没开局。老大让下时再用 xiangqi_start。';
    return describe(await this.readState());
  }

  private async move(): Promise<string> {
    if (this.playing) return '已经在下。结束这一轮，不要再调用工具。';
    if (!this.page) return '还没开局。用 xiangqi_start。';
    const state = await this.readState();
    if (state.over || (state.turn !== '红方' && state.turn !== '黑方')) return '这盘不在下。用 xiangqi_start 开新的。';
    this.stopPlay = false;
    this.playing = true;
    void this.playLoop();
    return '接着下。结束这一轮，不要再调用工具。';
  }

  private async playLoop(): Promise<void> {
    let misses = 0;
    let blanks = 0;
    let rejected = '';
    try {
      for (let n = 0; n < 160 && !this.stopPlay; n++) {
        if (this.ownerSpoke()) return;
        const state = await this.readState();
        if (state.over) {
          const line = state.outcome === '负' ? '这盘我输了' : state.outcome === '胜' ? '这盘我赢了' : '这盘下完了';
          await this.bubble(line);
          return;
        }
        if (state.turn !== this.side) {
          await this.pause(500);
          continue;
        }
        const decision = this.think(state, rejected);
        if (!decision) {
          blanks += 1;
          if (blanks >= 6) {
            await this.bubble('这步一直没想出来，先停一下');
            return;
          }
          await this.pause(1000);
          continue;
        }
        blanks = 0;
        this.remember(decision.lesson);
        if (decision.thought && decision.thought !== this.lastSpoken) {
          this.lastSpoken = decision.thought;
          await this.bubble(decision.thought);
        }
        if (!await this.pause(800)) return;
        const landed = await this.attemptMove(decision.from, decision.to);
        if (!landed) {
          misses += 1;
          rejected = `刚才 (${decision.from.x},${decision.from.y})→(${decision.to.x},${decision.to.y}) 没走成，换一步，不要再走这一步。`;
          if (misses === 3) await this.bubble('这步没点上，我再试');
          continue;
        }
        misses = 0;
        rejected = '';
        const after = (await this.readState()).steps.length;
        await this.waitForSteps(after + 1, 15000);
      }
    } catch (error) {
      this.log?.error('下棋中断', { err: error instanceof Error ? error.message : '失败' });
    } finally {
      this.playing = false;
    }
  }

  private ownerSpoke(): boolean {
    const host = this.host;
    if (!host) return false;
    const latest = host.store.latestCursor();
    if (latest <= this.seenCursor) return false;
    const events = host.store.range({ fromCursor: this.seenCursor + 1, toCursor: latest });
    this.seenCursor = latest;
    for (const event of events) {
      const owner = this.cfg.ownerQq.trim();
      const fromOwner = owner.length > 0 && event.type === 'qq.message' && event.text.includes(`QQ:${owner}`);
      const atPet = event.type === 'desktop-pet.message' || event.type === 'desktop-pet.speech';
      if ((fromOwner || atPet) && !isContinue(event.text)) {
        this.stopPlay = true;
        return true;
      }
    }
    return false;
  }

  private async pause(ms: number): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (this.stopPlay || this.ownerSpoke()) return false;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return !this.stopPlay;
  }

  private async bubble(text: string): Promise<void> {
    const script = text.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!script) return;
    for (let port = PET_PORT; port < PET_PORT + 6; port++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/say`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ script }),
        });
        if (res.ok) return;
      } catch {
        continue;
      }
    }
  }

  private thinkBrief(state: PageState, rejected: string): string {
    const saved = readLessons(this.lessonsPath());
    const parts = [describe(state), '自己判断这一步。先看这步争到什么、会不会丢子、对方下一手能怎么应。吃子只是选择之一，不划算就不要吃。不要只守，也不要无故送子。'];
    if (saved.length) parts.push(`以前从对局里记下的：\n${saved.map((line) => `- ${line}`).join('\n')}`);
    if (this.notes.length) parts.push(`这一盘记下的：\n${this.notes.map((line) => `- ${line}`).join('\n')}`);
    if (rejected) parts.push(rejected);
    return parts.join('\n');
  }

  private remember(lesson: string): void {
    const text = lesson.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!text || text === '无') return;
    if (!this.notes.includes(text)) {
      this.notes.push(text);
      if (this.notes.length > 8) this.notes.shift();
    }
    const saved = readLessons(this.lessonsPath());
    if (saved.includes(text)) return;
    saved.push(text);
    writeLessons(this.lessonsPath(), saved);
  }

  private think(state: PageState, rejected = ''): { thought: string; lesson: string; from: { x: number; y: number }; to: { x: number; y: number } } | null {
    const side = this.side === '黑方' ? '黑' : '红';
    const legal = advise(state.steps, side).filter((move) => !rejected.includes(`(${move.fromX},${move.fromY})→(${move.toX},${move.toY})`));
    const pool = legal.length ? legal : advise(state.steps, side);
    const safe = pool.filter((move) => !move.hanging);
    const move = (safe.length ? safe : pool)[0];
    if (!move) return null;
    return {
      thought: move.note,
      lesson: '',
      from: { x: move.fromX, y: move.fromY },
      to: { x: move.toX, y: move.toY },
    };
  }

  private async dismissInstallPrompt(): Promise<void> {
    const page = this.page;
    if (!page) return;
    await page.evaluate(`(() => {
      const refuse = ["取消", "不安装", "不用了", "以后再说", "关闭", "暂不"];
      const nodes = [...document.querySelectorAll("button, [role=button]")];
      if (!document.body || !document.body.innerText.includes("安装")) return;
      const target = nodes.find((node) => refuse.includes((node.textContent || "").trim()));
      if (target) target.click();
    })()`).catch(() => undefined);
  }

  private async attemptMove(from: { x: number; y: number }, to: { x: number; y: number }): Promise<boolean> {
    const nudges: Array<[number, number]> = [[0, 0], [8, 0], [-8, 0], [0, 8], [0, -8]];
    for (const [dx, dy] of nudges) {
      const before = (await this.readState()).steps.length;
      await this.page?.evaluate('document.querySelector("canvas") && document.querySelector("canvas").scrollIntoView({block:"center"})');
      await this.clickSquare(from.x, from.y, dx, dy);
      await this.pause(180);
      await this.clickSquare(to.x, to.y, dx, dy);
      if (await this.waitForSteps(before + 1, 900)) return true;
      await this.clickSquare(from.x, from.y, 0, 0);
      await this.pause(120);
    }
    return false;
  }

  private async ensurePage(): Promise<void> {
    if (this.page && !this.page.isClosed()) return;
    const browser = await puppeteer.launch({
      executablePath: browserPath(this.cfg.browserPath),
      headless: false,
      defaultViewport: { width: 900, height: 1100 },
      args: [
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-default-apps',
        '--disable-features=msEdgePWA,msPWA,InstallableAppBanner,PwaUniversalInstall,WebAppInstallation',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    });
    this.browser = browser;
    const page = await browser.newPage();
    page.on('dialog', (dialog) => { void dialog.dismiss(); });
    this.page = page;
    this.log?.info('中国象棋浏览器已打开');
  }

  private async clickSquare(x: number, y: number, dx = 0, dy = 0): Promise<void> {
    const page = this.page;
    if (!page) return;
    const point = await page.evaluate(`(() => {
      const canvas = document.querySelector("canvas");
      if (!canvas) return null;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      const w = canvas.width;
      const h = canvas.height;
      const img = ctx.getImageData(0, 0, w, h).data;
      const lum = (x, y) => {
        const i = (y * w + x) * 4;
        return (img[i] + img[i + 1] + img[i + 2]) / 3;
      };
      const scan = (horizontal) => {
        const hits = [];
        const limit = horizontal ? h : w;
        const other = horizontal ? w : h;
        for (let i = 0; i < limit; i++) {
          let dark = 0;
          let n = 0;
          for (let j = 0; j < other; j += 2) {
            n++;
            const value = horizontal ? lum(j, i) : lum(i, j);
            if (value < 120) dark++;
          }
          if (dark > n * 0.45) hits.push(i);
        }
        return hits;
      };
      const cluster = (points) => {
        const groups = [];
        for (const p of points) {
          const last = groups[groups.length - 1];
          if (!last || p - last[last.length - 1] > 4) groups.push([p]);
          else last.push(p);
        }
        return groups.map((g) => g[Math.floor(g.length / 2)]);
      };
      const extend = (centers, want, limit) => {
        if (centers.length === want) return centers;
        if (centers.length !== want - 1 || centers.length < 2) return null;
        const gaps = [];
        for (let i = 1; i < centers.length; i++) gaps.push(centers[i] - centers[i - 1]);
        gaps.sort((a, b) => a - b);
        const gap = gaps[Math.floor(gaps.length / 2)];
        const before = centers[0] - gap;
        const after = centers[centers.length - 1] + gap;
        const preferAfter = centers[0] <= limit - 1 - centers[centers.length - 1];
        if (preferAfter && after < limit) return centers.concat([after]);
        if (!preferAfter && before >= 0) return [before].concat(centers);
        if (after < limit) return centers.concat([after]);
        if (before >= 0) return [before].concat(centers);
        return null;
      };
      const ys = extend(cluster(scan(true)), 10, h);
      const xs = extend(cluster(scan(false)), 9, w);
      const fallbackX = ${JSON.stringify(FILE_X)}.map((v) => v * w / 825);
      const fallbackY = ${JSON.stringify(RANK_Y)}.map((v) => v * h / 825);
      const px = (xs || fallbackX)[${x - 1}];
      const py = (ys || fallbackY)[${y - 1}];
      if (px === undefined || py === undefined) return null;
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left + px * rect.width / w, y: rect.top + py * rect.height / h };
    })()`) as { x: number; y: number } | null;
    if (!point) throw new Error('页面上没有棋盘。');
    await page.mouse.click(point.x + dx, point.y + dy);
  }

  private async readState(): Promise<PageState> {
    const page = this.page;
    if (!page) return { turn: '', level: '', steps: [], over: false, outcome: '' };
    return page.evaluate(`(() => {
      const text = document.body.innerText;
      const turnMatch = text.match(/当前回合方：(红方|黑方)/);
      const levelMatch = text.match(/当前AI等级：\\s*(初级|中级|高级)/);
      const steps = [];
      const re = /(红方|黑方)\\s*(\\S+)\\s*[（(](\\d+)\\s*[,，]\\s*(\\d+)[）)]\\s*[→>]+\\s*[（(](\\d+)\\s*[,，]\\s*(\\d+)[）)]/g;
      let match;
      while ((match = re.exec(text))) {
        steps.push({
          side: match[1],
          piece: match[2],
          fromX: Number(match[3]),
          fromY: Number(match[4]),
          toX: Number(match[5]),
          toY: Number(match[6]),
        });
      }
      const over = text.includes("跳过结算");
      let outcome = "";
      if (over) {
        if (/你赢了|挑战成功|红方胜利/.test(text)) outcome = "胜";
        else if (/你输了|挑战失败|红方失败|惜败/.test(text)) outcome = "负";
        else outcome = "结束";
      }
      return {
        turn: turnMatch ? turnMatch[1] : "",
        level: levelMatch ? levelMatch[1] : "",
        steps: steps,
        over: over,
        outcome: outcome,
      };
    })()`) as PageState;
  }

  private async waitForTurn(turn: string, timeoutMs: number): Promise<void> {
    const page = this.page;
    if (!page) return;
    await page.waitForFunction(`document.body && document.body.innerText.includes(${JSON.stringify(`当前回合方：${turn}`)})`, { timeout: timeoutMs });
  }

  private async waitForSteps(count: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const state = await this.readState();
      if (state.steps.length >= count) return true;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return false;
  }
}
