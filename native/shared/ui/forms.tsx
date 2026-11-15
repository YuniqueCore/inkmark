import {validRegion} from '../../../src/core/image'
import {isComposing} from './input-state'
import {keymap, signal, Text, View, Scroll, windowSize, type Accessor, type InputRef} from 'nsh'
import {Sheet} from 'nsh/base'
import type {NativeInteraction, InteractionOf, ShellCommand} from '../../../src/workbench/shell-protocol'
import {MANUAL_KINDS, KIND_LABEL, QUICK_PHRASES, toggleQuickPhrase} from '../../../src/core/types'
import {THEME_META, TEXTURE_META, FONT_META, FONT_WEIGHT_META, type ReadingPrefs} from '../../../src/core/prefs'
import {canSubmitComposition, type ComposerState} from '../../../src/workbench/composition'
import {Action, Field, Choice, touch, type Colors} from './controls'

type Send = (command: ShellCommand) => void
interface FormProps<T extends NativeInteraction['type']> {value: Accessor<InteractionOf<T>>; colors: Colors; send: Send}

function Frame(props: {value: Accessor<NativeInteraction>; colors: Colors; cancel: () => void; dismiss?: () => void; submit?: () => void; children?: import('nsh').JSX.Element; input?: () => InputRef | undefined; discardChanges?: () => boolean}) {
  const confirming = signal(false)
  const dismiss = () => { if (props.discardChanges?.()) confirming.set(true); else (props.dismiss ?? props.cancel)() }
  keymap.bind('mod+enter', () => { if (!isComposing() && !confirming()) props.submit?.() }, {when: 'always'})
  return <><Sheet open closeOnEscape={false} onCancel={() => { if (!isComposing()) dismiss() }} side={touch() ? 'bottom' : 'right'} closeOnBackdropPress={false}
    onOpenChange={({open}) => { if (!open) dismiss() }} onOpen={() => props.input?.()?.focus()}
    popupStyle={{width: touch() ? windowSize().width : Math.min(620, windowSize().width - 64), maxHeight: windowSize().height * .92,
      backgroundColor: props.colors().chrome, padding: 20, paddingBottom: 'calc(env(keyboard-inset-height) + 20px)', gap: 12}}
    backdropStyle={{backgroundColor: '#00000040'}}>
    <View style={{flexDirection: 'row', alignItems: 'center', gap: 12}}>
      <Text style={{flex: 1, fontSize: 18, fontWeight: '600', color: props.colors().text}}>{props.value().title}</Text>
      <Action label="关闭" testID="form-close" colors={props.colors} onPress={dismiss} />
    </View>
    <Scroll style={{maxHeight: windowSize().height * .72}} contentStyle={{gap: 14}}>
      {props.children}
      <If when={Boolean(props.value().error)}><Text style={{color: props.colors().danger, fontSize: 14}}>{props.value().error}</Text></If>
    </Scroll>
  </Sheet>
    <Sheet open={confirming()} onCancel={() => confirming.set(false)} side={touch() ? 'bottom' : 'right'} closeOnEscape={false} closeOnBackdropPress={false}
      popupStyle={{width: Math.min(420, windowSize().width), padding: 24, gap: 16, backgroundColor: props.colors().chrome}} backdropStyle={{backgroundColor: '#00000050'}}>
      <Text style={{fontSize: 18, fontWeight: '600', color: props.colors().text}}>放弃未保存的修改？</Text>
      <Text style={{fontSize: 14, color: props.colors().secondary}}>内容尚未提交。继续编辑可以保留当前输入。</Text>
      <View style={{flexDirection: 'row', justifyContent: 'flex-end', gap: 8}}>
        <Action label="继续编辑" testID="discard-keep" primary colors={props.colors} onPress={() => { confirming.set(false); props.input?.()?.focus() }} />
        <Action label="放弃修改" testID="discard-confirm" danger colors={props.colors} onPress={() => { confirming.set(false); (props.dismiss ?? props.cancel)() }} />
      </View>
    </Sheet>
  </>
}

