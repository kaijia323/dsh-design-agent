/**
 * 设计画布 host 侧的冻结词汇表（T2 所有者为 teammate-host）。
 *
 * 这里只有常量和 JSDoc 类型，没有运行时代码。客户端（T3）与验收（T5）以本文件
 * 为准；要改字段名或 op 词表，必须先发消息给 Lead，禁止单方面改动。
 *
 * @module dsh-design-agent/host/types
 */

/** design.json 当前结构版本。加 selection 后由 1 升到 2。 */
export const DESIGN_JSON_VERSION = 2;

/** 设计工程目录名（相对 workspace 根）。 */
export const DESIGN_DIR = '.design';

/** design.json 文件名。 */
export const DESIGN_JSON = 'design.json';

/** design.json 损坏时的备份文件名。 */
export const DESIGN_JSON_BACKUP = 'design.json.bak';

/** 单屏 HTML 的目录名（相对 .design）。 */
export const FRAMES_DIR = 'frames';

/** 设计契约 CSS 变量文件名。 */
export const TOKENS_FILE = 'tokens.css';

/** 单帧 HTML 字节上限：2MB。 */
export const MAX_FRAME_BYTES = 2 * 1024 * 1024;

/** 画布写通道的 exact 路径。 */
export const ROUTE_PATH = '/design-canvas/api';

/** 请求体字节上限：4MB。 */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** frame 尺寸缺省值（客户端未传 width/height 时）。 */
export const DEFAULT_FRAME_WIDTH = 1280;

/** frame 尺寸缺省值。 */
export const DEFAULT_FRAME_HEIGHT = 900;

/**
 * 固定错误码。AC11/AC12 按这些码验收，不要新增第 7 个：
 * - `ENOWRITE` 目录/文件不可写（message 必须含失败路径与原因）
 * - `EJSON` design.json 非法（已备份为 design.json.bak 并回退空工程）
 * - `ETOOLARGE` 单帧 > 2MB
 * - `EEMPTY` 单帧 0 字节
 * - `ENOFRAME` frameId 不存在或非法
 * - `EUNKNOWN` 未知 op / 未知 method / 无法解析的会话
 */
export const ERROR_CODES = Object.freeze({
  NOWRITE: 'ENOWRITE',
  JSON: 'EJSON',
  TOOLARGE: 'ETOOLARGE',
  EMPTY: 'EEMPTY',
  NOFRAME: 'ENOFRAME',
  UNKNOWN: 'EUNKNOWN',
});

/**
 * 画布操作词表（冻结）。未知 kind 整批拒绝，不做部分应用。
 * @type {readonly string[]}
 */
export const OP_KINDS = Object.freeze([
  'add_frame',
  'move_frame',
  'resize_frame',
  'rename_frame',
  'delete_frame',
  'switch_tokens',
  'set_viewport',
  'select',
]);

/**
 * 画布写通道暴露给客户端的三个逻辑方法（冻结）。
 * @type {readonly string[]}
 */
export const API_METHODS = Object.freeze(['readProject', 'writeFrame', 'applyCanvasOps']);

/**
 * 合法 frame id：只允许字母数字与 `._-`，杜绝路径穿越。
 * 客户端与模型都可能传 id，所以这里是硬校验。
 */
export const FRAME_ID_PATTERN = /^[A-Za-z0-9._-]{1,120}$/;

/**
 * @typedef {Object} Frame
 * @property {string} id
 * @property {string} name
 * @property {string} file 相对 `.design/` 的路径，形如 `frames/order-list.html`
 * @property {number} width
 * @property {number} height
 * @property {number} x
 * @property {number} y
 * @property {string} [background]
 * @property {'draft'|'ready'} status
 */

/**
 * @typedef {Object} DesignProject
 * @property {number} version
 * @property {{x: number, y: number, zoom: number}} viewport
 * @property {Record<string, string>} tokens 从 tokens.css 的 :root 解析出的只读镜像
 * @property {Frame[]} frames
 * @property {{frameId?: string, updatedAt?: string}} selection
 * @property {string} [updatedAt]
 * @property {'user'|'agent'|'plugin'} [updatedBy] 最后一次写入来源，便于追溯
 */

/**
 * @typedef {Object} DesignErrorShape
 * @property {boolean} ok 恒为 false
 * @property {{code: string, message: string, path?: string}} error
 */
