/**
 * history.js —— 撤销 / 重做
 *
 * 存的是整份项目快照（尺寸 + 各面板元素）的 JSON 字符串。
 * 同一个操作连续触发（拖方向键、连续输入）用 coalesceKey 合并成一步。
 */

export class History {
  constructor(limit = 60) {
    this.limit = limit;
    this.stack = [];
    this.index = -1;
    this.lastKey = '';
    this.lastAt = 0;
  }

  reset(snapshot) {
    this.stack = [snapshot];
    this.index = 0;
    this.lastKey = '';
    this.lastAt = 0;
  }

  push(snapshot, { coalesceKey = '' } = {}) {
    if (!this.stack.length) {
      this.reset(snapshot);
      return true;
    }
    if (snapshot === this.stack[this.index]) return false;

    const now = Date.now();
    if (
      coalesceKey &&
      coalesceKey === this.lastKey &&
      now - this.lastAt < 700 &&
      this.index === this.stack.length - 1
    ) {
      this.stack[this.index] = snapshot;
      this.lastAt = now;
      return true;
    }

    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(snapshot);
    if (this.stack.length > this.limit) this.stack.shift();
    this.index = this.stack.length - 1;
    this.lastKey = coalesceKey;
    this.lastAt = now;
    return true;
  }

  canUndo() {
    return this.index > 0;
  }

  canRedo() {
    return this.index >= 0 && this.index < this.stack.length - 1;
  }

  undo() {
    if (!this.canUndo()) return null;
    this.index -= 1;
    this.lastKey = '';
    return this.stack[this.index];
  }

  redo() {
    if (!this.canRedo()) return null;
    this.index += 1;
    this.lastKey = '';
    return this.stack[this.index];
  }

  get depth() {
    return this.stack.length;
  }
}