function Composer(props: {value: Accessor<ComposerState>; change: (value: ComposerState) => void; colors: Colors; image?: boolean; input?: (ref: InputRef) => void}) {
  return <View style={{gap: 12}}>
    <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 4}}>
      <Each of={MANUAL_KINDS}>{kind => <Action label={KIND_LABEL[kind()]} selected={props.value().kind === kind()} colors={props.colors} onPress={() => props.change({...props.value(), kind: kind()})} />}</Each>
    </View>
    <If when={!props.image}>
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 4}}>
        <Each of={QUICK_PHRASES[props.value().kind] ?? []}>{phrase => <Action label={phrase()} colors={props.colors} onPress={() => props.change({...props.value(), comment: toggleQuickPhrase(props.value().comment, phrase())})} />}</Each>
      </View>
    </If>
    <Field label="批注内容" testID="annotation-comment" value={props.value().comment} colors={props.colors} multiline inputRef={props.input}
      onChange={comment => props.change({...props.value(), comment})} placeholder="写下意见；认可可不写描述。" />
    <If when={!props.image}><Field label="建议替换词（可选）" value={props.value().replacement} colors={props.colors} onChange={replacement => props.change({...props.value(), replacement})} /></If>
  </View>
}

function TextForm(props: FormProps<'text'>) {
  const initial = props.value().value
  const text = signal(initial)
  let input: InputRef | undefined
  const send = (action: 'change' | 'submit' | 'cancel') => action === 'cancel' ? props.send({type: 'text', id: props.value().id, action}) : props.send({type: 'text', id: props.value().id, action, value: text()})
  return <Frame value={props.value} colors={props.colors} cancel={() => send('cancel')} submit={() => send('submit')} input={() => input} discardChanges={() => text() !== initial}>
    <Text style={{color: props.colors().secondary, fontSize: 14}}>{props.value().description}</Text>
    <Field label={props.value().inputLabel} testID="text-entry" colors={props.colors} value={text()} multiline placeholder={props.value().placeholder} inputRef={ref => { input = ref }}
      onChange={value => { text.set(value); send('change') }} />
    <View style={{flexDirection: 'row', justifyContent: 'flex-end', gap: 8}}>
      <Action label="取消" testID="form-cancel" colors={props.colors} onPress={() => send('cancel')} />
      <Action label={props.value().confirmText} testID="text-submit" primary colors={props.colors} onPress={() => send('submit')} />
    </View>
  </Frame>
}

