import type { ToolSpec } from 'cortico/core/types.ts';

export const XIANGQI_TOOL_DECLS: ToolSpec[] = [
  {
    name: 'xiangqi_start',
    tags: ['act'],
    description: '老大让下新的一盘时才调用。开了就自己下，不要再查棋盘。',
    parameters: {
      type: 'object',
      properties: {
        level: { type: 'string' },
        side: { type: 'string' },
      },
      required: [],
    },
  },
  {
    name: 'xiangqi_look',
    tags: ['read'],
    description: '看一眼当前棋局。没下的时候不要调用。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'xiangqi_move',
    tags: ['act'],
    description: '停了的棋要继续时调用。不要填坐标。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
];
