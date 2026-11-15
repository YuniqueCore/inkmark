import {signal, Text, View, type Accessor, type JSX} from 'nsh'
import {Menu, MenuItem, Toolbar, ResizablePanel, ResizablePanelGroup, Sheet} from 'nsh/base'
import type {NativeView, ShellCommand} from '../../../src/workbench/shell-protocol'
import type {WorkspaceAction} from '../../../src/workbench/shell-state'
import {isDarkContent} from '../../../src/core/prefs'
import {Action, light, dark, compact} from './controls'
import {Documents, Reviews} from './lists'
import {NativeForms} from './forms'

export function NativeWorkbench(props: {view: Accessor<NativeView | null>; send: (command: ShellCommand) => void; canvas: JSX.Element; directories: boolean}) {
  const colors = () => isDarkContent(props.view()?.chrome?.prefs.theme ?? 'light') ? dark : light
  const pane = signal<'documents' | 'reviews' | null>(null)
  const navigator = signal(true)
  const inspector = signal(true)
  const chrome = () => props.view()?.chrome
  const execute = (action: WorkspaceAction) => props.send({type: 'workspace', action})
  const toggle = (target: 'documents' | 'reviews') => {
    if (compact()) pane.set(target)
    else if (target === 'documents') navigator.set(!navigator())
    else inspector.set(!inspector())
  }
  const menuItems: {action: WorkspaceAction; label: string; text?: boolean; document?: boolean; danger?: boolean}[] = [
    {action: 'new', label: '粘贴新建文档'}, {action: 'files', label: '打开文件'},
    ...(props.directories ? [{action: 'folder' as const, label: '导入文件夹'}] : []),
    {action: 'paste-image', label: '从剪贴板粘贴图片'}, {action: 'sample', label: '载入示例'},
    {action: 'search', label: '搜索与批量批注', text: true}, {action: 'scan', label: '检查 AI 冗余', text: true},
    {action: 'edit', label: '编辑原文', text: true}, {action: 'diff', label: 'AI 改稿对照', text: true},
    {action: 'clear-revised', label: '清除 AI 改稿', text: true},
    {action: 'settings', label: '阅读设置'}, {action: 'theme', label: '切换明暗'},
    {action: 'recovery', label: '下载完整工作区备份'}, {action: 'restore', label: '恢复完整工作区备份'},
    {action: 'backup', label: '下载文档与批注备份'}, {action: 'trash', label: '回收站'},
    {action: 'remove', label: '移除当前文档', document: true, danger: true},
  ]
  return <View testID="native-workbench" style={{flex: 1, backgroundColor: colors().chrome}}>
    <Toolbar accessibilityLabel="工作区工具栏" style={{flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: 12, gap: 6, borderBottomWidth: 1, borderColor: colors().border}}>
      <Action label="文档" testID="documents-toggle" colors={colors} selected={compact() ? pane() === 'documents' : navigator()} disabled={!chrome()?.ready} onPress={() => toggle('documents')} />
      <Text style={{flex: 1, minWidth: 0, fontSize: 14, fontWeight: '600', color: colors().text, numberOfLines: 1}}>{chrome()?.active?.name ?? 'InkMark'}</Text>
      <If when={chrome()?.active?.kind === 'text' && chrome()?.mode === 'annotate'}>
        <If when={!compact()}><View accessibilityLabel="阅读模式" style={{flexDirection: 'row', gap: 2}}>
          <Each of={['source', 'split', 'preview'] as const}>{mode => <Action testID={`reading-${mode()}`} label={{source: '源码', split: '分栏', preview: '预览'}[mode()]} colors={colors}
            selected={chrome()?.readingMode === mode()} onPress={() => props.send({type: 'reading', mode: mode()})} />}</Each>
        </View></If>
        <If when={compact()}><Menu popupStyle={{backgroundColor: colors().chrome, borderRadius: 8, padding: 6}}
          trigger={<Text accessibilityLabel="阅读模式" testID="reading-menu" style={{padding: 12, color: colors().text, fontSize: 13}}>{{source: '源码', split: '分栏', preview: '预览'}[chrome()?.readingMode ?? 'source']} ▾</Text>}>
          <Each of={['source', 'split', 'preview'] as const}>{mode => <MenuItem testID={`reading-${mode()}`} checked={chrome()?.readingMode === mode()} role="menuitemradio"
            onSelect={() => props.send({type: 'reading', mode: mode()})} style={{padding: 12}}>
            <Text style={{color: colors().text}}>{{source: '源码', split: '分栏', preview: '预览'}[mode()]}</Text>
          </MenuItem>}</Each>
        </Menu></If>
      </If>
      <Action label={`批注 ${chrome()?.active?.openCount ?? 0}`} testID="reviews-toggle" colors={colors} selected={compact() ? pane() === 'reviews' : inspector()} disabled={!chrome()?.ready} onPress={() => toggle('reviews')} />
      <If when={!compact()}><Action label="导出" testID="export-review" colors={colors} disabled={!chrome()?.active?.annotationCount} onPress={() => execute('export')} /></If>
      <Menu popupStyle={{backgroundColor: colors().chrome, borderRadius: 8, padding: 6}} trigger={<Text accessibilityLabel="工作区操作" testID="workspace-menu" style={{padding: 12, color: colors().text, fontSize: 17}}>···</Text>}>
        <If when={compact()}><MenuItem testID="action-export" onSelect={() => execute('export')} disabled={!chrome()?.active?.annotationCount} style={{padding: 12}}><Text style={{color: colors().text}}>导出批注</Text></MenuItem></If>
        <Each of={menuItems}>{item => <MenuItem testID={`action-${item().action}`} disabled={!chrome()?.ready || (item().text && chrome()?.active?.kind !== 'text') || (item().document && !chrome()?.active)}
          onSelect={() => execute(item().action)} style={{padding: 12}}><Text style={{fontSize: 14, color: item().danger ? colors().danger : colors().text}}>{item().label}</Text></MenuItem>}</Each>
      </Menu>
    </Toolbar>
    <ResizablePanelGroup axis="horizontal" style={{flex: 1, minHeight: 0}} handleStyle={{backgroundColor: colors().border}} handleAccessibilityLabel="调整工作区面板宽度">
      <ResizablePanel size={240} minSize={200} maxSize={340} visible={!compact() && navigator()}>
        <Documents view={props.view} colors={colors} send={props.send} />
      </ResizablePanel>
      <ResizablePanel minSize={260}>
        <View style={{flex: 1, backgroundColor: colors().canvas}}>
          <If when={Boolean(props.view()?.image)}>
            <Toolbar accessibilityLabel="图片工具栏" style={{flexDirection: 'row', flexWrap: 'wrap', padding: 8, gap: 2, backgroundColor: colors().chrome}}>
              <Action colors={colors} testID="image-coordinates" label="坐标批注" disabled={!props.view()?.image?.usable}
                onPress={() => props.send({type: 'image', action: 'coordinates'})} />
              <View style={{flex: 1}} />
              <Menu popupStyle={{backgroundColor: colors().chrome, padding: 6, borderRadius: 8}} trigger={<Text accessibilityLabel="图片缩放与编辑" style={{padding: 12, fontSize: 13, color: colors().secondary}}>{Math.round((props.view()?.image?.scale ?? 1) * 100)}% ▾</Text>}>
                <Each of={['out', 'in', 'fit', 'original', 'edit'] as const}>{action => <MenuItem testID={`image-${action()}`}
                  disabled={!props.view()?.image?.usable || (action() === 'edit' && !props.view()?.image?.selected)}
                  onSelect={() => props.send({type: 'image', action: action()})} style={{padding: 12}}>
                  <Text style={{color: colors().text}}>{{out: '缩小', in: '放大', fit: '适应窗口', original: '原始尺寸', edit: '编辑选中批注'}[action()]}</Text>
                </MenuItem>}</Each>
              </Menu>
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
      <If when={pane() === 'documents'}><Documents view={props.view} colors={colors} send={props.send} onOpen={() => pane.set(null)} /></If>
      <If when={pane() === 'reviews'}><Reviews view={props.view} colors={colors} send={props.send} onOpen={() => pane.set(null)} /></If>
    </Sheet>
    <NativeForms items={() => props.view()?.interactions ?? []} colors={colors} send={props.send} />
  </View>
}