function AnnotationForm(props: FormProps<'annotation'>) {
  const value = signal(props.value().value)
  const region = signal(props.value().region)
  const coordinateError = signal('')
  let input: InputRef | undefined
  const fields = {x: signal(String(region()?.x ?? 0)), y: signal(String(region()?.y ?? 0)), width: signal(String(region()?.width ?? 1)), height: signal(String(region()?.height ?? 1))}
  const coordinates = () => ({type: 'rectangle' as const, x: Number(fields.x()), y: Number(fields.y()), width: Number(fields.width()), height: Number(fields.height())})
  const validCoordinates = () => !props.value().image || (Object.values(fields).every(field => field().trim() !== '') && Boolean(props.value().bounds && validRegion(coordinates(), props.value().bounds!)))
  // This modal owns its local fields; asynchronous projection echoes must not replace newer input.
  const initial = JSON.stringify({value: value(), fields: Object.values(fields).map(field => field())})
  const changed = () => JSON.stringify({value: value(), fields: Object.values(fields).map(field => field())}) !== initial
  const send = (action: 'change' | 'submit' | 'cancel' | 'dismiss') => {
    if (action === 'cancel' || action === 'dismiss') { props.send({type: 'annotation', id: props.value().id, action}); return }
    if (action === 'submit' && (!canSubmitComposition(value()) || !validCoordinates())) return
    if (props.value().image) {
      const next = coordinates()
      const invalid = Object.values(fields).some(field => field().trim() === '') || [next.x, next.y, next.width, next.height].some(n => !Number.isInteger(n))
      if (invalid) { coordinateError.set('请输入完整的整数坐标'); return }
      coordinateError.set(validCoordinates() ? '' : '区域必须位于原图范围内，宽高须大于 0'); region.set(next)
    }
    props.send({type: 'annotation', id: props.value().id, action, value: value(), region: region()})
  }
  return <Frame value={props.value} colors={props.colors} cancel={() => send('cancel')} dismiss={() => send('dismiss')} submit={() => send('submit')} input={() => input} discardChanges={() => props.value().dismissal === 'discard' && changed()}>
    <Text style={{color: props.colors().secondary, fontSize: 14, numberOfLines: 5}}>{props.value().excerpt}</Text>
    <If when={props.value().image}>
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
        <Each of={['x', 'y', 'width', 'height'] as const}>{key => <View style={{width: 100}}>
          <Field testID={`region-${key()}`} label={{x: 'X', y: 'Y', width: '宽', height: '高'}[key()]} colors={props.colors} value={fields[key()]()} onChange={value => { fields[key()].set(value); send('change') }} />
        </View>}</Each>
      </View>
    </If>
    <Composer value={value} colors={props.colors} image={props.value().image} input={ref => { input = ref }} change={next => { value.set(next); send('change') }} />
    <Text style={{color: props.colors().danger, fontSize: 13}}>{coordinateError}</Text>
    <View style={{flexDirection: 'row', justifyContent: 'flex-end', gap: 8}}>
      <Action label="取消" testID="form-cancel" colors={props.colors} onPress={() => send('cancel')} />
      <Action label="保存批注" testID="annotation-save" primary colors={props.colors} disabled={!canSubmitComposition(value()) || !validCoordinates()} onPress={() => send('submit')} />
    </View>
  </Frame>
}

function SearchForm(props: FormProps<'search'>) {
  const query = signal(props.value().query)
  const caseSensitive = signal(props.value().caseSensitive)
  const regex = signal(props.value().regex)
  const crossDoc = signal(props.value().crossDoc)
  const value = signal(props.value().value)
  let input: InputRef | undefined
  const canSubmit = () => !props.value().invalid && props.value().hits > 0 && canSubmitComposition(value())
  const send = (action: Extract<ShellCommand, {type: 'search'}>['action']) => {
    if (action === 'submit' && !canSubmit()) return
    if (action === 'close') props.send({type: 'search', id: props.value().id, action})
    else props.send({type: 'search', id: props.value().id, action, query: query(), caseSensitive: caseSensitive(), regex: regex(), crossDoc: crossDoc(), value: value()})
  }
  return <Frame value={props.value} colors={props.colors} cancel={() => send('close')} submit={() => send('submit')} input={() => input} discardChanges={() => Boolean(value().comment.trim() || value().replacement.trim())}>
    <Field label="搜索正文" testID="search-query" maxLength={4096} value={query()} colors={props.colors} inputRef={ref => { input = ref }} onChange={next => { query.set(next); send('change') }} />
    <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 4}}>
      <Action label="区分大小写" selected={caseSensitive()} colors={props.colors} onPress={() => { caseSensitive.set(!caseSensitive()); send('change') }} />
      <Action label="正则表达式" selected={regex()} colors={props.colors} onPress={() => { regex.set(!regex()); send('change') }} />
      <Action label="跨文档" selected={crossDoc()} colors={props.colors} onPress={() => { crossDoc.set(!crossDoc()); send('change') }} />
      <Action label="上一个" colors={props.colors} onPress={() => send('previous')} />
      <Action label="下一个" colors={props.colors} onPress={() => send('next')} />
    </View>
    <Text style={{color: props.value().invalid ? props.colors().danger : props.colors().secondary}}>{props.value().invalid ? '正则表达式无效' : `命中 ${props.value().hits} 处`}</Text>
    <Composer value={value} colors={props.colors} change={next => { value.set(next); send('change') }} />
    <Action label={`批量批注 ${props.value().hits} 处`} primary colors={props.colors} disabled={!canSubmit()} onPress={() => send('submit')} />
  </Frame>
}

