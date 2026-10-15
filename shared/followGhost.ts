import { diffChars, diffLines, type Change } from 'diff';

export interface GhostEdit { start: number; end: number; text: string }

/** 只取最前面的一组增删，保留后续已存在的代码和自动闭合括号。 */
function firstEdit(changes: Change[]): GhostEdit | undefined {
  let offset = 0;
  let edit: GhostEdit | undefined;
  for (const change of changes) {
    if (!change.added && !change.removed) {
      if (edit) break;
      offset += change.value.length;
    } else {
      edit ||= { start: offset, end: offset, text: '' };
      if (change.removed) edit.end += change.value.length;
      else edit.text += change.value;
    }
  }
  return edit;
}

/** 差异计算超时后用线性首尾匹配降级，避免复杂文件阻塞扩展宿主。 */
function trimEdit(current: string, target: string): GhostEdit | undefined {
  let start = 0;
  while (start < current.length && start < target.length && current.codePointAt(start) === target.codePointAt(start)) {
    start += current.codePointAt(start)! > 0xffff ? 2 : 1;
  }
  if (start === current.length && start === target.length) return;
  let suffix = 0;
  while (suffix < current.length - start && suffix < target.length - start &&
    current[current.length - suffix - 1] === target[target.length - suffix - 1]) suffix++;
  // 不把 UTF-16 代理对拆成半个字符，偏移始终可以交给原生文档定位。
  const boundary = current.charCodeAt(current.length - suffix);
  if (boundary >= 0xdc00 && boundary <= 0xdfff) suffix--;
  return { start, end: current.length - suffix, text: target.slice(start, target.length - suffix) };
}

/** 先按行定位再按字符细化，返回当前真实文本距目标最近的一处待跟写内容。 */
export function nextGhostEdit(current: string, target: string): GhostEdit | undefined {
  if (current === target) return;
  const lines = diffLines(current, target, { timeout: 25 });
  if (!lines) return trimEdit(current, target);
  const block = firstEdit(lines);
  if (!block) return;
  const before = current.slice(block.start, block.end);
  const chars = diffChars(before, block.text, { timeout: 20 });
  const edit = chars ? firstEdit(chars) : trimEdit(before, block.text);
  return edit && { start: block.start + edit.start, end: block.start + edit.end, text: edit.text };
}
