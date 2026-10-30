import type { WorldSection } from 'cortico/world.ts';

export interface XiangqiConfig extends WorldSection {
  enabled: boolean;
  level: string;
  /** 这位的 QQ 号。下棋时他发来消息就停手。空着就只认桌宠上的话。 */
  ownerQq: string;
  /** 记下的棋谱教训。空着就放在数据目录的 xiangqi-lessons.txt。 */
  lessonsFile: string;
  /** Edge 或 Chrome 的路径。空着就在常见安装位置找。 */
  browserPath: string;
}

export const XIANGQI_DEFAULTS: XiangqiConfig = {
  enabled: false,
  level: '中级',
  ownerQq: '',
  lessonsFile: '',
  browserPath: '',
};