function ExportForm(props: FormProps<'export'>) {
  const send = (action: Extract<ShellCommand, {type: 'export'}>['action'], patch: Partial<Pick<InteractionOf<'export'>, 'format' | 'includeResolved' | 'includeFileInfo'>> = {}) => action === 'close' ? props.send({type: 'export', id: props.value().id, action}) : props.send({type: 'export', id: props.value().id, action, format: props.value().format, includeResolved: props.value().includeResolved, includeFileInfo: props.value().includeFileInfo, ...patch})
  return <Frame value={props.value} colors={props.colors} cancel={() => send('close')}>
    <View style={{flexDirection: 'row', flexWrap: 'wrap'}}>
      <Each of={props.value().hasImages ? ['review', 'w3c'] as const : ['inline', 'snippets', 'review', 'w3c'] as const}>{format => <Action label={{inline: '原文 + 批注', snippets: '片段 + 批注', review: '评审引用块', w3c: 'W3C 批注'}[format()]}
        selected={props.value().format === format()} colors={props.colors} onPress={() => send('change', {format: format()})} />}</Each>
      <Action label="包含已解决" selected={props.value().includeResolved} colors={props.colors} onPress={() => send('change', {includeResolved: !props.value().includeResolved})} />
      <Action label="包含文件信息" selected={props.value().includeFileInfo} colors={props.colors} onPress={() => send('change', {includeFileInfo: !props.value().includeFileInfo})} />
    </View>
    <Text style={{color: props.colors().secondary, fontSize: 13}}>{props.value().description}</Text>
    <Field label="导出预览" value={props.value().preview} onChange={() => {}} colors={props.colors} multiline readonly />
    <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 4}}>
      <If when={props.value().format === 'w3c'}><Action label="导入 W3C JSON" colors={props.colors} disabled={props.value().busy} onPress={() => send('import')} /></If>
      <Action label="复制" colors={props.colors} disabled={props.value().busy} onPress={() => send('copy')} />
      <Action label={`保存 .${props.value().suffix}`} testID="export-save" primary colors={props.colors} disabled={props.value().busy} onPress={() => send('save')} />
    </View>
  </Frame>
}

function SettingsForm(props: FormProps<'settings'>) {
  const prefs = signal(props.value().prefs)
  const send = (action: 'change' | 'close') => action === 'close' ? props.send({type: 'settings', id: props.value().id, action}) : props.send({type: 'settings', id: props.value().id, action, prefs: prefs()})
  const change = (patch: Partial<ReadingPrefs>) => { prefs.set({...prefs(), ...patch}); send('change') }
  return <Frame value={props.value} colors={props.colors} cancel={() => send('close')}>
    <Choice label="主题" colors={props.colors} value={prefs().theme} items={Object.entries(THEME_META).map(([value, item]) => ({value, title: item.label}))} onChange={theme => change({theme: theme as ReadingPrefs['theme']})} />
    <Choice label="纹理" colors={props.colors} value={prefs().texture} items={Object.entries(TEXTURE_META).map(([value, item]) => ({value, title: item.label}))} onChange={texture => change({texture: texture as ReadingPrefs['texture']})} />
    <Choice label="字体" colors={props.colors} value={prefs().font} items={Object.entries(FONT_META).map(([value, item]) => ({value, title: item.label}))} onChange={font => change({font: font as ReadingPrefs['font']})} />
    <Choice label="字重" colors={props.colors} value={prefs().fontWeight} items={Object.entries(FONT_WEIGHT_META).map(([value, item]) => ({value, title: item.label}))} onChange={fontWeight => change({fontWeight: fontWeight as ReadingPrefs['fontWeight']})} />
    <View style={{flexDirection: 'row', alignItems: 'center'}}>
      <Action label="减小字号" colors={props.colors} disabled={prefs().fontSize <= 13} onPress={() => change({fontSize: Math.max(13, prefs().fontSize - .5)})} />
      <Text style={{color: props.colors().text}}>{prefs().fontSize} px</Text>
      <Action label="增大字号" colors={props.colors} disabled={prefs().fontSize >= 22} onPress={() => change({fontSize: Math.min(22, prefs().fontSize + .5)})} />
    </View>
    <Each of={['customText', 'customBg'] as const}>{key => {
      const color = signal(prefs()[key()] ?? '')
      const valid = () => color() === '' || /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color())
      return <View style={{gap: 4}}>
        <Field label={key() === 'customText' ? '正文颜色（#rrggbb，空白跟随主题）' : '画布背景（#rrggbb）'} colors={props.colors} value={color()} onChange={next => { color.set(next); if (valid()) change({[key()]: next || null}) }} />
        <If when={!valid()}><Text style={{color: props.colors().danger}}>请输入 #rgb 或 #rrggbb</Text></If>
      </View>
    }}</Each>
    <Action label="完成" primary colors={props.colors} onPress={() => send('close')} />
  </Frame>
}

