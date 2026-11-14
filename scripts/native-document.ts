import {createHash} from 'node:crypto'
import {parse, serialize, defaultTreeAdapter as tree, type DefaultTreeAdapterTypes} from 'parse5'

/** Hash the parsed script text browsers execute, including HTML newline normalization. */
export function sealNativeDocument(source: string): string {
  const document = parse(source)
  const hashes: string[] = []
  function visit(node: DefaultTreeAdapterTypes.Node): void {
    if (tree.isElementNode(node)) {
      if (node.tagName === 'script') {
        if (node.attrs.some(attr => attr.name === 'src')) throw new Error('Native scripts must be inline')
        const text = node.childNodes.map(child => tree.isTextNode(child) ? child.value : '').join('')
        hashes.push(`'sha256-${createHash('sha256').update(text).digest('base64')}'`)
      }
      if (node.attrs.some(attr => ['src', 'href'].includes(attr.name) && /^(?:https?:|\/)/.test(attr.value))) {
        if (node.tagName !== 'a') throw new Error(`Native resource is not embedded: ${node.tagName}`)
      }
    }
    if ('childNodes' in node) node.childNodes.forEach(visit)
  }
  visit(document)
  // parse5 supplies html/head even for an empty document.
  const head = document.childNodes.find(tree.isElementNode)!.childNodes.filter(tree.isElementNode).find(node => node.tagName === 'head')!
  head.childNodes = head.childNodes.filter(node => !tree.isElementNode(node) || !node.attrs.some(attr => attr.name === 'http-equiv' && attr.value.toLowerCase() === 'content-security-policy'))
  const policy = `default-src 'none'; script-src ${hashes.join(' ')}; style-src 'unsafe-inline'; img-src data: blob: https:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`
  const meta = tree.createElement('meta', head.namespaceURI, [
    {name: 'http-equiv', value: 'Content-Security-Policy'}, {name: 'content', value: policy},
  ])
  if (head.childNodes[0]) tree.insertBefore(head, meta, head.childNodes[0])
  else tree.appendChild(head, meta)
  return serialize(document)
}
