import {mount, signal, Text, View, platform} from 'nsh'
import {Workspace, type FileBindings} from '../shared/App'
import document from '../generated/e2e-web'
import {encodeBytes, decodeBytes} from '../../src/platform/protocol'
import {clipboardBitmap} from './fixtures'

const result = signal('running')
let exports = 0
const files: FileBindings = {
  pickFiles: async () => [{name: '中'.repeat(80) + '.md', type: 'text/markdown', base64: encodeBytes(new TextEncoder().encode('# Native review\n\nA **stable primitive** composes.'))}],
  // Windows CI seeds the real OS clipboard; other platforms leave the user's clipboard untouched.
  readClipboardImage: platform.os === 'windows' ? undefined : async () => [clipboardBitmap],
  saveFile: async file => {
    if (file.name === 'e2e-report.json') { result.set(new TextDecoder().decode(decodeBytes(file.base64))); return 'saved' }
    exports++
    if (exports === 1) return 'cancelled'
    if (exports === 2) throw new Error('Test disk unavailable')
    if (!file.base64 || !file.name.endsWith('.json') || new TextEncoder().encode(file.name).length > 255) throw new Error('Unexpected export')
    return 'saved'
  },
}
mount(() => <View style={{flex: 1}}>
  <Text testID="journey-result">{result}</Text>
  <Workspace document={document} files={files} />
</View>)