function TrashForm(props: FormProps<'trash'>) {
  const query = signal(props.value().query)
  const send = (action: Extract<ShellCommand, {type: 'trash'}>['action'], keys = props.value().selected) => action === 'close' ? props.send({type: 'trash', id: props.value().id, action}) : props.send({type: 'trash', id: props.value().id, action, query: query(), keys})
  return <Frame value={props.value} colors={props.colors} cancel={() => send('close')}>
    <Text style={{color: props.colors().secondary, fontSize: 13}}>删除的文档与批注保留 7 天。恢复冲突时保留回收站原项。</Text>
    <Field label="搜索回收站" maxLength={4096} colors={props.colors} value={query()} onChange={next => { query.set(next); send('search') }} />
    <View style={{flexDirection: 'row', flexWrap: 'wrap'}}>
      <Action label="全选" colors={props.colors} onPress={() => send('all')} />
      <Action label="反选" colors={props.colors} onPress={() => send('invert')} />
      <Action label={`恢复所选 (${props.value().selected.length})`} colors={props.colors} disabled={!props.value().selected.length} onPress={() => send('restore')} />
      <Action label="彻底删除所选" danger colors={props.colors} disabled={!props.value().selected.length} onPress={() => send('purge')} />
    </View>
    <Each of={props.value().rows} key={row => row.key}>{row => <View style={{borderTopWidth: 1, borderColor: props.colors().border, paddingVertical: 12, gap: 6}}>
      <Action label={`${props.value().selected.includes(row().key) ? '☑' : '□'} ${row().name}`} colors={props.colors} onPress={() => send('select', [row().key])} />
      <Text style={{fontSize: 13, color: props.colors().secondary}}>{row().description} · 剩余 {row().remainingDays} 天</Text>
      <View style={{flexDirection: 'row'}}><Action label="恢复" colors={props.colors} onPress={() => send('restore', [row().key])} /><Action label="彻底删除" danger colors={props.colors} onPress={() => send('purge', [row().key])} /></View>
    </View>}</Each>
    <If when={props.value().pages > 1}><View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}}>
      <Action label="上一页" colors={props.colors} disabled={!props.value().page} onPress={() => send('previous')} />
      <Text style={{color: props.colors().secondary}}>{props.value().page + 1} / {props.value().pages}</Text>
      <Action label="下一页" colors={props.colors} disabled={props.value().page + 1 >= props.value().pages} onPress={() => send('next')} />
    </View></If>
    <Action label="清空回收站" danger colors={props.colors} disabled={!props.value().total} onPress={() => send('clear')} />
  </Frame>
}

