import {signal, Text, View, type Accessor, type JSX} from 'nsh'
import {Toolbar, ResizablePanel, ResizablePanelGroup, Sheet} from 'nsh/base'
import type {NativeView, ShellCommand} from '../../../src/workbench/shell-protocol'
import type {WorkspaceAction} from '../../../src/workbench/shell-state'
import {isDarkContent} from '../../../src/core/prefs'
import {Action, ActionsMenu, Segmented, light, dark, compact} from './controls'
import {Documents, Reviews} from './lists'
import {NativeForms} from './forms'

export function NativeWorkbench(props: {view: Accessor<NativeView | null>; send: (command: ShellCommand) => void; canvas: JSX.Element; directories: boolean}) {
  const colors = () => isDarkContent(props.view()?.chrome?.prefs.theme ?? 'light') ? dark : light
  const pane = signal<'documents' | 'reviews' | null>(null)
  const navigator = signal(true)
  const inspector = signal(true)
  // Presentation intent survives sidebar/sheet remounts; selected identities stay in the workbench.
  const selectingDocuments = signal(false)
  const chrome = () => props.view()?.chrome
  const execute = (action: WorkspaceAction) => props.send({type: 'workspace', action})
  const toggle = (target: 'documents' | 'reviews') => {
    if (compact()) pane.set(target)
    else if (target === 'documents') navigator.set(!navigator())
    else inspector.set(!inspector())
  }
  const menuGroups: {action: WorkspaceAction; label: string; text?: boolean; document?: boolean; danger?: boolean}[][] = [[
    {action: 'new', label: '粘贴新建文档'}, {action: 'files', label: '打开文件'},
    ...(props.directories ? [{action: 'folder' as const, label: '导入文件夹'}] : []),
    {action: 'paste-image', label: '从剪贴板粘贴图片'}, {action: 'sample', label: '载入示例'},
  ], [
    {action: 'search', label: '搜索与批量批注', text: true}, {action: 'scan', label: '检查 AI 冗余', text: true},
    {action: 'edit', label: '编辑原文', text: true}, {action: 'diff', label: 'AI 改稿对照', text: true},
    {action: 'clear-revised', label: '清除 AI 改稿', text: true},
  ], [
    {action: 'settings', label: '阅读设置'}, {action: 'theme', label: '切换明暗'},
  ], [
    {action: 'recovery', label: '下载完整工作区备份'}, {action: 'restore', label: '恢复完整工作区备份'},
    {action: 'backup', label: '下载文档与批注备份'}, {action: 'trash', label: '回收站'},
  ], [
    {action: 'remove', label: '移除当前文档', document: true, danger: true},
  ]]
  const readingModes = (['source', 'split', 'preview'] as const).map(mode => ({value: mode, title: {source: '源码', split: '分栏', preview: '预览'}[mode], testID: `reading-${mode}`}))
  const readingLabel = () => readingModes.find(mode => mode.value === chrome()?.readingMode)?.title ?? '源码'
  return <View testID="native-workbench" style={{flex: 1, backgroundColor: colors().chrome}}>
    <Toolbar accessibilityLabel="工作区工具栏" style={{flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: 12, gap: 6, borderBottomWidth: 1, borderColor: colors().border}}>
      <Action label="文档" testID="documents-toggle" colors={colors} selected={compact() ? pane() === 'documents' : navigator()} disabled={!chrome()?.ready} onPress={() => toggle('documents')} />
      <View style={{flex: 1, minWidth: 0, overflow: 'hidden'}}>
        <Text accessibilityLabel={chrome()?.active?.name ?? 'InkMark'} style={{fontSize: 14, fontWeight: '600', color: colors().text, numberOfLines: 1}}>{chrome()?.active?.name ?? 'InkMark'}</Text>
      </View>
      <View style={{flexDirection: 'row', flexShrink: 0, alignItems: 'center', gap: 6}}>
      <If when={chrome()?.active?.kind === 'text' && chrome()?.mode === 'annotate'}>
        <If when={!compact()}><Segmented label="阅读模式" value={chrome()?.readingMode ?? 'source'} items={readingModes} colors={colors}
          onChange={mode => props.send({type: 'reading', mode})} /></If>
        <If when={compact()}><ActionsMenu label={`阅读模式：${readingLabel()}`} testID="reading-menu" colors={colors}
          text={`${readingLabel()} ▾`}
          groups={[readingModes.map(mode => ({value: mode.value, label: mode.title, testID: mode.testID, checked: chrome()?.readingMode === mode.value}))]}
          onSelect={mode => props.send({type: 'reading', mode})} /></If>
      </If>
      <Action label={`批注 ${chrome()?.active?.openCount ?? 0}`} testID="reviews-toggle" colors={colors} selected={compact() ? pane() === 'reviews' : inspector()} disabled={!chrome()?.ready} onPress={() => toggle('reviews')} />
      <If when={!compact()}><Action label="导出" testID="export-review" colors={colors} disabled={!chrome()?.active?.annotationCount} onPress={() => execute('export')} /></If>
      <ActionsMenu label="工作区操作" text="···" testID="workspace-menu" colors={colors} onSelect={execute}
        groups={[
          ...(compact() ? [[{value: 'export' as const, label: '导出批注', testID: 'action-export', disabled: !chrome()?.active?.annotationCount}]] : []),
          ...menuGroups.map(group => group.map(item => ({value: item.action, label: item.label, testID: `action-${item.action}`, danger: item.danger,
            disabled: !chrome()?.ready || Boolean(item.text && chrome()?.active?.kind !== 'text') || Boolean(item.document && !chrome()?.active)}))),
        ]} />
      </View>
    </Toolbar>
    <ResizablePanelGroup axis="horizontal" style={{flex: 1, minHeight: 0}} handleStyle={{backgroundColor: colors().border}} handleAccessibilityLabel="调整工作区面板宽度">
      <ResizablePanel size={240} minSize={200} maxSize={340} visible={!compact() && navigator()}>
        <Documents view={props.view} colors={colors} send={props.send} selecting={selectingDocuments} onSelectingChange={selectingDocuments.set} />
      </ResizablePanel>
      <ResizablePanel minSize={260}>
        <View style={{flex: 1, backgroundColor: colors().canvas}}>
          <If when={Boolean(props.view()?.image)}>
            <Toolbar accessibilityLabel="图片工具栏" style={{flexDirection: 'row', flexWrap: 'wrap', padding: 8, gap: 2, backgroundColor: colors().chrome}}>
              <Action colors={colors} testID="image-coordinates" label="坐标批注" disabled={!props.view()?.image?.usable}
                onPress={() => props.send({type: 'image', action: 'coordinates'})} />
              <View style={{flex: 1}} />
              <ActionsMenu label={`图片缩放与编辑：${Math.round((props.view()?.image?.scale ?? 1) * 100)}%`} text={`${Math.round((props.view()?.image?.scale ?? 1) * 100)}% ▾`} colors={colors}
                groups={[(['out', 'in', 'fit', 'original', 'edit'] as const).map(action => ({value: action, testID: `image-${action}`,
                  label: {out: '缩小', in: '放大', fit: '适应窗口', original: '原始尺寸', edit: '编辑选中批注'}[action],
                  disabled: !props.view()?.image?.usable || (action === 'edit' && !props.view()?.image?.selected)}))]}
                onSelect={action => props.send({type: 'image', action})} />
            </Toolbar>
          </If>
          <If when={Boolean(props.view()?.image)}>
            <Text style={{fontSize: 11, color: colors().secondary, paddingHorizontal: 12, paddingVertical: 6}}>拖动空白处批注 · 点击区域调整 · Space / 双指浏览</Text>
          </If>
          <View style={{flex: 1, position: 'relative'}}>
            {props.canvas}
          <If when={Boolean(props.view()?.selection)}>
            <View style={{position: 'absolute', left: compact() ? 8 : props.view()?.selection?.x ?? 8, top: compact() ? undefined : props.view()?.selection?.y ?? 8, bottom: compact() ? 8 : undefined, flexDirection: 'row', alignItems: 'center', gap: 4, padding: 4, borderWidth: 1, borderRadius: 8, borderColor: colors().border, backgroundColor: colors().chrome}}>

              <Action label="添加批注" testID="selection-annotate" primary colors={colors} onPress={() => props.send({type: 'selection', action: 'annotate'})} />
              <Action label="复制" colors={colors} onPress={() => props.send({type: 'selection', action: 'copy'})} />
            </View>
          </If>
            <If when={Boolean(chrome()?.ready && !chrome()?.active)}>
              <View style={{position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 16, backgroundColor: colors().canvas}}>
                <Text style={{fontSize: 28, fontWeight: '600', color: colors().text}}>留下一点想法。</Text>
                <Text style={{fontSize: 15, color: colors().secondary}}>导入文字或图片，划选、批注、分享。</Text>
                <View style={{flexDirection: 'row', gap: 8}}><Action label="粘贴新建文档" testID="welcome-new" primary colors={colors} onPress={() => execute('new')} /><Action label="打开文件" colors={colors} onPress={() => execute('files')} /></View>
                <Action label="载入示例" colors={colors} onPress={() => execute('sample')} />
              </View>
            </If>
          </View>

        </View>
      </ResizablePanel>
      <ResizablePanel size={340} minSize={280} maxSize={440} visible={!compact() && inspector()}>
        <Reviews view={props.view} colors={colors} send={props.send} />
      </ResizablePanel>
    </ResizablePanelGroup>
    <View style={{paddingHorizontal: 12, paddingVertical: 6, gap: 4, borderTopWidth: 1, borderColor: colors().border}}>
      <Text testID="native-save-status" style={{fontSize: 12, color: props.view()?.save.status === 'error' ? colors().danger : colors().secondary}}>{props.view()?.save.message || '正在载入本地工作区…'}</Text>
      <If when={Boolean(props.view()?.notice)}><Text style={{fontSize: 12, color: colors().secondary, numberOfLines: 2}}>{props.view()?.notice}</Text></If>
      <If when={props.view()?.save.status === 'error'}><View style={{flexDirection: 'row', flexWrap: 'wrap'}}>
        <Action label="下载完整备份" colors={colors} onPress={() => execute('recovery')} />
        <If when={props.view()?.save.rawRecovery}><Action label="下载原始数据" colors={colors} onPress={() => execute('raw-backup')} /><Action label="重置本地数据" colors={colors} danger onPress={() => execute('reset-storage')} /></If>
      </View></If>
      <If when={chrome()?.legacyRecovery}><Action label="下载旧版工作区备份" colors={colors} onPress={() => execute('legacy-backup')} /></If>
    </View>
    <Sheet open={compact() && pane() !== null} side="bottom" popupStyle={{height: '85%', backgroundColor: colors().chrome}} backdropStyle={{backgroundColor: '#00000040'}} onOpenChange={({open}) => { if (!open) pane.set(null) }}>
      <View style={{alignItems: 'flex-end', padding: 8}}><Action label="返回阅读" colors={colors} onPress={() => pane.set(null)} /></View>
      <If when={pane() === 'documents'}><Documents view={props.view} colors={colors} send={props.send} selecting={selectingDocuments} onSelectingChange={selectingDocuments.set} onOpen={() => pane.set(null)} /></If>
      <If when={pane() === 'reviews'}><Reviews view={props.view} colors={colors} send={props.send} onOpen={() => pane.set(null)} /></If>
    </Sheet>
    <NativeForms items={() => props.view()?.interactions ?? []} colors={colors} send={props.send} />
  </View>
}
