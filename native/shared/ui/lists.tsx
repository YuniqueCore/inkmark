import {List, Text, View, signal, type Accessor} from 'nsh'
import {Button, Menu, MenuItem, Popover} from 'nsh/base'
import type {NativeView, ShellCommand} from '../../../src/workbench/shell-protocol'
import {ALL_KINDS, KIND_LABEL} from '../../../src/core/types'
import {Action, Check, Choice, touch, type Colors} from './controls'

export interface ListProps {view: Accessor<NativeView | null>; send: (command: ShellCommand) => void; colors: Colors; onOpen?: () => void}

export function Documents(props: ListProps) {
  const selecting = signal(false)
  const model = () => props.view()?.documents
  const bulk = (action: Extract<ShellCommand, {type: 'documents'}>['action']) => props.send({type: 'documents', action})
  return <View style={{flex: 1, backgroundColor: props.colors().chrome}}>
    <View style={{flexDirection: 'row', alignItems: 'center', padding: 10}}>
      <Text style={{flex: 1, fontSize: 13, fontWeight: '600', color: props.colors().secondary}}>文档 {model()?.total ?? 0}</Text>
      <Action label="新建" testID="new-document" colors={props.colors} onPress={() => props.send({type: 'workspace', action: 'new'})} />
      <Action label="导入" testID="import-files" colors={props.colors} onPress={() => props.send({type: 'workspace', action: 'files'})} />
    </View>
    <If when={(model()?.total ?? 0) > 0}><View style={{flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8}}>
      <Action label={selecting() ? '完成选择' : '选择文档'} colors={props.colors} onPress={() => { selecting.set(!selecting()); if (!selecting()) bulk('clear') }} />
      <If when={selecting()}>
      <Action label="全选" colors={props.colors} onPress={() => bulk('all')} />
      <Action label="反选" colors={props.colors} onPress={() => bulk('invert')} />
      <If when={(model()?.selected.length ?? 0) > 0}>
        <Action label="导出所选" colors={props.colors} onPress={() => bulk('export')} />
        <Action label="删除所选" colors={props.colors} danger onPress={() => bulk('delete')} />
      </If>
      </If>
    </View></If>
    <List each={model()?.rows ?? []} keyExtractor={row => row.key} estimatedItemSize={touch() ? 52 : 36} style={{flex: 1}}
      empty={<Text style={{padding: 20, color: props.colors().secondary, fontSize: 14}}>导入文本、Markdown 或图片，也可以粘贴新建。</Text>}>
      {row => <View style={{flexDirection: 'row', alignItems: 'center', paddingLeft: 8 + row().depth * 12, paddingRight: 6, minHeight: touch() ? 52 : 36,
        backgroundColor: row().doc?.id === model()?.activeId ? props.colors().inset : 'transparent'}}>
        <If when={!row().directory && selecting()}>
          <Check label={`选择 ${row().title}`} checked={model()?.selected.includes(row().key) ?? false} colors={props.colors} onChange={() => props.send({type: 'document', action: 'select', id: row().key})} />
        </If>
        <View style={{flex: 1}}>
          <Action label={`${row().directory ? row().collapsed ? '› ' : '⌄ ' : ''}${row().title}`} colors={props.colors}
            align="start" testID={`document-${row().key}`} onPress={() => { props.send({type: 'document', action: row().directory ? 'directory' : 'open', id: row().key}); if (!row().directory) props.onOpen?.() }} />
        </View>
        <If when={!row().directory}>
          <Menu popupStyle={{backgroundColor: props.colors().chrome, padding: 6, borderRadius: 8}} trigger={<Text accessibilityLabel={`文档操作：${row().title}`} style={{padding: 12, minWidth: 44, minHeight: 44, color: props.colors().secondary}}>···</Text>}>
            <MenuItem onSelect={() => props.send({type: 'document', action: 'export', id: row().key})} style={{padding: 12}}><Text style={{color: props.colors().text}}>导出批注</Text></MenuItem>
            <MenuItem onSelect={() => props.send({type: 'document', action: 'remove', id: row().key})} style={{padding: 12}}><Text style={{color: props.colors().danger}}>移入回收站</Text></MenuItem>
          </Menu>
        </If>
      </View>}
    </List>
    <If when={(model()?.pages ?? 1) > 1}>
      <View style={{flexDirection: 'row', justifyContent: 'space-between', padding: 8}}>
        <Action label="上一页" colors={props.colors} disabled={!model()?.page} onPress={() => bulk('previous')} />
        <Text style={{color: props.colors().secondary}}>{(model()?.page ?? 0) + 1} / {model()?.pages}</Text>
        <Action label="下一页" colors={props.colors} disabled={(model()?.page ?? 0) + 1 >= (model()?.pages ?? 1)} onPress={() => bulk('next')} />
      </View>
    </If>
    <View style={{borderTopWidth: 1, borderColor: props.colors().border, padding: 8}}>
      <Action label={`回收站 · ${props.view()?.chrome?.trashCount ?? 0}`} colors={props.colors} onPress={() => props.send({type: 'workspace', action: 'trash'})} />
    </View>
  </View>
}

