import { useCallback, useEffect, useRef, useState } from 'react';
import { createInitialState } from './data';
import { contentFingerprint } from './fingerprint';
import type { ChecklistItem, ChecklistProject, ChecklistRevision, FlightStage, ReviewSignoff, WorkspaceState } from './types';

const STORAGE_KEY = 'sologsb-1030-workspace-v1';
const clone = <T>(value: T): T => structuredClone(value);
const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const now = () => new Date().toISOString();

function loadState(): WorkspaceState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as WorkspaceState;
      if (parsed.schemaVersion === 1 && parsed.projects?.length) {
        // 兼容旧存档：补齐签认字段。历史冻结版本无签认数据，按历史留档处理。
        parsed.projects.forEach((project) => {
          if (!project.review) project.review = null;
          project.revisions.forEach((revision) => {
            if (!revision.review) revision.review = null;
          });
        });
        return parsed;
      }
    }
  } catch {
    // Corrupted local draft falls back to the bundled operational checklist.
  }
  return createInitialState();
}

function updateSelected(state: WorkspaceState, mutator: (project: ChecklistProject) => void): WorkspaceState {
  const next = clone(state);
  const project = next.projects.find((entry) => entry.id === next.selectedProjectId);
  if (project) {
    mutator(project);
    project.updatedAt = now();
  }
  return next;
}

