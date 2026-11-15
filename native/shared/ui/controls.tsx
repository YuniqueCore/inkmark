import {setComposing} from './input-state'
import {cleanup, signal, Text, View, windowSize, platform, type Accessor, type InputRef} from 'nsh'
import {Button, Checkbox, Input, Menu, MenuItem, MenuSeparator, Select, Tab, Tabs} from 'nsh/base'

export interface Palette {canvas: string; chrome: string; inset: string; text: string; secondary: string; border: string; accent: string; accentHover: string; accentPressed: string; danger: string}
export const light: Palette = {canvas: '#ffffff', chrome: '#f7f7f8', inset: '#ededf0', text: '#202124', secondary: '#60636b', border: '#dddfe3', accent: '#0866ce', accentHover: '#075bbb', accentPressed: '#0754aa', danger: '#ba2540'}
export const dark: Palette = {canvas: '#17181a', chrome: '#202124', inset: '#2b2d31', text: '#f2f3f5', secondary: '#acafb8', border: '#373a40', accent: '#71b3ff', accentHover: '#83bdff', accentPressed: '#9bcbff', danger: '#ff8294'}
export type Colors = Accessor<Palette>
export const compact = () => windowSize().width < 900
export const touch = () => !platform.desktop

export interface MenuAction<T extends string> {value: T; label: string; testID?: string; disabled?: boolean; checked?: boolean; danger?: boolean}

/** Mobile sheets become actionable at NSH's settled lifecycle boundary, never at moving coordinates. */
export function ActionsMenu<T extends string>(props: {label: string; text?: string; testID?: string; groups: readonly (readonly MenuAction<T>[])[]; onSelect: (value: T) => void; colors: Colors}) {
  const phase = signal<'closed' | 'opening' | 'open' | 'closing'>('closed')
  const wantsOpen = signal(false)
  const actionable = () => wantsOpen() && (phase() === 'open' || (!touch() && phase() === 'opening'))
  const itemStyle = () => ({minHeight: touch() ? 44 : 32, padding: 10, borderRadius: 6, borderWidth: 1, borderColor: 'transparent'})
  // Finish an exit before another entry so each opening has its own completion event.
  return <Menu open={phase() === 'opening' || phase() === 'open'}
    onOpenChange={({open}) => {
      wantsOpen.set(open)
      if (open && phase() === 'closed') phase.set('opening')
      else if (!open && phase() === 'open') phase.set('closing')
    }}
    onOpen={() => { if (phase() === 'opening') phase.set(wantsOpen() ? 'open' : 'closing') }}
    onClose={() => { if (phase() === 'closing') phase.set(wantsOpen() ? 'opening' : 'closed') }}
    popupStyle={{backgroundColor: props.colors().chrome, borderRadius: 8, padding: 6}}
    backdropStyle={{backgroundColor: '#00000040'}}
    trigger={<Text accessibilityLabel={props.label} testID={props.testID} style={{minHeight: touch() ? 44 : 30, minWidth: touch() ? 44 : 30,
      padding: 10, fontSize: touch() ? 15 : 13, color: props.colors().text}}>{props.text ?? props.label}</Text>}>
    <Each of={props.groups} key="index">{(group, index) => <>
      <If when={index() > 0}><MenuSeparator style={{height: 1, backgroundColor: props.colors().border, marginVertical: 4}} /></If>
      <Each of={group()} key={item => item.value}>{item => <MenuItem testID={item().testID}
        disabled={!actionable() || item().disabled}
        checked={item().checked} role={item().checked === undefined ? undefined : 'menuitemradio'} onSelect={() => props.onSelect(item().value)}
        style={itemStyle()}
        checkedStyle={{backgroundColor: props.colors().inset}}
        hoverStyle={{backgroundColor: props.colors().inset}} focusVisibleStyle={{borderColor: props.colors().accent}} disabledStyle={{opacity: .4}}>
        <Text style={{fontSize: touch() ? 15 : 14, fontWeight: item().checked ? '600' : '400', color: item().danger ? props.colors().danger : props.colors().text}}>{item().label}</Text>
      </MenuItem>}</Each>
    </>}</Each>
    <If when={touch()}>
      <MenuSeparator style={{height: 1, backgroundColor: props.colors().border, marginVertical: 4}} />
      <MenuItem testID={props.testID ? `${props.testID}-cancel` : undefined} disabled={!actionable()} style={itemStyle()}
        disabledStyle={{opacity: .4}}><Text style={{fontSize: 15, color: props.colors().secondary}}>取消</Text></MenuItem>
    </If>
  </Menu>
}

