import {expect, test} from 'nsh/test'
import {MAX_FILE_BYTES, parseRequest} from '../../src/platform/protocol'

function incoming(): string {
  const encoded = 'AAAA'.repeat(Math.floor(MAX_FILE_BYTES / 3)) + 'AAA='
  return JSON.stringify({id: 'boundary', operation: 'files.save', file: {name: 'review.zip', type: 'application/zip', base64: encoded}})
}

test('QuickJS receives and forwards a maximum-size file within its native heap budget', () => {
  const message = incoming()
  const request = parseRequest(message)
  if (request.operation !== 'files.save') throw new Error('Wrong request')
  const forwarded = JSON.stringify(request.file)
  expect(forwarded.length > MAX_FILE_BYTES).toBe(true)
}, 30000)