export function Reviews(props: ListProps) {
  const model = () => props.view()?.reviews
  const bulk = (action: Extract<ShellCommand, {type: 'reviews'}>['action']) => props.send({type: 'reviews', action})
  const filter = (patch: Partial<Extract<ShellCommand, {type: 'filter'}>>) => {
    const current = model()
    if (current) props.send({type: 'filter', status: current.filter, kinds: current.kinds, highlightFiltered: current.highlightFiltered, ...patch})
  }
  return <View style={{flex: 1, backgroundColor: props.colors().chrome}}>
    <View style={{padding: 12, gap: 10}}>
      <Text style={{fontSize: 14, fontWeight: '600', color: props.colors().text}}>批注 · {model()?.total ?? 0}</Text>
      <Popover placement="bottom" align="end" popupStyle={{width: 300, padding: 14, gap: 10, backgroundColor: props.colors().chrome, borderWidth: 1, borderColor: props.colors().border, borderRadius: 8}}
        trigger={<Text style={{fontSize: 13, padding: 8, color: props.colors().secondary}}>筛选与选择 · {model()?.filter === 'all' && !model()?.kinds.length ? '全部' : '已筛选'}</Text>}>
      <Choice label="状态" colors={props.colors} value={model()?.filter ?? 'all'} items={[{value: 'all', title: '全部批注'}, {value: 'open', title: '未解决'}, {value: 'resolved', title: '已解决'}]}
        onChange={value => { if (value === 'all' || value === 'open' || value === 'resolved') filter({status: value}) }} />
      <If when={(props.view()?.chrome?.active?.annotationCount ?? 0) > 0}><View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 2}}>
        <Action label="全部类型" selected={!model()?.kinds.length} colors={props.colors} onPress={() => filter({kinds: []})} />
        <Each of={model()?.availableKinds ?? []}>{kind => <Action label={KIND_LABEL[kind()]} selected={model()?.kinds.includes(kind())} colors={props.colors}
          onPress={() => filter({kinds: model()?.kinds.includes(kind()) ? model()!.kinds.filter(k => k !== kind()) : [...(model()?.kinds ?? []), kind()]})} />}</Each>
      </View>
      </If>
      <If when={(model()?.total ?? 0) > 0}>
        <Choice label="快速选中" value="" colors={props.colors} items={[{value: '', title: '按条件选择批注…'}, {value: 'open', title: '未解决'}, {value: 'resolved', title: '已解决'},
          ...(!props.view()?.image ? [{value: 'lost', title: '失锚批注'}, {value: 'revised', title: '改稿侧'}] : []), ...(model()?.availableKinds ?? []).map(kind => ({value: `kind:${kind}`, title: KIND_LABEL[kind]}))]}
          onChange={selection => { const choices = ['lost', 'revised', 'open', 'resolved', ...ALL_KINDS.map(kind => `kind:${kind}` as const)] as const; const selected = choices.find(value => value === selection); if (selected) props.send({type: 'review-quick', selection: selected}) }} />
        <View style={{flexDirection: 'row', alignItems: 'center'}}><Check label="画布只高亮筛选结果" checked={model()?.highlightFiltered ?? false} colors={props.colors} onChange={() => filter({highlightFiltered: !model()?.highlightFiltered})} /><Text style={{fontSize: 12, color: props.colors().secondary}}>只高亮筛选结果</Text></View>
      </If>
      </Popover>
      <If when={Boolean(model()?.report)}><View style={{gap: 5}}>
        <Text style={{fontSize: 13, color: props.colors().text}}>预扫描 · {model()?.report?.band} · {model()?.report?.score} / 千单位</Text>
        <Text style={{fontSize: 12, color: props.colors().secondary}}>{model()?.report?.units} 单位 · {model()?.report?.candidates} 处候选</Text>
        <Each of={model()?.report?.categories ?? []}>{category => <Text style={{fontSize: 12, color: props.colors().secondary}}>{category().label} × {category().count}</Text>}</Each>
        <If when={(model()?.report?.history.length ?? 0) > 1}><Text style={{fontSize: 12, color: props.colors().secondary}}>历次评分：{model()?.report?.history.join(' → ')}；较上次 {model()?.report?.delta}</Text></If>
      </View></If>
      <If when={(props.view()?.chrome?.active?.annotationCount ?? 0) > 0}><View style={{flexDirection: 'row', flexWrap: 'wrap'}}>
        <Action label="全选" colors={props.colors} onPress={() => bulk('all')} />
        <Action label="反选" colors={props.colors} onPress={() => bulk('invert')} />
        <If when={(model()?.selected.length ?? 0) > 0}>
          <Action label="导出" colors={props.colors} onPress={() => bulk('export')} />
          <Action label="解决／重开" colors={props.colors} onPress={() => bulk('resolve')} />
          <Action label="删除" colors={props.colors} danger onPress={() => bulk('delete')} />
          <Action label="清除选择" colors={props.colors} onPress={() => bulk('clear')} />
        </If>
      </View></If>
    </View>
    <List each={model()?.rows ?? []} keyExtractor={ann => ann.key} estimatedItemSize={160} style={{flex: 1}}
      empty={<Text style={{padding: 20, color: props.colors().secondary}}>划选正文或框选图片，写下你的意见。</Text>}>
      {ann => <View style={{padding: 14, gap: 7, borderTopWidth: 1, borderColor: props.colors().border, backgroundColor: model()?.activeId === ann().id ? props.colors().inset : 'transparent'}}>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 6}}>
          <Check label={`选择批注 ${ann().excerpt}`} checked={ann().selected} colors={props.colors} onChange={() => props.send({type: ann().rowType === 'group' ? 'review-group' : 'review', action: 'select', id: ann().id})} />
          <Text style={{flex: 1, fontSize: 12, color: props.colors().secondary}}>{KIND_LABEL[ann().kind]}{ann().rowType === 'group' ? ` · ${ann().count} 处` : ''}{ann().status === 'resolved' ? ' · 已解决' : ''}{ann().anchorLost ? ' · 失锚' : ''}{ann().revised ? ' · 改稿' : ''}{ann().category ? ` · ${ann().category}` : ''}</Text>
        </View>
        <Button accessibilityLabel={ann().rowType === 'group' ? '展开批注位置' : '定位批注'} style={{alignItems: 'stretch', gap: 7}} onPress={() => {
          if (ann().rowType === 'group') props.send({type: 'review-group', action: 'expand', id: ann().id})
          else { props.send({type: 'review', action: 'focus', id: ann().id}); props.onOpen?.() }
        }}>
          <Text style={{fontSize: 13, color: props.colors().secondary, numberOfLines: 3}}>{ann().excerpt}</Text>
          <Text style={{fontSize: 14, color: props.colors().text, numberOfLines: 6}}>{ann().comment}</Text>
          <If when={Boolean(ann().replacement)}><Text style={{fontSize: 13, color: props.colors().accent, numberOfLines: 3}}>建议：{ann().replacement}</Text></If>
        </Button>
        <View style={{flexDirection: 'row', alignItems: 'center'}}>
          <If when={ann().rowType === 'group'}><Action label={ann().expanded ? '收起' : '展开位置'} colors={props.colors} onPress={() => props.send({type: 'review-group', action: 'expand', id: ann().id})} /></If>
          <Action label={ann().status === 'open' ? '解决' : '重开'} colors={props.colors} onPress={() => props.send({type: ann().rowType === 'group' ? 'review-group' : 'review', action: 'resolve', id: ann().id})} />
          <View style={{flex: 1}} />
          <Menu popupStyle={{backgroundColor: props.colors().chrome, padding: 6, borderRadius: 8}} trigger={<Text accessibilityLabel="批注操作" style={{padding: 10, color: props.colors().secondary}}>···</Text>}>
            <If when={ann().rowType === 'annotation'}><MenuItem onSelect={() => props.send({type: 'review', action: 'edit', id: ann().id})} style={{padding: 12}}><Text style={{color: props.colors().text}}>编辑批注</Text></MenuItem></If>
            <MenuItem onSelect={() => props.send({type: ann().rowType === 'group' ? 'review-group' : 'review', action: 'export', id: ann().id})} style={{padding: 12}}><Text style={{color: props.colors().text}}>导出</Text></MenuItem>
            <MenuItem onSelect={() => props.send({type: ann().rowType === 'group' ? 'review-group' : 'review', action: 'delete', id: ann().id})} style={{padding: 12}}><Text style={{color: props.colors().danger}}>删除</Text></MenuItem>
          </Menu>
        </View>
      </View>}
    </List>
    <If when={(model()?.pages ?? 1) > 1}>
      <View style={{flexDirection: 'row', justifyContent: 'space-between', padding: 8}}>
        <Action label="上一页" colors={props.colors} disabled={!model()?.page} onPress={() => bulk('previous')} />
        <Action label="下一页" colors={props.colors} disabled={(model()?.page ?? 0) + 1 >= (model()?.pages ?? 1)} onPress={() => bulk('next')} />
      </View>
    </If>
  </View>
}