export function Action(props: {label: string; onPress: () => void; colors: Colors; selected?: boolean; disabled?: boolean; primary?: boolean; danger?: boolean; testID?: string; align?: 'start'}) {
  return <Button testID={props.testID} accessibilityLabel={props.label} disabled={props.disabled} selected={props.selected} onPress={props.onPress}
    style={{minHeight: touch() ? 44 : 30, maxWidth: '100%', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: 'transparent', justifyContent: 'center', alignItems: props.align === 'start' ? 'flex-start' : 'center',
      backgroundColor: props.primary ? props.colors().accent : props.selected ? props.colors().inset : 'transparent'}}
    hoverStyle={{backgroundColor: props.primary ? props.colors().accentHover : props.colors().inset}}
    activeStyle={{backgroundColor: props.primary ? props.colors().accentPressed : props.colors().inset}} focusVisibleStyle={{borderColor: props.primary ? props.colors().text : props.colors().accent}}
    disabledStyle={{opacity: .4}}>
    <Text style={{fontSize: touch() ? 15 : 13, numberOfLines: 1, flexShrink: 1, fontWeight: props.primary ? '600' : '400', color: props.primary ? props.colors().canvas : props.danger ? props.colors().danger : props.colors().text}}>{props.label}</Text>
  </Button>
}

/** A single native choice; Tabs owns roving focus and arrow/Home/End navigation. */
export function Segmented<T extends string>(props: {label: string; value: T; items: readonly {value: T; title: string; testID?: string}[]; onChange: (value: T) => void; colors: Colors}) {
  return <View accessibilityLabel={props.label} style={{flexShrink: 0}}><Tabs style={{flexDirection: 'row', flexShrink: 0, padding: 2, gap: 2, borderRadius: 8, backgroundColor: props.colors().inset}}
    indicatorStyle={{top: 2, bottom: 2, borderRadius: 6, backgroundColor: props.colors().canvas}}>
    <Each of={props.items}>{item => <Tab testID={item().testID} accessibilityLabel={item().title} selected={props.value === item().value} onPress={() => props.onChange(item().value)}
      style={{minHeight: touch() ? 44 : 26, paddingHorizontal: touch() ? 12 : 10, justifyContent: 'center', borderRadius: 6, borderWidth: 1, borderColor: 'transparent'}}
      hoverStyle={{backgroundColor: props.colors().canvas}} activeStyle={{borderColor: props.colors().accent}} focusVisibleStyle={{borderColor: props.colors().accent}}>
      <Text style={{fontSize: touch() ? 15 : 13, fontWeight: props.value === item().value ? '600' : '400', color: props.value === item().value ? props.colors().text : props.colors().secondary}}>{item().title}</Text>
    </Tab>}</Each>
  </Tabs></View>
}

export function Field(props: {label: string; value: string; onChange: (value: string) => void; colors: Colors; multiline?: boolean; readonly?: boolean; maxLength?: number; placeholder?: string; testID?: string; inputRef?: (ref: InputRef) => void}) {
  const token = Symbol()
  cleanup(() => setComposing(token, false))
  return <View style={{gap: 6}}>
    <Text style={{fontSize: 12, color: props.colors().secondary}}>{props.label}</Text>
    <Input ref={ref => props.inputRef?.(ref)} testID={props.testID} accessibilityLabel={props.label} value={props.value} onChange={({value}) => props.onChange(value)}
      onCompositionChange={({composing}) => setComposing(token, composing)}
      maxLength={props.maxLength ?? 8 * 1024 * 1024} multiline={props.multiline} readonly={props.readonly} placeholder={props.placeholder}
      style={{minHeight: props.multiline ? 120 : touch() ? 44 : 34, maxHeight: props.multiline ? 240 : 48, padding: 10, borderRadius: 6,
        borderWidth: 1, borderColor: props.colors().border, backgroundColor: props.colors().canvas, color: props.colors().text, fontSize: touch() ? 16 : 14}}
      focusStyle={{borderColor: props.colors().accent}} />
  </View>
}

export function Choice(props: {label: string; value: string; items: {value: string; title: string}[]; onChange: (value: string) => void; colors: Colors}) {
  return <View style={{gap: 6}}>
    <Text style={{fontSize: 12, color: props.colors().secondary}}>{props.label}</Text>
    <Select accessibilityLabel={props.label} value={props.value} items={props.items} onChange={({value}) => { if (value !== null) props.onChange(value) }}
      style={{minHeight: touch() ? 44 : 34, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: props.colors().border, backgroundColor: props.colors().canvas}}
      itemStyle={{fontSize: 14, color: props.colors().text, padding: 12}} popupStyle={{backgroundColor: props.colors().chrome, borderRadius: 8}}
      trigger={<Text style={{fontSize: 14, color: props.colors().text}}>{props.items.find(item => item.value === props.value)?.title ?? props.label}</Text>} />
  </View>
}

export function Check(props: {label: string; checked: boolean; colors: Colors; onChange: () => void}) {
  return <Checkbox checked={props.checked} accessibilityLabel={props.label} onChange={props.onChange}
    style={{minHeight: touch() ? 44 : 30, minWidth: touch() ? 44 : 30, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent', borderRadius: 6}}
    focusVisibleStyle={{borderColor: props.colors().accent}} hoverStyle={{backgroundColor: props.colors().inset}}
    indicatorStyle={{width: 16, height: 16, borderRadius: 3, borderWidth: 1, borderColor: props.checked ? props.colors().accent : props.colors().secondary,
      backgroundColor: props.checked ? props.colors().accent : props.colors().canvas, alignItems: 'center', justifyContent: 'center'}}
    indicator={<Text style={{fontSize: 12, color: props.colors().canvas}}>{props.checked ? '✓' : ''}</Text>} />
}
