import type { ChecklistItem, ChecklistProject, ChecklistRevision } from './types';

type FingerprintSource = Pick<ChecklistProject, 'revision' | 'stages' | 'items'> | Pick<ChecklistRevision, 'revision' | 'stages' | 'items'>;

export function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function canonicalContent(content: FingerprintSource): unknown {
  const stageOrder = new Map<string, number>();
  content.stages.forEach((stage) => stageOrder.set(stage.id, stage.order));

  return {
    revision: content.revision,
    stages: content.stages
      .slice()
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      .map((stage) => ({ id: stage.id, order: stage.order, name: stage.name, description: stage.description })),
    items: content.items
      .slice()
      .sort((a, b) => {
        const stageCompare = (stageOrder.get(a.stageId) ?? -1) - (stageOrder.get(b.stageId) ?? -1);
        return stageCompare || a.order - b.order || a.id.localeCompare(b.id);
      })
      .map((item: ChecklistItem) => ({
        id: item.id,
        stageId: item.stageId,
        stageOrder: stageOrder.get(item.stageId) ?? -1,
        order: item.order,
        challenge: item.challenge,
        response: item.response,
        critical: item.critical,
        preconditionIds: item.preconditionIds.slice().sort(),
        abnormalProcedure: item.abnormalProcedure
      }))
  };
}

export function contentFingerprint(content: FingerprintSource): string {
  const json = JSON.stringify(canonicalContent(content));
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < json.length; index += 1) {
    const char = json.charCodeAt(index);
    h1 = Math.imul(h1 ^ char, 2654435761);
    h2 = Math.imul(h2 ^ char, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

export function formatDateTime(value?: string): string {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
}

export function shortFingerprint(value?: string): string {
  return value ? value.slice(0, 8).toUpperCase() : '—';
}
