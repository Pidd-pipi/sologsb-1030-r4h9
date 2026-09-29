import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Callout,
  Card,
  Dialog,
  Flex,
  Grid,
  Heading,
  IconButton,
  Progress,
  ScrollArea,
  Select,
  Separator,
  Switch,
  Tabs,
  Text,
  TextArea,
  TextField,
  Theme,
  Tooltip
} from '@radix-ui/themes';
import { buildVersionOptions, diffVersions } from './diff';
import { contentFingerprint, formatDateTime, normalizeName, shortFingerprint } from './approval';
import { useChecklistStore } from './store';
import type { ChecklistItem, ChecklistProject, IssueLevel, ReviewApproval, ValidationIssue, WorkflowStatus } from './types';
import { validateProject } from './validation';

const statusMeta: Record<WorkflowStatus, { label: string; color: 'gray' | 'amber' | 'green'; description: string }> = {
  draft: { label: '编辑中', color: 'gray', description: '内容可修改，完成校验后提交复核。' },
  review: { label: '复核中', color: 'amber', description: '内容已锁定，须由另一位复核人核对指纹后冻结。' },
  frozen: { label: '已冻结', color: 'green', description: '只读发布版本；需要修改时创建新修订。' }
};

const issueMeta: Record<IssueLevel, { color: 'red' | 'amber' | 'blue'; label: string }> = {
  error: { color: 'red', label: '阻断' },
  warning: { color: 'amber', label: '警告' },
  info: { color: 'blue', label: '提示' }
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character);
}

