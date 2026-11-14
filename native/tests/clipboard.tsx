import {Clipboard, mount, signal, Text} from 'nsh'
import {currentWindow} from 'nsh/desktop'

// Run with `nsh run`, not `nsh test`: the test runner replaces the OS clipboard with a text-only backend.
mount(() => {
  const status = signal('reading system clipboard')
  void (async () => {
    try {
      const image = await Clipboard.readImage()
      if (!image || image.size.width !== 1 || image.size.height !== 1) throw new Error('Expected the system 1x1 bitmap')
      const blob = await (await fetch(image.url)).blob()
      const bytes = new Uint8Array(await blob.arrayBuffer())
      if (blob.type !== 'image/bmp' || bytes[0] !== 0x42 || bytes[1] !== 0x4d) throw new Error('Expected CF_DIB encoded as BMP')
      status.set('passed')
    } catch (error) { status.set(`failed: ${error instanceof Error ? error.message : String(error)}`) }
    currentWindow().set({title: `InkMarkClipboard:${status()}`})
  })()
  return <Text>{status}</Text>
})
