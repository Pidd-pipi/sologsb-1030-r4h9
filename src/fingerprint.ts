import type { ChecklistProject } from './types';

/**
 * 计算检查单内容指纹。
 * 仅纳入阶段与检查项的实质内容（名称、顺序、挑战语、预期回应、关键标记、前置条件、异常处置），
 * 不含 updatedAt 等易变字段，保证同一份内容得到稳定指纹。
 * 使用 FNV-1a 32 位哈希，输出形如 fp-xxxxxxxx。
 */
export function contentFingerprint(project: ChecklistProject): string {
  const stages = project.stages
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((stage) => ({ id: stage.id, name: stage.name, order: stage.order, description: stage.description }));
  const items = project.items
    .slice()
    .sort((a, b) => (a.stageId === b.stageId ? a.order - b.order : a.stageId.localeCompare(b.stageId)))
    .map((item) => ({
      stageId: item.stageId,
      order: item.order,
      challenge: item.challenge,
      response: item.response,
      critical: item.critical,
      preconditionIds: item.preconditionIds.slice().sort(),
      abnormalProcedure: item.abnormalProcedure
    }));
  const payload = JSON.stringify({ stages, items });
  let hash = 0x811c9dc5;
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fp-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