export function useChecklistStore() {
  const [state, setState] = useState<WorkspaceState>(loadState);
  const past = useRef<WorkspaceState[]>([]);
  const future = useRef<WorkspaceState[]>([]);
  const [, forceHistoryState] = useState(0);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const commit = useCallback((mutator: (project: ChecklistProject) => void) => {
    setState((current) => {
      past.current = [...past.current.slice(-39), clone(current)];
      future.current = [];
      forceHistoryState((value) => value + 1);
      return updateSelected(current, (project) => {
        if (project.status !== 'draft') return;
        mutator(project);
      });
    });
  }, []);

  const directUpdate = useCallback((mutator: (project: ChecklistProject) => void) => {
    setState((current) => {
      past.current = [...past.current.slice(-39), clone(current)];
      future.current = [];
      forceHistoryState((value) => value + 1);
      return updateSelected(current, mutator);
    });
  }, []);

  const selectedProject = state.projects.find((project) => project.id === state.selectedProjectId) ?? state.projects[0];

  const selectProject = useCallback((id: string) => {
    setState((current) => ({ ...current, selectedProjectId: id }));
  }, []);

  const addProject = useCallback(() => {
    const id = uid('project');
    setState((current) => {
      past.current = [...past.current.slice(-39), clone(current)];
      future.current = [];
      const next = clone(current);
      next.projects.push({
        id,
        name: 'Untitled checklist',
        aircraft: '新机型',
        revision: 1,
        status: 'draft',
        updatedAt: now(),
        reviewNote: '',
        review: null,
        stages: [{ id: uid('stage'), name: '飞行前检查', order: 0, description: '说明本阶段目标。' }],
        items: [],
        revisions: []
      });
      next.selectedProjectId = id;
      return next;
    });
  }, []);

  const updateProject = useCallback((patch: Partial<ChecklistProject>) => {
    commit((project) => {
      Object.assign(project, patch);
    });
  }, [commit]);

  const addStage = useCallback(() => {
    commit((project) => {
      project.stages.push({ id: uid('stage'), name: '新飞行阶段', order: project.stages.length, description: '描述阶段目标和适用条件。' });
    });
  }, [commit]);

  const updateStage = useCallback((stageId: string, patch: Partial<FlightStage>) => {
    commit((project) => {
      const stage = project.stages.find((entry) => entry.id === stageId);
      if (stage) Object.assign(stage, patch);
    });
  }, [commit]);

  const moveStage = useCallback((stageId: string, direction: -1 | 1) => {
    commit((project) => {
      project.stages.sort((a, b) => a.order - b.order);
      const index = project.stages.findIndex((entry) => entry.id === stageId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= project.stages.length) return;
      [project.stages[index], project.stages[target]] = [project.stages[target], project.stages[index]];
      project.stages.forEach((entry, order) => { entry.order = order; });
    });
  }, [commit]);

  const deleteStage = useCallback((stageId: string) => {
    commit((project) => {
      if (project.items.some((item) => item.stageId === stageId)) return;
      project.stages = project.stages.filter((stage) => stage.id !== stageId).sort((a, b) => a.order - b.order);
      project.stages.forEach((stage, order) => { stage.order = order; });
    });
  }, [commit]);

  const addItem = useCallback((stageId: string, challenge = '', response = '') => {
    const id = uid('item');
    commit((project) => {
      const stage = project.stages.find((entry) => entry.id === stageId);
      if (!stage) return;
      const order = project.items.filter((item) => item.stageId === stageId).length;
      project.items.push({ id, stageId, order, challenge, response, critical: false, preconditionIds: [], abnormalProcedure: '', updatedAt: now() });
    });
    return id;
  }, [commit]);

  const updateItem = useCallback((itemId: string, patch: Partial<ChecklistItem>) => {
    commit((project) => {
      const item = project.items.find((entry) => entry.id === itemId);
      if (item) Object.assign(item, patch, { updatedAt: now() });
    });
  }, [commit]);

  const deleteItem = useCallback((itemId: string) => {
    commit((project) => {
      project.items = project.items.filter((item) => item.id !== itemId);
      project.items.forEach((item) => { item.preconditionIds = item.preconditionIds.filter((id) => id !== itemId); });
      project.stages.forEach((stage) => {
        project.items.filter((item) => item.stageId === stage.id).sort((a, b) => a.order - b.order).forEach((item, order) => { item.order = order; });
      });
    });
  }, [commit]);

  const reorderItem = useCallback((sourceId: string, targetId: string, before = true) => {
    commit((project) => {
      const source = project.items.find((item) => item.id === sourceId);
      const target = project.items.find((item) => item.id === targetId);
      if (!source || !target || source.id === target.id) return;
      source.stageId = target.stageId;
      const siblings = project.items.filter((item) => item.stageId === target.stageId && item.id !== source.id).sort((a, b) => a.order - b.order);
      const targetIndex = siblings.findIndex((item) => item.id === target.id);
      siblings.splice(Math.max(0, targetIndex + (before ? 0 : 1)), 0, source);
      siblings.forEach((item, order) => { item.order = order; });
    });
  }, [commit]);

  const nudgeItem = useCallback((itemId: string, direction: -1 | 1) => {
    commit((project) => {
      const item = project.items.find((entry) => entry.id === itemId);
      if (!item) return;
      const siblings = project.items.filter((entry) => entry.stageId === item.stageId).sort((a, b) => a.order - b.order);
      const index = siblings.findIndex((entry) => entry.id === itemId);
      const target = index + direction;
      if (target < 0 || target >= siblings.length) return;
      [siblings[index], siblings[target]] = [siblings[target], siblings[index]];
      siblings.forEach((entry, order) => { entry.order = order; });
    });
  }, [commit]);

  const submitForReview = useCallback((submitter: string) => {
    directUpdate((project) => {
      const fingerprint = contentFingerprint(project);
      project.status = 'review';
      project.reviewNote = '';
      project.review = {
        submittedBy: submitter.trim(),
        submittedAt: now(),
        fingerprint,
        reviewer: '',
        reviewedAt: '',
        comment: ''
      };
    });
  }, [directUpdate]);

  const rejectReview = useCallback(() => {
    directUpdate((project) => {
      // 退回后旧签认失效，回到编辑中；修改后需重新提交复核。
      project.status = 'draft';
      project.review = null;
      project.reviewNote = '';
    });
  }, [directUpdate]);

  /**
   * 复核通过并冻结。返回错误信息字符串表示被阻断，返回 null 表示成功。
   * 阻断规则：
   *  - 没有待复核的提交记录；
   *  - 内容指纹与提交时不一致（内容被改动）；
   *  - 复核人姓名为空；
   *  - 复核人与提交人为同一人；
   *  - 当前版本已冻结过（同一版本不允许重复冻结）。
   */
  const freezeRevision = useCallback((note: string, reviewer: string): string | null => {
    const project = state.projects.find((entry) => entry.id === state.selectedProjectId);
    if (!project) return '未找到当前检查单项目。';
    if (!project.review) return '没有待复核的提交记录，请先提交复核。';
    const fingerprint = contentFingerprint(project);
    if (fingerprint !== project.review.fingerprint) {
      return '内容指纹与提交时不一致，检查单已被修改，请退回后重新提交复核。';
    }
    const reviewerName = reviewer.trim();
    if (!reviewerName) return '请填写复核人姓名。';
    if (reviewerName === project.review.submittedBy) {
      return '复核人与提交人不能为同一人，请由另一位复核人冻结。';
    }
    if (project.revisions.some((revision) => revision.revision === project.revision)) {
      return '当前版本已冻结，不能重复冻结；如需修改请创建新修订。';
    }

    let blocked: string | null = null;
    directUpdate((target) => {
      if (!target.review || target.review.fingerprint !== fingerprint) {
        blocked = '复核状态已变化，请刷新后重试。';
        return;
      }
      const signoff: ReviewSignoff = {
        ...target.review,
        reviewer: reviewerName,
        reviewedAt: now(),
        comment: note.trim()
      };
      const snapshot: ChecklistRevision = {
        id: uid('revision'),
        revision: target.revision,
        status: 'frozen',
        createdAt: now(),
        note: note.trim() || '复核通过并冻结',
        stages: clone(target.stages),
        items: clone(target.items),
        review: signoff
      };
      target.revisions.unshift(snapshot);
      target.status = 'frozen';
      target.reviewNote = note.trim();
      target.review = signoff;
    });
    return blocked;
  }, [state, directUpdate]);

  const createRevision = useCallback(() => {
    directUpdate((project) => {
      project.revision += 1;
      project.status = 'draft';
      project.review = null;
      project.reviewNote = '';
      project.updatedAt = now();
    });
  }, [directUpdate]);

  const undo = useCallback(() => {
    setState((current) => {
      const previous = past.current.pop();
      if (!previous) return current;
      future.current = [clone(current), ...future.current].slice(0, 40);
      forceHistoryState((value) => value + 1);
      return previous;
    });
  }, []);

  const redo = useCallback(() => {
    setState((current) => {
      const next = future.current.shift();
      if (!next) return current;
      past.current = [...past.current.slice(-39), clone(current)];
      forceHistoryState((value) => value + 1);
      return next;
    });
  }, []);

  const saveNow = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    setState((current) => updateSelected(current, () => undefined));
  }, [state]);

  return {
    state,
    selectedProject,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    selectProject,
    addProject,
    updateProject,
    addStage,
    updateStage,
    moveStage,
    deleteStage,
    addItem,
    updateItem,
    deleteItem,
    reorderItem,
    nudgeItem,
    submitForReview,
    rejectReview,
    freezeRevision,
    createRevision,
    undo,
    redo,
    saveNow
  };
}
