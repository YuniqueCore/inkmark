import {readFile, writeFile, mkdir} from 'node:fs/promises'
import {Resvg} from '@resvg/resvg-js'

const product = JSON.parse(await readFile('native/product.json', 'utf8'))
const {version} = JSON.parse(await readFile('package.json', 'utf8'))
const base = {...product, version, icon: '../generated/icons/icon.png', capabilities: {
  webview: {hosts: ['inkmark.localhost']}, clipboard: true, statusBar: true,
  openUrl: {schemes: ['https', 'http', 'mailto']},
}}
const desktop = {...base, rust: '.', singleInstance: true,
  window: {title: product.name, defaultSize: {width: 1280, height: 840}, minSize: {width: 640, height: 480}, closeOnPress: false},
}
const mobile = {...base, capabilities: {...base.capabilities, host: ['files.export', 'files.pick', 'clipboard.image']}}
for (const [target, config] of Object.entries({desktop, mobile})) {
  await writeFile(`native/${target}/nsh.json`, JSON.stringify(config, null, 2) + '\n')
}
const svg = await readFile('public/favicon.svg', 'utf8')
await mkdir('native/generated/icons', {recursive: true})
const png = new Resvg(svg, {background: '#18181b', fitTo: {mode: 'width', value: 1024}}).render().asPng()
await writeFile('native/generated/icons/icon.png', png)
const ios = 'native/generated/icons/Assets.xcassets/AppIcon.appiconset'
await mkdir(ios, {recursive: true})
await writeFile(`${ios}/icon.png`, png)
await writeFile(`${ios}/Contents.json`, JSON.stringify({images: [{filename: 'icon.png', idiom: 'universal', platform: 'ios', size: '1024x1024'}], info: {author: 'xcode', version: 1}}))
for (const [density, pixels] of Object.entries({mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192})) {
  const directory = `native/generated/icons/android/res/mipmap-${density}`
  await mkdir(directory, {recursive: true})
  await writeFile(`${directory}/ic_launcher.png`, new Resvg(svg, {fitTo: {mode: 'width', value: pixels}}).render().asPng())
}
console.log(`Prepared ${product.name} ${version} (${product.build}) native metadata and icons`)
