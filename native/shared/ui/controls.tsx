import {setComposing} from './input-state'
import {cleanup, Text, View, windowSize, platform, type Accessor, type InputRef} from 'nsh'
import {Button, Checkbox, Input, Select} from 'nsh/base'

export interface Palette {canvas: string; chrome: string; inset: string; text: string; secondary: string; border: string; accent: string; danger: string}
export const light: Palette = {canvas: '#ffffff', chrome: '#f7f7f8', inset: '#ededf0', text: '#202124', secondary: '#60636b', border: '#dddfe3', accent: '#0866ce', danger: '#ba2540'}
export const dark: Palette = {canvas: '#17181a', chrome: '#202124', inset: '#2b2d31', text: '#f2f3f5', secondary: '#acafb8', border: '#373a40', accent: '#71b3ff', danger: '#ff8294'}
export type Colors = Accessor<Palette>
export const compact = () => windowSize().width < 900
export const touch = () => !platform.desktop

export function Action(props: {label: string; onPress: () => void; colors: Colors; selected?: boolean; disabled?: boolean; primary?: boolean; danger?: boolean; testID?: string; align?: 'start'}) {
  return <Button testID={props.testID} accessibilityLabel={props.label} disabled={props.disabled} selected={props.selected} onPress={props.onPress}
    style={{minHeight: touch() ? 44 : 30, maxWidth: '100%', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, justifyContent: 'center', alignItems: props.align === 'start' ? 'flex-start' : 'center',
      backgroundColor: props.primary ? props.colors().accent : props.selected ? props.colors().inset : 'transparent'}}
    hoverStyle={{backgroundColor: props.colors().inset}} focusVisibleStyle={{borderWidth: 2, borderColor: props.colors().accent}}
    disabledStyle={{opacity: .4}}>
    <Text style={{fontSize: touch() ? 15 : 13, numberOfLines: 1, flexShrink: 1, fontWeight: props.primary ? '600' : '400', color: props.primary ? props.colors().canvas : props.danger ? props.colors().danger : props.colors().text}}>{props.label}</Text>
  </Button>
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
    style={{minHeight: touch() ? 44 : 30, minWidth: touch() ? 44 : 30, alignItems: 'center', justifyContent: 'center'}}
    indicatorStyle={{width: 16, height: 16, borderRadius: 3, borderWidth: 1, borderColor: props.checked ? props.colors().accent : props.colors().secondary,
      backgroundColor: props.checked ? props.colors().accent : props.colors().canvas, alignItems: 'center', justifyContent: 'center'}}
    indicator={<Text style={{fontSize: 12, color: props.colors().canvas}}>{props.checked ? '✓' : ''}</Text>} />
}