function App() {
  const store = useChecklistStore();
  const project = store.selectedProject;
  const [appearance, setAppearance] = useState<'light' | 'dark'>(() => (localStorage.getItem('sologsb-1030-theme') === 'dark' ? 'dark' : 'light'));
  const [search, setSearch] = useState('');
  const [selectedItemId, setSelectedItemId] = useState(project.items[0]?.id ?? '');
  const [quickStageId, setQuickStageId] = useState(project.stages[0]?.id ?? '');
  const [newChallenge, setNewChallenge] = useState('');
  const [newResponse, setNewResponse] = useState('');
  const [activeTab, setActiveTab] = useState('editor');
  const [showHelp, setShowHelp] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitterName, setSubmitterName] = useState('');
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [freezeOpen, setFreezeOpen] = useState(false);
  const [reviewerName, setReviewerName] = useState('');
  const [freezeNote, setFreezeNote] = useState('');
  const [workflowError, setWorkflowError] = useState('');
  const [leftVersion, setLeftVersion] = useState('current');
  const [rightVersion, setRightVersion] = useState(project.revisions[0]?.id ?? '');
  const [savePulse, setSavePulse] = useState(false);
  const challengeRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const issues = useMemo(() => validateProject(project), [project]);
  const errors = issues.filter((issue) => issue.level === 'error').length;
  const warnings = issues.filter((issue) => issue.level === 'warning').length;
  const currentFingerprint = useMemo(() => contentFingerprint(project), [project]);
  const approval = project.approval;
  const normalizedReviewerName = normalizeName(reviewerName);
  const fingerprintChanged = project.status === 'review' && !!approval && approval.submittedFingerprint !== currentFingerprint;
  const sameReviewerName = project.status === 'review' && !!approval && normalizeName(approval.submitterName) === normalizedReviewerName;
  const unchangedAfterReturn = project.status === 'draft' && !!project.lastReturn && project.lastReturn.fingerprint === currentFingerprint;
  const freezeBlocked = errors > 0 || !approval || fingerprintChanged || sameReviewerName || !normalizedReviewerName;
  const selectedItem = project.items.find((item) => item.id === selectedItemId);
  const versionOptions = useMemo(() => buildVersionOptions(project), [project]);
  const diffEntries = useMemo(() => diffVersions(project, leftVersion, rightVersion), [project, leftVersion, rightVersion]);
  const filteredStages = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('zh-CN');
    return project.stages
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((stage) => ({
        stage,
        items: project.items
          .filter((item) => item.stageId === stage.id)
          .filter((item) => !query || [stage.name, stage.description, item.challenge, item.response, item.abnormalProcedure].some((value) => value.toLocaleLowerCase('zh-CN').includes(query)))
          .sort((a, b) => a.order - b.order)
      }))
      .filter((group) => !query || group.items.length > 0 || group.stage.name.toLocaleLowerCase('zh-CN').includes(query));
  }, [project, search]);

  useEffect(() => {
    if (!project.items.some((item) => item.id === selectedItemId)) setSelectedItemId(project.items[0]?.id ?? '');
    if (!project.stages.some((stage) => stage.id === quickStageId)) setQuickStageId(project.stages[0]?.id ?? '');
    if (!versionOptions.some((option) => option.id === leftVersion)) setLeftVersion('current');
    if (!versionOptions.some((option) => option.id === rightVersion)) setRightVersion(versionOptions[1]?.id ?? '');
  }, [project.id, project.items, project.stages, project.revision, selectedItemId, quickStageId, versionOptions, leftVersion, rightVersion]);

  useEffect(() => {
    setWorkflowError('');
  }, [project.id, project.revision, project.status]);

  useEffect(() => {
    localStorage.setItem('sologsb-1030-theme', appearance);
  }, [appearance]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      const target = event.target as HTMLElement | null;
      const typing = target?.matches('input, textarea, [contenteditable="true"]') ?? false;
      if (modifier && event.key.toLocaleLowerCase() === 'z') {
        event.preventDefault();
        event.shiftKey ? store.redo() : store.undo();
        return;
      }
      if (modifier && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (modifier && event.key.toLocaleLowerCase() === 's') {
        event.preventDefault();
        store.saveNow();
        setSavePulse(true);
        window.setTimeout(() => setSavePulse(false), 1200);
        return;
      }
      if (modifier && event.key === 'Enter') {
        event.preventDefault();
        quickAddItem();
        return;
      }
      if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key) && selectedItemId) {
        event.preventDefault();
        store.nudgeItem(selectedItemId, event.key === 'ArrowUp' ? -1 : 1);
        return;
      }
      if (event.key === '/' && !typing) {
        event.preventDefault();
        challengeRef.current?.focus();
        return;
      }
      if (event.key === '?' && !typing) {
        event.preventDefault();
        setShowHelp(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  function quickAddItem() {
    if (!quickStageId || !newChallenge.trim()) return;
    const id = store.addItem(quickStageId, newChallenge.trim(), newResponse.trim());
    setSelectedItemId(id);
    setNewChallenge('');
    setNewResponse('');
    challengeRef.current?.focus();
  }

  function handleSubmitForReview() {
    const result = store.submitForReview(submitterName, errors > 0);
    setWorkflowError(result.ok ? '' : result.message ?? '提交复核失败。');
    if (result.ok) {
      setSubmitOpen(false);
      setSubmitterName('');
    }
  }

  function handleReturn() {
    const result = store.returnForRevision(returnReason);
    setWorkflowError(result.ok ? '' : result.message ?? '退回失败。');
    if (result.ok) {
      setReturnOpen(false);
      setReturnReason('');
    }
  }

  function handleFreeze() {
    const result = store.freezeRevision(reviewerName, freezeNote);
    setWorkflowError(result.ok ? '' : result.message ?? '冻结失败。');
    if (result.ok) {
      setFreezeOpen(false);
      setReviewerName('');
      setFreezeNote('');
    }
  }

  function handleCreateRevision() {
    const result = store.createRevision();
    setWorkflowError(result.ok ? '' : result.message ?? '创建修订失败。');
  }

  function selectIssue(issue: ValidationIssue) {
    if (issue.itemId) setSelectedItemId(issue.itemId);
    setActiveTab('editor');
    if (issue.stageId) setQuickStageId(issue.stageId);
  }

  function exportPrintableHtml() {
    const stageOrder = project.stages.slice().sort((a, b) => a.order - b.order);
    const body = stageOrder.map((stage) => {
      const rows = project.items.filter((item) => item.stageId === stage.id).sort((a, b) => a.order - b.order).map((item) => `
        <tr><td>${item.critical ? '<strong>◆</strong> ' : ''}${escapeHtml(item.challenge)}</td><td>${escapeHtml(item.response || '未填写')}</td><td>${escapeHtml(item.abnormalProcedure || '—')}</td></tr>
      `).join('');
      return `<section><h2>${escapeHtml(stage.name)}</h2><p>${escapeHtml(stage.description)}</p><table><thead><tr><th>挑战语</th><th>预期回应</th><th>异常处置</th></tr></thead><tbody>${rows || '<tr><td colspan="3">本阶段暂无项目</td></tr>'}</tbody></table></section>`;
    }).join('');
    const signatureHtml = project.status === 'frozen'
      ? (project.approval
        ? `<section class="signatures"><h2>签认留痕</h2><p>提交人：${escapeHtml(project.approval.submitterName)} · ${formatDateTime(project.approval.submittedAt)} · 指纹 ${shortFingerprint(project.approval.submittedFingerprint)}</p><p>复核人：${escapeHtml(project.approval.reviewerName ?? '—')} · ${formatDateTime(project.approval.reviewedAt)} · 指纹 ${shortFingerprint(project.approval.reviewedFingerprint)}</p></section>`
        : '<section class="signatures"><h2>历史留档</h2><p>该冻结版本形成于新签认流程启用前，无提交/复核签认数据，仅供查阅与比较。</p></section>')
      : '';
    const documentHtml = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(project.name)}</title><style>
      body{font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111;margin:36px}
      h1{margin:0 0 4px} .meta{color:#666;margin-bottom:28px} h2{border-bottom:2px solid #222;padding-bottom:5px;margin-top:26px}
      table{width:100%;border-collapse:collapse} th,td{border:1px solid #bbb;padding:7px;text-align:left;vertical-align:top} th{background:#eee}
      .signatures p{margin:6px 0}
      @media print{body{margin:15mm}section{break-inside:avoid}}
    </style></head><body><h1>${escapeHtml(project.name)}</h1><div class="meta">${escapeHtml(project.aircraft)} · r${project.revision} · ${escapeHtml(statusMeta[project.status].label)} · 导出 ${new Date().toLocaleString('zh-CN')}</div>${body}${signatureHtml}</body></html>`;
    const url = URL.createObjectURL(new Blob([documentHtml], { type: 'text/html;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${project.name.replace(/[^\p{L}\p{N}-]+/gu, '-')}-r${project.revision}.html`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function togglePrecondition(item: ChecklistItem, preconditionId: string) {
    const ids = new Set(item.preconditionIds);
    ids.has(preconditionId) ? ids.delete(preconditionId) : ids.add(preconditionId);
    store.updateItem(item.id, { preconditionIds: [...ids] });
  }

  function duplicateItem(item: ChecklistItem) {
    const id = store.addItem(item.stageId, `${item.challenge} - COPY`, item.response);
    window.setTimeout(() => {
      store.updateItem(id, {
        critical: item.critical,
        preconditionIds: [...item.preconditionIds],
        abnormalProcedure: item.abnormalProcedure
      });
      setSelectedItemId(id);
    }, 0);
  }

  return (
    <Theme appearance={appearance} accentColor="blue" grayColor="slate" radius="large" scaling="100%">
      <div className="app-frame">
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark">FL</div>
            <div><Heading size="5">Flightline</Heading><Text size="1" color="gray">飞行检查单编写与校验</Text></div>
          </div>
          <div className="project-switcher">
            <Select.Root value={project.id} onValueChange={store.selectProject}>
              <Select.Trigger aria-label="选择检查单项目" variant="soft" />
              <Select.Content position="popper">
                {store.state.projects.map((entry) => <Select.Item key={entry.id} value={entry.id}>{entry.name}</Select.Item>)}
              </Select.Content>
            </Select.Root>
            <Button variant="soft" onClick={store.addProject}>新建项目</Button>
          </div>
          <div className="top-actions">
            <TextField.Root ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索检查项 / Ctrl+K" style={{ minWidth: 220 }}>
              <TextField.Slot>⌕</TextField.Slot>
            </TextField.Root>
            <Tooltip content="撤销 Ctrl/⌘+Z"><Button variant="soft" disabled={!store.canUndo} onClick={store.undo}>撤销</Button></Tooltip>
            <Tooltip content="重做 Shift+Ctrl/⌘+Z"><Button variant="soft" disabled={!store.canRedo} onClick={store.redo}>重做</Button></Tooltip>
            <Tooltip content="手动保存 Ctrl/⌘+S"><Button variant="soft" onClick={() => { store.saveNow(); setSavePulse(true); window.setTimeout(() => setSavePulse(false), 1200); }}>{savePulse ? '已保存' : '保存'}</Button></Tooltip>
            <Tooltip content="切换外观"><IconButton variant="soft" aria-label="切换明暗主题" onClick={() => setAppearance(appearance === 'light' ? 'dark' : 'light')}>{appearance === 'light' ? '◐' : '☀'}</IconButton></Tooltip>
            <Tooltip content="键盘帮助"><IconButton variant="soft" aria-label="键盘帮助" onClick={() => setShowHelp(true)}>?</IconButton></Tooltip>
          </div>
        </header>

        <div className="workflow-bar">
          <div className="workflow-steps">
            {(['draft', 'review', 'frozen'] as WorkflowStatus[]).map((status, index) => (
              <div key={status} className={`workflow-step ${project.status === status ? 'active' : ''} ${status === 'draft' || project.revision > 1 ? 'done' : ''}`}>
                <span>{index + 1}</span><div><strong>{statusMeta[status].label}</strong><small>{statusMeta[status].description}</small></div>
              </div>
            ))}
          </div>
          <Flex gap="2" align="center" wrap="wrap">
            <Badge color={statusMeta[project.status].color} size="2">r{project.revision} · {statusMeta[project.status].label}{project.status === 'frozen' && !project.approval ? ' · 历史留档' : ''}</Badge>
            <Text size="1" color="gray">{errors ? `${errors} 个阻断` : '无阻断问题'} · {warnings} 个警告</Text>
            {workflowError && <Badge color="red" size="2">{workflowError}</Badge>}
            {project.status === 'draft' && <Button color="amber" onClick={() => { setWorkflowError(''); setSubmitOpen(true); }} disabled={errors > 0 || unchangedAfterReturn}>提交复核</Button>}
            {project.status === 'review' && <Button color="red" variant="soft" onClick={() => { setWorkflowError(''); setReturnOpen(true); }}>退回修改</Button>}
            {project.status === 'review' && <Button color="green" onClick={() => { setWorkflowError(''); setFreezeOpen(true); }} disabled={errors > 0 || fingerprintChanged}>复核通过并冻结</Button>}
            {project.status === 'frozen' && <Button onClick={handleCreateRevision}>创建修订 r{project.revision + 1}</Button>}
            <Button variant="soft" onClick={() => setShowPreview(true)}>只读预览</Button>
            <Button variant="soft" onClick={() => window.print()}>打印</Button>
            <Button variant="soft" onClick={exportPrintableHtml}>导出打印版</Button>
          </Flex>
        </div>

        <main className="workspace">
          <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
            <Tabs.List className="main-tabs">
              <Tabs.Trigger value="editor">编辑清单</Tabs.Trigger>
              <Tabs.Trigger value="versions">版本差异 <Badge size="1" variant="soft">{project.revisions.length}</Badge></Tabs.Trigger>
              <Tabs.Trigger value="print">打印预览</Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="editor">
              <div className="editor-grid">
                <aside className="stage-sidebar">
                  <Flex justify="between" align="center" mb="3">
                    <Heading size="3">飞行阶段</Heading>
                    <Button size="1" variant="soft" disabled={project.status !== 'draft'} onClick={store.addStage}>＋阶段</Button>
                  </Flex>
                  <ScrollArea type="auto" scrollbars="vertical" style={{ height: 'calc(100vh - 250px)' }}>
                    <div className="stage-nav">
                      {project.stages.slice().sort((a, b) => a.order - b.order).map((stage, index) => {
                        const count = project.items.filter((item) => item.stageId === stage.id).length;
                        const issueCount = issues.filter((issue) => issue.stageId === stage.id).length;
                        return (
                          <button key={stage.id} className={`stage-nav-item ${quickStageId === stage.id ? 'active' : ''}`} onClick={() => setQuickStageId(stage.id)}>
                            <span className="stage-index">{String(index + 1).padStart(2, '0')}</span>
                            <span><strong>{stage.name}</strong><small>{count} 项{issueCount ? ` · ${issueCount} 个问题` : ''}</small></span>
                          </button>
                        );
                      })}
                    </div>
                  </ScrollArea>
                  <Card className="project-card">
                    <Text size="1" color="gray">项目资料</Text>
                    <label><span>检查单名称</span><TextField.Root value={project.name} disabled={project.status !== 'draft'} onChange={(event) => store.updateProject({ name: event.target.value })} /></label>
                    <label><span>机型 / 注册号</span><TextField.Root value={project.aircraft} disabled={project.status !== 'draft'} onChange={(event) => store.updateProject({ aircraft: event.target.value })} /></label>
                  </Card>
                </aside>

                <section className="checklist-main">
                  <div className="list-heading">
                    <div><Heading size="6">{project.name}</Heading><Text color="gray">{project.aircraft} · {project.items.length} 个检查项 · {project.stages.length} 个阶段</Text></div>
                    <Badge color={project.status === 'draft' ? 'gray' : project.status === 'review' ? 'amber' : 'green'}>{statusMeta[project.status].label}{project.status === 'frozen' && !project.approval ? ' · 历史留档' : ''}</Badge>
                  </div>
                  {project.status !== 'draft' && <Callout.Root color={project.status === 'review' ? 'amber' : 'green'} mb="4"><Callout.Text>{statusMeta[project.status].description} 当前内容不能直接编辑。</Callout.Text></Callout.Root>}
                  <SignaturePanel project={project} currentFingerprint={currentFingerprint} fingerprintChanged={fingerprintChanged} />

                  <div className="quick-entry">
                    <Select.Root value={quickStageId || undefined} onValueChange={setQuickStageId} disabled={project.status !== 'draft'}>
                      <Select.Trigger variant="soft" aria-label="新检查项所属阶段" />
                      <Select.Content position="popper">{project.stages.map((stage) => <Select.Item key={stage.id} value={stage.id}>{stage.name}</Select.Item>)}</Select.Content>
                    </Select.Root>
                    <TextField.Root ref={challengeRef} value={newChallenge} disabled={project.status !== 'draft'} placeholder="挑战语，如 起飞构型（按 / 聚焦）" onChange={(event) => setNewChallenge(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) quickAddItem(); }} />
                    <TextField.Root value={newResponse} disabled={project.status !== 'draft'} placeholder="预期回应" onChange={(event) => setNewResponse(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) quickAddItem(); }} />
                    <Button disabled={project.status !== 'draft' || !newChallenge.trim()} onClick={quickAddItem}>新增</Button>
                    <Text size="1" color="gray">Ctrl/⌘+Enter</Text>
                  </div>

                  <div className="stage-list">
                    {filteredStages.map(({ stage, items }, stageIndex) => (
                      <Card key={stage.id} className="stage-card">
                        <div className="stage-card-head">
                          <div className="drag-handle" title="阶段排序">⋮⋮</div>
                          <div className="stage-title">
                            <span className="sequence-chip">{stageIndex + 1}</span>
                            <input aria-label={`${stage.name} 阶段名称`} value={stage.name} disabled={project.status !== 'draft'} onChange={(event) => store.updateStage(stage.id, { name: event.target.value })} />
                            <TextField.Root value={stage.description} disabled={project.status !== 'draft'} onChange={(event) => store.updateStage(stage.id, { description: event.target.value })} />
                          </div>
                          <Flex gap="1">
                            <Button size="1" variant="soft" disabled={project.status !== 'draft' || stage.order === 0} onClick={() => store.moveStage(stage.id, -1)}>上移</Button>
                            <Button size="1" variant="soft" disabled={project.status !== 'draft' || stage.order === project.stages.length - 1} onClick={() => store.moveStage(stage.id, 1)}>下移</Button>
                            <Button size="1" color="red" variant="soft" disabled={project.status !== 'draft' || items.length > 0} onClick={() => store.deleteStage(stage.id)}>删除</Button>
                          </Flex>
                        </div>
                        <div className="item-table">
                          {items.map((item) => {
                            const itemIssues = issues.filter((issue) => issue.itemId === item.id);
                            return (
                              <article
                                key={item.id}
                                className={`checklist-row ${selectedItemId === item.id ? 'selected' : ''}`}
                                draggable={project.status === 'draft'}
                                onDragStart={(event) => event.dataTransfer.setData('text/plain', item.id)}
                                onDragOver={(event) => { if (project.status === 'draft') event.preventDefault(); }}
                                onDrop={(event) => { event.preventDefault(); const source = event.dataTransfer.getData('text/plain'); if (source) store.reorderItem(source, item.id, true); }}
                                onClick={() => setSelectedItemId(item.id)}
                              >
                                <span className="drag-handle">⋮⋮</span>
                                <div className="check-item-copy">
                                  <Flex gap="2" align="center" wrap="wrap">
                                    <strong>{item.challenge || '未命名检查项'}</strong>
                                    {item.critical && <Badge color="red" size="1">关键</Badge>}
                                    {item.preconditionIds.length > 0 && <Badge color="blue" size="1">{item.preconditionIds.length} 前置</Badge>}
                                    {itemIssues.length > 0 && <Badge color={itemIssues.some((issue) => issue.level === 'error') ? 'red' : 'amber'} size="1">{itemIssues.length} 问题</Badge>}
                                  </Flex>
                                  <span className={`response-preview ${!item.response ? 'missing' : ''}`}>{item.response || '缺少预期回应'}</span>
                                  {item.abnormalProcedure && <small>异常：{item.abnormalProcedure}</small>}
                                </div>
                                <div className="row-actions">
                                  <Button size="1" variant="ghost" disabled={project.status !== 'draft'} onClick={(event) => { event.stopPropagation(); store.nudgeItem(item.id, -1); }}>↑</Button>
                                  <Button size="1" variant="ghost" disabled={project.status !== 'draft'} onClick={(event) => { event.stopPropagation(); store.nudgeItem(item.id, 1); }}>↓</Button>
                                  <Button size="1" variant="ghost" disabled={project.status !== 'draft'} onClick={(event) => { event.stopPropagation(); duplicateItem(item); }}>复制</Button>
                                  <Button size="1" color="red" variant="ghost" disabled={project.status !== 'draft'} onClick={(event) => { event.stopPropagation(); if (window.confirm(`删除“${item.challenge}”？`)) store.deleteItem(item.id); }}>删除</Button>
                                </div>
                              </article>
                            );
                          })}
                          {!items.length && <button className="empty-row" disabled={project.status !== 'draft'} onClick={() => { setQuickStageId(stage.id); challengeRef.current?.focus(); }}>＋ 为本阶段新增第一个检查项</button>}
                        </div>
                      </Card>
                    ))}
                  </div>
                </section>

                <aside className="inspector">
                  <ScrollArea type="auto" scrollbars="vertical" style={{ height: 'calc(100vh - 200px)' }}>
                    <div className="inspector-inner">
                      <section>
                        <Flex justify="between" align="center" mb="3"><Heading size="4">检查项详情</Heading>{selectedItem && <Badge variant="soft">#{selectedItem.order + 1}</Badge>}</Flex>
                        {selectedItem ? (
                          <div className="inspector-form">
                            <label><span>挑战语</span><TextField.Root value={selectedItem.challenge} disabled={project.status !== 'draft'} onChange={(event) => store.updateItem(selectedItem.id, { challenge: event.target.value })} /></label>
                            <label><span>预期回应</span><TextField.Root value={selectedItem.response} disabled={project.status !== 'draft'} onChange={(event) => store.updateItem(selectedItem.id, { response: event.target.value })} /></label>
                            <Flex justify="between" align="center"><Text size="2" weight="bold">关键标记</Text><Switch checked={selectedItem.critical} disabled={project.status !== 'draft'} onCheckedChange={(checked) => store.updateItem(selectedItem.id, { critical: checked })} /></Flex>
                            <label><span>异常处理</span><TextArea value={selectedItem.abnormalProcedure} disabled={project.status !== 'draft'} onChange={(event) => store.updateItem(selectedItem.id, { abnormalProcedure: event.target.value })} placeholder="异常条件、立即动作和后续步骤" /></label>
                            <div>
                              <Text size="2" weight="bold" mb="2" as="p">前置条件</Text>
                              <div className="precondition-list">
                                {project.items.filter((item) => item.id !== selectedItem.id).sort((a, b) => a.order - b.order).map((item) => (
                                  <label key={item.id} className="check-row">
                                    <input type="checkbox" checked={selectedItem.preconditionIds.includes(item.id)} disabled={project.status !== 'draft'} onChange={() => togglePrecondition(selectedItem, item.id)} />
                                    <span>{item.challenge || '未命名'}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                            <Text size="1" color="gray">Alt+↑/↓ 调整顺序 · 拖动左侧把手可跨阶段移动</Text>
                          </div>
                        ) : <Text color="gray">从清单中选择一个检查项进行编辑。</Text>}
                      </section>
                      <Separator size="4" />
                      <section>
                        <Flex justify="between" align="center" mb="2"><Heading size="4">发布校验</Heading><Badge color={errors ? 'red' : warnings ? 'amber' : 'green'}>{errors ? '未通过' : warnings ? '需确认' : '通过'}</Badge></Flex>
                        <Progress value={issues.length ? Math.max(8, 100 - errors * 22 - warnings * 8) : 100} color={errors ? 'red' : warnings ? 'amber' : 'green'} />
                        <div className="issue-list">
                          {issues.length ? issues.map((issue) => (
                            <button key={issue.id} className={`issue-card ${issue.level}`} onClick={() => selectIssue(issue)}>
                              <Badge color={issueMeta[issue.level].color} size="1">{issueMeta[issue.level].label}</Badge>
                              <span><strong>{issue.title}</strong><small>{issue.detail}</small></span>
                            </button>
                          )) : <Callout.Root color="green"><Callout.Text>当前检查单通过全部结构与顺序校验。</Callout.Text></Callout.Root>}
                        </div>
                      </section>
                      <Separator size="4" />
                      <section>
                        <Heading size="4" mb="3">键盘操作</Heading>
                        <div className="shortcut-grid">
                          <span><kbd>/</kbd> 聚焦快速录入</span>
                          <span><kbd>⌘/Ctrl+Enter</kbd> 新增检查项</span>
                          <span><kbd>Alt+↑/↓</kbd> 移动选中项</span>
                          <span><kbd>⌘/Ctrl+Z</kbd> 撤销编辑</span>
                        </div>
                      </section>
                    </div>
                  </ScrollArea>
                </aside>
              </div>
            </Tabs.Content>

            <Tabs.Content value="versions">
              <div className="content-page">
                <Heading size="7">版本差异</Heading>
                <Text color="gray" as="p">冻结版本不可修改；历史留档可继续比较但不能补签，创建新修订后才按新签认流程办理。</Text>
                <div className="revision-archive">
                  {project.revisions.map((revision) => (
                    <Card key={revision.id} className={`revision-card ${revision.approval ? '' : 'legacy'}`}>
                      <Flex justify="between" align="start" gap="3">
                        <div>
                          <Flex gap="2" align="center" mb="2"><Heading size="4">r{revision.revision}</Heading><Badge color={revision.approval ? 'green' : 'gray'}>{revision.approval ? '签认冻结' : '历史留档'}</Badge></Flex>
                          <Text size="2" as="p">{revision.note}</Text>
                          <Text size="1" color="gray" as="p">{formatDateTime(revision.createdAt)}</Text>
                          {revision.approval ? (
                            <div className="signature-lines">
                              <span>提交：{revision.approval.submitterName} · {shortFingerprint(revision.approval.submittedFingerprint)}</span>
                              <span>复核：{revision.approval.reviewerName} · {shortFingerprint(revision.approval.reviewedFingerprint)}</span>
                            </div>
                          ) : <Text size="1" color="amber" as="p">旧流程冻结，无签认数据；不支持补签。</Text>}
                        </div>
                        <Flex gap="1">
                          <Button size="1" variant="soft" onClick={() => { setLeftVersion('current'); setRightVersion(revision.id); }}>与当前比较</Button>
                        </Flex>
                      </Flex>
                    </Card>
                  ))}
                </div>
                <div className="version-controls">
                  <label><span>基准版本</span><Select.Root value={leftVersion} onValueChange={setLeftVersion}><Select.Trigger variant="soft" /><Select.Content position="popper">{versionOptions.map((option) => <Select.Item key={option.id} value={option.id}>{option.label}</Select.Item>)}</Select.Content></Select.Root></label>
                  <span className="version-arrow">→</span>
                  <label><span>比较版本</span><Select.Root value={rightVersion} onValueChange={setRightVersion}><Select.Trigger variant="soft" /><Select.Content position="popper">{versionOptions.map((option) => <Select.Item key={option.id} value={option.id}>{option.label}</Select.Item>)}</Select.Content></Select.Root></label>
                </div>
                <div className="diff-list">
                  {diffEntries.length ? diffEntries.map((entry) => (
                    <Card key={`${entry.type}-${entry.key}`} className="diff-card">
                      <Flex justify="between" align="center"><Badge color={entry.type === 'added' ? 'green' : entry.type === 'removed' ? 'red' : entry.type === 'stage' ? 'blue' : 'amber'}>{entry.type === 'added' ? '新增' : entry.type === 'removed' ? '删除' : entry.type === 'stage' ? '阶段' : '修改'}</Badge><Text size="1" color="gray">{entry.stage}</Text></Flex>
                      <Grid columns="2" gap="3" mt="3" className="diff-columns">
                        <div className="diff-before"><Text size="1" weight="bold">基准</Text><pre>{entry.before}</pre></div>
                        <div className="diff-after"><Text size="1" weight="bold">比较版本</Text><pre>{entry.after}</pre></div>
                      </Grid>
                    </Card>
                  )) : <div className="empty-page"><strong>两个版本没有差异</strong><span>选择不同版本后可查看新增、删除和修改的检查项。</span></div>}
                </div>
              </div>
            </Tabs.Content>

            <Tabs.Content value="print">
              <div className="content-page">
                <Flex justify="between" align="center" mb="4">
                  <div><Heading size="7">打印预览</Heading><Text color="gray" as="p">{project.name} · r{project.revision} · 只读排版</Text></div>
                  <Flex gap="2"><Button variant="soft" onClick={exportPrintableHtml}>导出 HTML</Button><Button onClick={() => window.print()}>打印 / PDF</Button></Flex>
                </Flex>
                <PrintableChecklist project={project} />
              </div>
            </Tabs.Content>
          </Tabs.Root>
        </main>
      </div>

      <Dialog.Root open={showPreview} onOpenChange={setShowPreview}>
        <Dialog.Content maxWidth="850px" className="preview-dialog">
          <Dialog.Title>只读检查单预览</Dialog.Title>
          <Dialog.Description size="2" color="gray">{project.name} · r{project.revision} · {statusMeta[project.status].label}{project.status === 'frozen' && !project.approval ? ' · 历史留档' : ''}</Dialog.Description>
          <div className="dialog-scroll"><PrintableChecklist project={project} compact /></div>
          <Flex gap="3" justify="end" mt="4"><Dialog.Close><Button variant="soft">关闭</Button></Dialog.Close><Button onClick={() => window.print()}>打印</Button></Flex>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root open={submitOpen} onOpenChange={(open) => { setSubmitOpen(open); if (!open) setWorkflowError(''); }}>
        <Dialog.Content maxWidth="520px">
          <Dialog.Title>提交 r{project.revision} 复核</Dialog.Title>
          <Dialog.Description size="2" color="gray">提交后内容将锁定，并记录提交人、提交时间和内容指纹。</Dialog.Description>
          <label className="dialog-field"><span>提交人姓名</span><TextField.Root value={submitterName} onChange={(event) => setSubmitterName(event.target.value)} placeholder="由编辑/提交人签署" autoFocus /></label>
          <Callout.Root mt="3" variant="soft"><Callout.Text size="1">当前内容指纹：<code>{currentFingerprint.slice(0, 12).toUpperCase()}</code>{errors > 0 ? ` · 仍有 ${errors} 个阻断错误` : ' · 结构校验无阻断'}</Callout.Text></Callout.Root>
          {workflowError && <Callout.Root color="red" mt="3"><Callout.Text size="2">{workflowError}</Callout.Text></Callout.Root>}
          <Flex gap="3" justify="end" mt="4"><Dialog.Close><Button variant="soft">取消</Button></Dialog.Close><Button color="amber" disabled={!normalizeName(submitterName) || errors > 0 || unchangedAfterReturn} onClick={handleSubmitForReview}>提交复核</Button></Flex>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root open={returnOpen} onOpenChange={(open) => { setReturnOpen(open); if (!open) setWorkflowError(''); }}>
        <Dialog.Content maxWidth="520px">
          <Dialog.Title>退回 r{project.revision} 修改</Dialog.Title>
          <Dialog.Description size="2" color="gray">退回后旧提交签认立即失效；必须修改内容后才能重新提交。</Dialog.Description>
          <TextArea mt="4" value={returnReason} onChange={(event) => setReturnReason(event.target.value)} placeholder="退回原因 / 必须修改项" />
          {workflowError && <Callout.Root color="red" mt="3"><Callout.Text size="2">{workflowError}</Callout.Text></Callout.Root>}
          <Flex gap="3" justify="end" mt="4"><Dialog.Close><Button variant="soft">取消</Button></Dialog.Close><Button color="red" disabled={!returnReason.trim()} onClick={handleReturn}>确认退回</Button></Flex>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root open={freezeOpen} onOpenChange={(open) => { setFreezeOpen(open); if (!open) setWorkflowError(''); }}>
        <Dialog.Content maxWidth="560px">
          <Dialog.Title>复核并冻结 r{project.revision}</Dialog.Title>
          <Dialog.Description size="2" color="gray">复核人必须不同于提交人；仅当提交指纹与当前指纹一致时可冻结。</Dialog.Description>
          {approval && (
            <div className="freeze-check">
              <div><span>提交人</span><strong>{approval.submitterName}</strong><small>{formatDateTime(approval.submittedAt)}</small></div>
              <div><span>提交指纹</span><code>{shortFingerprint(approval.submittedFingerprint)}</code></div>
              <div><span>当前指纹</span><code className={fingerprintChanged ? 'invalid' : 'valid'}>{currentFingerprint.slice(0, 8).toUpperCase()}</code></div>
            </div>
          )}
          <label className="dialog-field"><span>复核人姓名（须为另一位人员）</span><TextField.Root value={reviewerName} onChange={(event) => setReviewerName(event.target.value)} placeholder="由复核人签署" autoFocus /></label>
          <TextArea mt="3" value={freezeNote} onChange={(event) => setFreezeNote(event.target.value)} placeholder="复核意见或版本说明" />
          {fingerprintChanged && <Callout.Root color="red" mt="3"><Callout.Text size="2">内容指纹已变化，不能冻结；请退回并在修改后重新提交。</Callout.Text></Callout.Root>}
          {sameReviewerName && <Callout.Root color="red" mt="3"><Callout.Text size="2">复核人与提交人姓名相同，不符合分离要求。</Callout.Text></Callout.Root>}
          {workflowError && <Callout.Root color="red" mt="3"><Callout.Text size="2">{workflowError}</Callout.Text></Callout.Root>}
          <Flex gap="3" justify="end" mt="4"><Dialog.Close><Button variant="soft">取消</Button></Dialog.Close><Button color="green" disabled={freezeBlocked} onClick={handleFreeze}>确认冻结</Button></Flex>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root open={showHelp} onOpenChange={setShowHelp}>
        <Dialog.Content maxWidth="560px">
          <Dialog.Title>键盘快速操作</Dialog.Title>
          <div className="help-list">
            <div><kbd>⌘/Ctrl + K</kbd><span>聚焦全局搜索</span></div>
            <div><kbd>/</kbd><span>聚焦快速录入挑战语</span></div>
            <div><kbd>⌘/Ctrl + Enter</kbd><span>新增检查项</span></div>
            <div><kbd>Alt + ↑ / ↓</kbd><span>移动当前选中检查项</span></div>
            <div><kbd>⌘/Ctrl + Z</kbd><span>撤销最近一次编辑</span></div>
            <div><kbd>⇧ + ⌘/Ctrl + Z</kbd><span>重做编辑</span></div>
            <div><kbd>⌘/Ctrl + S</kbd><span>立即保存到浏览器</span></div>
          </div>
          <Flex justify="end" mt="4"><Dialog.Close><Button>了解了</Button></Dialog.Close></Flex>
        </Dialog.Content>
      </Dialog.Root>
    </Theme>
  );
}

function SignaturePanel({ project, currentFingerprint, fingerprintChanged }: { project: ChecklistProject; currentFingerprint: string; fingerprintChanged: boolean }) {
  if (project.status === 'draft') {
    if (!project.lastReturn) {
      return (
        <Card className="approval-panel idle" mb="4">
          <Flex justify="between" align="center" gap="3">
            <div><strong>编辑与复核分离</strong><Text size="2" as="p" color="gray">提交复核时记录提交人、内容指纹和时间；复核冻结须由另一位复核人签认。</Text></div>
            <Badge variant="soft">当前指纹 {shortFingerprint(currentFingerprint)}</Badge>
          </Flex>
        </Card>
      );
    }
    return (
      <Callout.Root color="red" mb="4">
        <Callout.Text>
          上次复核已于 {formatDateTime(project.lastReturn.returnedAt)} 退回：{project.lastReturn.reason}
          {project.lastReturn.fingerprint === currentFingerprint ? ' 当前内容尚未修改，不能重新提交。' : ' 内容已修改，可重新提交复核。'}
        </Callout.Text>
      </Callout.Root>
    );
  }

  if (project.status === 'review' && project.approval) {
    return (
      <Card className={`approval-panel ${fingerprintChanged ? 'invalid' : 'valid'}`} mb="4">
        <Flex justify="between" align="start" gap="4">
          <div className="signature-lines">
            <span><strong>提交人</strong>{project.approval.submitterName}</span>
            <span><strong>提交时间</strong>{formatDateTime(project.approval.submittedAt)}</span>
            <span><strong>提交指纹</strong>{shortFingerprint(project.approval.submittedFingerprint)}</span>
            <span><strong>当前指纹</strong>{shortFingerprint(currentFingerprint)}</span>
          </div>
          <Badge color={fingerprintChanged ? 'red' : 'green'}>{fingerprintChanged ? '指纹已变化：旧签认失效' : '指纹一致：等待复核'}</Badge>
        </Flex>
      </Card>
    );
  }

  if (project.status === 'frozen') {
    if (!project.approval) {
      return (
        <Callout.Root color="amber" mb="4">
          <Callout.Text>历史留档：该冻结版本没有提交/复核签认数据，可继续只读查看和版本比较，但不能补签；创建新修订后才按新流程办理。</Callout.Text>
        </Callout.Root>
      );
    }
    return (
      <Card className="approval-panel valid" mb="4">
        <Flex justify="between" align="start" gap="4">
          <div className="signature-lines">
            <span><strong>提交人</strong>{project.approval.submitterName} · {formatDateTime(project.approval.submittedAt)} · {shortFingerprint(project.approval.submittedFingerprint)}</span>
            <span><strong>复核人</strong>{project.approval.reviewerName} · {formatDateTime(project.approval.reviewedAt)} · {shortFingerprint(project.approval.reviewedFingerprint)}</span>
          </div>
          <Badge color="green">签认完整</Badge>
        </Flex>
      </Card>
    );
  }
  return null;
}

function PrintableSignatureRecord({ approval }: { approval: ReviewApproval | null }) {
  return (
    <section className="print-signatures">
      <div className="print-stage-title"><span>签</span><div><Heading size="5">{approval ? '签认留痕' : '历史留档'}</Heading></div></div>
      {approval ? (
        <table>
          <thead><tr><th>提交人 / 时间 / 指纹</th><th>复核人 / 时间 / 指纹</th></tr></thead>
          <tbody><tr><td>{approval.submitterName}<br />{formatDateTime(approval.submittedAt)}<br />{shortFingerprint(approval.submittedFingerprint)}</td><td>{approval.reviewerName ?? '—'}<br />{formatDateTime(approval.reviewedAt)}<br />{shortFingerprint(approval.reviewedFingerprint)}</td></tr></tbody>
        </table>
      ) : <Text size="2" color="gray">该版本形成于新签认流程启用前，无签认数据，不能补签；仅供历史查阅与比较。</Text>}
    </section>
  );
}

function PrintableChecklist({ project, compact = false }: { project: ChecklistProject; compact?: boolean }) {
  const stages = project.stages.slice().sort((a, b) => a.order - b.order);
  return (
    <article className={`print-sheet ${compact ? 'compact' : ''}`}>
      <header><div><Heading size="7">{project.name}</Heading><Text color="gray" as="p">{project.aircraft} · r{project.revision} · {statusMeta[project.status].label}{project.status === 'frozen' && !project.approval ? ' · 历史留档' : ''}</Text></div><Badge color={statusMeta[project.status].color}>{project.items.length} 项</Badge></header>
      {stages.map((stage, index) => (
        <section key={stage.id}>
          <div className="print-stage-title"><span>{String(index + 1).padStart(2, '0')}</span><div><Heading size="5">{stage.name}</Heading><Text color="gray" size="1">{stage.description}</Text></div></div>
          <table>
            <thead><tr><th style={{ width: '34%' }}>挑战语</th><th style={{ width: '25%' }}>预期回应</th><th>异常处理</th></tr></thead>
            <tbody>
              {project.items.filter((item) => item.stageId === stage.id).sort((a, b) => a.order - b.order).map((item) => (
                <tr key={item.id}><td>{item.critical && <span className="critical-mark">◆</span>} {item.challenge}</td><td><strong>{item.response || '未填写'}</strong></td><td>{item.abnormalProcedure || '—'}</td></tr>
              ))}
              {!project.items.some((item) => item.stageId === stage.id) && <tr><td colSpan={3}>本阶段暂无检查项</td></tr>}
            </tbody>
          </table>
        </section>
      ))}
      {project.status === 'frozen' && <PrintableSignatureRecord approval={project.approval} />}
    </article>
  );
}

export default App;
