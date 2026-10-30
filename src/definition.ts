import type { WorldDefinition } from 'cortico/world.ts';
import type { DescribeText, EventDescribe } from 'cortico/core/types.ts';
import { describeTools } from 'cortico/world.ts';
import { XIANGQI_DEFAULTS, type XiangqiConfig } from './config.ts';
import { XIANGQI_TOOL_DECLS } from './tools.ts';
import { XiangqiWorld } from './world.ts';

const summaries: Record<string, DescribeText> = {
  xiangqi_start: { zh: '在网页上打开一盘中国象棋人机对局。', en: 'Starts a Chinese-chess game against the website AI.' },
  xiangqi_look: { zh: '看现在的棋盘和轮到谁。', en: 'Reads the current board and whose turn it is.' },
  xiangqi_move: { zh: '按坐标走一步，然后等电脑应着。', en: 'Plays one move by coordinates and waits for the computer.' },
};

const events: EventDescribe[] = [];

export const definition: WorldDefinition<XiangqiConfig> = {
  id: 'xiangqi-web',
  label: '中国象棋',
  defaults: () => structuredClone(XIANGQI_DEFAULTS),
  create: (ctx) => new XiangqiWorld(ctx.cfg, ctx.dataDir),
  describe: { tools: describeTools(XIANGQI_TOOL_DECLS, summaries), events },
};
