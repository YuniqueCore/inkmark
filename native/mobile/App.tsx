import {host, platform} from 'nsh'
import {parse} from 'valibot'
import {Workspace, type FileBindings} from '../shared/App'
import document from '../generated/web'
import {mount} from 'nsh'
import {receiptSchema, filesSchema} from '../../src/platform/protocol'

// A system share sheet has a user-controlled lifetime, not a network deadline.
const files: FileBindings = {
  saveFile: async file => parse(receiptSchema, await host.call('files.export', file, {timeout: 0})),
  pickFiles: async options => parse(filesSchema, await host.call('files.pick', options, {timeout: 0})),
  readClipboardImage: platform.os === 'android'
    ? async () => parse(filesSchema, await host.call('clipboard.image', null, {timeout: 0}))
    : undefined,
}

mount(() => <Workspace document={document} files={files} />)
