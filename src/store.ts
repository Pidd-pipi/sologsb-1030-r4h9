import { useCallback, useEffect, useRef, useState } from 'react';
import { contentFingerprint, normalizeName } from './approval';
import { createInitialState } from './data';
import type { ChecklistItem, ChecklistProject, ChecklistRevision, FlightStage, WorkspaceState } from './types';

export interface WorkflowResult {
  ok: boolean;
  message?: string;
}

const STORAGE_KEY = 'sologsb-1030-workspace-v1';
const clone = <T>(value: T): T => structuredClone(value);
const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const now = () => new Date().toISOString();

function normalizeProject(project: ChecklistProject): ChecklistProject {
  project.approval ??= null;
  project.lastReturn ??= null;
  project.reviewNote ??= '';
  if (project.status !== 'draft' && project.status !== 'review' && project.status !== 'frozen') {
    project.status = 'draft';
  }
  project.revisions.forEach((revision) => {
    revision.approval ??= null;
    if (revision.status !== 'frozen') revision.status = 'frozen';
  });
  if (project.status === 'review' && !project.approval) {
    project.status = 'draft';
  }
  return project;
}

function loadState(): WorkspaceState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as WorkspaceState;
      if (parsed.schemaVersion === 1 && parsed.projects?.length) {
        parsed.projects.forEach(normalizeProject);
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
  const stateRef = useRef(state);
  stateRef.current = state;
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

  const selectProjectRef = useRef(state.selectedProjectId);
  selectProjectRef.current = state.selectedProjectId;

  const workflowUpdate = useCallback((mutator: (project: ChecklistProject) => WorkflowResult): WorkflowResult => {
    const draft = clone(stateRef.current);
    const project = draft.projects.find((entry) => entry.id === selectProjectRef.current);
    if (!project) return { ok: false, message: '未找到检查单项目。' };
    const result = mutator(project);
    if (!result.ok) return result;
    project.updatedAt = now();
    past.current = [];
    future.current = [];
    forceHistoryState((value) => value + 1);
    stateRef.current = draft;
    setState(draft);
    return result;
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
        approval: null,
        lastReturn: null,
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

  const submitForReview = useCallback((submitterName: string, hasBlockingErrors: boolean): WorkflowResult => {
    const submitter = normalizeName(submitterName);
    return workflowUpdate((project) => {
      if (project.status !== 'draft') return { ok: false, message: '只有编辑中的版本可以提交复核。' };
      if (!submitter) return { ok: false, message: '请填写提交人姓名。' };
      if (hasBlockingErrors) return { ok: false, message: '仍存在阻断错误，不能提交复核。' };
      const fingerprint = contentFingerprint(project);
      if (project.lastReturn && project.lastReturn.fingerprint === fingerprint) {
        return { ok: false, message: '退回后的内容尚未修改，请完成修订后再提交。' };
      }
      project.status = 'review';
      project.reviewNote = '';
      project.approval = {
        submitterName: submitter,
        submittedAt: now(),
        submittedFingerprint: fingerprint
      };
      return { ok: true };
    });
  }, [workflowUpdate]);

  const returnForRevision = useCallback((reason: string): WorkflowResult => workflowUpdate((project) => {
    if (project.status !== 'review' || !project.approval) return { ok: false, message: '只有已提交复核的版本可以退回。' };
    const normalizedReason = reason.trim();
    if (!normalizedReason) return { ok: false, message: '请填写退回原因。' };
    const fingerprint = contentFingerprint(project);
    project.status = 'draft';
    project.reviewNote = normalizedReason;
    project.lastReturn = { reason: normalizedReason, fingerprint, returnedAt: now() };
    project.approval = null;
    return { ok: true };
  }), [workflowUpdate]);

  const freezeRevision = useCallback((reviewerName: string, note: string): WorkflowResult => workflowUpdate((project) => {
    const reviewer = normalizeName(reviewerName);
    if (project.status !== 'review') return { ok: false, message: '只有复核中的版本可以冻结。' };
    if (project.revisions.some((revision) => revision.revision === project.revision)) {
      return { ok: false, message: `r${project.revision} 已经冻结，同一版本不能重复冻结。` };
    }
    const approval = project.approval;
    if (!approval) return { ok: false, message: '缺少提交签认记录，不能冻结。' };
    if (!reviewer) return { ok: false, message: '请填写复核人姓名。' };
    if (normalizeName(approval.submitterName) === reviewer) {
      return { ok: false, message: '复核人不能与提交人为同一人。' };
    }
    const fingerprint = contentFingerprint(project);
    if (fingerprint !== approval.submittedFingerprint) {
      return { ok: false, message: '提交后内容指纹已变化，旧签认失效，请退回修改后重新提交。' };
    }

    const frozenApproval = {
      ...approval,
      reviewerName: reviewer,
      reviewedAt: now(),
      reviewedFingerprint: fingerprint
    };
    const frozenNote = note.trim() || '复核通过并冻结';
    const snapshot: ChecklistRevision = {
      id: uid('revision'),
      revision: project.revision,
      status: 'frozen',
      createdAt: now(),
      note: frozenNote,
      approval: frozenApproval,
      stages: clone(project.stages),
      items: clone(project.items)
    };
    project.revisions.unshift(snapshot);
    project.status = 'frozen';
    project.reviewNote = frozenNote;
    project.approval = frozenApproval;
    project.lastReturn = null;
    return { ok: true };
  }), [workflowUpdate]);

  const createRevision = useCallback((): WorkflowResult => workflowUpdate((project) => {
    if (project.status !== 'frozen') return { ok: false, message: '只有已冻结版本可以创建新修订。' };
    project.revision += 1;
    project.status = 'draft';
    project.reviewNote = '';
    project.approval = null;
    project.lastReturn = null;
    project.updatedAt = now();
    return { ok: true };
  }), [workflowUpdate]);

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
    returnForRevision,
    freezeRevision,
    createRevision,
    undo,
    redo,
    saveNow
  };
}