function ImportForm(props: FormProps<'import'>) {
  const send = (action: Extract<ShellCommand, {type: 'import'}>['action'], index = 0, decision: 'overwrite' | 'rename' | 'skip' = 'rename', preset: 'overwrite-all' | 'overwrite-unannotated' | 'overwrite-annotated' = 'overwrite-all') => action === 'cancel' ? props.send({type: 'import', id: props.value().id, action}) : props.send({type: 'import', id: props.value().id, action, index, decision, preset})
  return <Frame value={props.value} colors={props.colors} cancel={() => send('cancel')}>
    <Text style={{fontSize: 13, color: props.colors().secondary}}>覆盖保留原有批注并重新定位；重命名保留两个版本。</Text>
    <View style={{flexDirection: 'row', flexWrap: 'wrap'}}>
      <Action label="全部覆盖" colors={props.colors} onPress={() => send('preset')} />
      <Action label="覆盖未标注的" colors={props.colors} onPress={() => send('preset', 0, 'rename', 'overwrite-unannotated')} />
      <Action label="覆盖标注的" colors={props.colors} onPress={() => send('preset', 0, 'rename', 'overwrite-annotated')} />
    </View>
    <Each of={props.value().rows} key={row => row.index}>{row => <View style={{gap: 6, paddingVertical: 10, borderTopWidth: 1, borderColor: props.colors().border}}>
      <Text style={{fontSize: 14, color: props.colors().text}}>{row().path ? `${row().path}/` : ''}{row().name}</Text>
      <Text style={{fontSize: 12, color: props.colors().secondary}}>{row().annotationCount} 条批注{row().action === 'overwrite' ? ` · 重锚 ${row().moved} · 失锚 ${row().lost}` : ''}{row().action === 'rename' ? ` → ${row().renameTo}` : ''}</Text>
      <If when={row().action !== 'direct' && row().action !== 'identical'}>
        <View style={{flexDirection: 'row'}}><Each of={['overwrite', 'rename', 'skip'] as const}>{decision => <Action label={{overwrite: '覆盖', rename: '重命名', skip: '跳过'}[decision()]} colors={props.colors} selected={row().action === decision()} onPress={() => send('row', row().index, decision())} />}</Each></View>
      </If>
      <If when={row().action === 'direct' || row().action === 'identical'}><Text style={{color: props.colors().secondary}}>{row().action === 'direct' ? '直接导入' : '内容相同，跳过'}</Text></If>
    </View>}</Each>
    <Action label="确认导入" primary colors={props.colors} disabled={!props.value().canSubmit} onPress={() => send('submit')} />
  </Frame>
}

function Confirmation(props: FormProps<'choice'>) {
  const send = (choice: 'confirm' | 'alt' | 'cancel') => props.send({type: 'choice', id: props.value().id, choice})
  return <Frame value={props.value} colors={props.colors} cancel={() => send('cancel')}>
    <Text style={{fontSize: 14, color: props.colors().text}}>{props.value().description}</Text>
    <View style={{flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8}}>
      <Action label={props.value().cancelText} colors={props.colors} onPress={() => send('cancel')} />
      <If when={Boolean(props.value().altText)}><Action label={props.value().altText ?? ''} colors={props.colors} onPress={() => send('alt')} /></If>
      <Action label={props.value().confirmText} primary={!props.value().danger} danger={props.value().danger} colors={props.colors} onPress={() => send('confirm')} />
    </View>
  </Frame>
}

/** Keyed sessions keep the same platform Input during projection updates and IME composition. */
export function NativeForms(props: {items: Accessor<NativeInteraction[]>; colors: Colors; send: Send}) {
  return <Each of={props.items()} key={item => item.id}>{item => {
    const type = item().type
    const read = <T extends NativeInteraction['type']>(type: T): Accessor<InteractionOf<T>> => () => {
      const current = item()
      if (current.type !== type) throw new Error('An interaction changed type without changing identity')
      return current as InteractionOf<T>
    }
    switch (type) {
      case 'choice': return <Confirmation value={read('choice')} colors={props.colors} send={props.send} />
      case 'text': return <TextForm value={read('text')} colors={props.colors} send={props.send} />
      case 'annotation': return <AnnotationForm value={read('annotation')} colors={props.colors} send={props.send} />
      case 'search': return <SearchForm value={read('search')} colors={props.colors} send={props.send} />
      case 'export': return <ExportForm value={read('export')} colors={props.colors} send={props.send} />
      case 'settings': return <SettingsForm value={read('settings')} colors={props.colors} send={props.send} />
      case 'trash': return <TrashForm value={read('trash')} colors={props.colors} send={props.send} />
      case 'import': return <ImportForm value={read('import')} colors={props.colors} send={props.send} />
    }
  }}</Each>
}
