import {Export, Import} from 'inkmark/native'
import {Workspace, type FileBindings} from '../shared/App'
import document from '../generated/web'
import {mount} from 'nsh'
import {receiptSchema} from '../../src/platform/protocol'
import {parse} from 'valibot'

const files: FileBindings = {
  saveFile: async file => parse(receiptSchema, await Export.save(file.name, file.base64)),
  pickFiles: async options => (await (options.directory ? Import.folder() : Import.files(options.multiple, options.extensions)))
    .map(file => ({name: file.name, type: file.mediaType, base64: file.base64, relativePath: file.relativePath})),
}

mount(() => <Workspace document={document} files={files} />)
