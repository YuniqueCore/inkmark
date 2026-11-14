import {mount, signal, Text, View} from 'nsh'
import {Workspace, type FileBindings} from '../shared/App'
import document from '../generated/e2e-web'
import {encodeBytes, decodeBytes} from '../../src/platform/protocol'

const result = signal('running')
let exports = 0
const files: FileBindings = {
  pickFiles: async () => [{name: 'native.md', type: 'text/markdown', base64: encodeBytes(new TextEncoder().encode('# Native review\n\nA **stable primitive** composes.'))}],
  readClipboardImage: async () => [{name: 'clipboard.png', type: 'image/png', base64: "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEklEQVR4nGOssXr7nwEJkCEAAKHFCo385P9jAAAAAElFTkSuQmCC"}],
  saveFile: async file => {
    if (file.name === 'e2e-report.json') { result.set(new TextDecoder().decode(decodeBytes(file.base64))); return 'saved' }
    exports++
    if (exports === 1) return 'cancelled'
    if (exports === 2) throw new Error('Test disk unavailable')
    if (!file.base64 || !file.name.endsWith('.json')) throw new Error('Unexpected export')
    return 'saved'
  },
}
mount(() => <View style={{flex: 1}}>
  <Text testID="journey-result">{result}</Text>
  <Workspace document={document} files={files} />
</View>)
